-- ============================================================
-- Perfil, responsable por persona y permisos por rol
--
-- Correr UNA vez en Supabase > SQL Editor sobre la base existente.
-- No borra datos y se puede volver a correr sin problema.
--
-- 1. Avatar en el perfil.
-- 2. El responsable de una tarea se guarda por persona (assignee_id).
--    La columna de texto "assignee" se queda: guarda el nombre de
--    "otra persona" (sin cuenta) o una copia del nombre del miembro.
-- 3. Roles (los elige el dueno en Ajustes > Equipo):
--    - owner       Dueno: todo, mas administrar proyecto y equipo.
--    - editor      Editor: ve y edita todas las actividades y objetivos.
--    - contributor Colaborador: ve todo; en sus actividades cambia
--                  estado, avance, notas y evidencia.
--    - member      Integrante: ve SOLO sus actividades y cambia lo mismo
--                  que el colaborador. Es el rol al entrar con el codigo.
--    Los miembros que ya existian como 'editor' conservan ese rol.
-- ============================================================

-- ---------- Roles ----------
alter table project_members drop constraint if exists project_members_role_check;
alter table project_members add constraint project_members_role_check
  check (role in ('owner', 'editor', 'contributor', 'member'));
alter table project_members alter column role set default 'member';

-- Edita todas las actividades: dueno o editor.
create or replace function can_edit_all(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
     where project_id = p_project and user_id = auth.uid() and role in ('owner', 'editor')
  );
$$;

-- Ve todas las actividades: dueno, editor o colaborador.
create or replace function can_see_all(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
     where project_id = p_project and user_id = auth.uid() and role in ('owner', 'editor', 'contributor')
  );
$$;

-- Quien entra con el codigo llega como integrante.
create or replace function join_project(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  select id into target from projects where invite_code = upper(btrim(p_code));
  if target is null then
    raise exception 'CODIGO_INVALIDO';
  end if;

  insert into project_members (project_id, user_id, role)
  values (target, auth.uid(), 'member')
  on conflict do nothing;

  return target;
end;
$$;

-- ---------- 1. Avatar ----------
alter table profiles add column if not exists avatar text not null default '';

-- ---------- 2. Responsable por persona ----------
alter table tasks add column if not exists assignee_id uuid references profiles(id) on delete set null;
create index if not exists idx_tasks_assignee on tasks (project_id, assignee_id);

-- Vincula los responsables escritos a mano con el miembro que se llama
-- igual (o cuyo correo coincide). Los que no coinciden quedan como
-- "otra persona" con su texto.
update tasks t
   set assignee_id = m.user_id
  from project_members m
  join profiles p on p.id = m.user_id
 where t.assignee_id is null
   and m.project_id = t.project_id
   and btrim(t.assignee) <> ''
   and lower(btrim(t.assignee)) in (
         lower(btrim(p.full_name)), lower(p.email), lower(split_part(p.email, '@', 1))
       );

-- ---------- 3. Reglas de las tareas ----------
-- Los procesos internos (sacar a alguien del equipo, renombrar) prenden
-- esta bandera para saltarse la regla de "solo el dueno".
create or replace function guard_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(current_setting('cronograma.sistema', true), '') = 'on' then
    return new;
  end if;

  -- El responsable tiene que ser del equipo del proyecto.
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (
       select 1 from project_members
        where project_id = new.project_id and user_id = new.assignee_id
     ) then
    raise exception 'RESPONSABLE_NO_MIEMBRO';
  end if;

  -- Colaborador e integrante solo cambian estado, avance, notas y evidencia.
  if tg_op = 'UPDATE' and not can_edit_all(old.project_id) then
    if (new.project_id, new.objective_id, new.name, new.start_date, new.end_date,
        new.priority, new.deliverable, new.assignee, new.assignee_id)
       is distinct from
       (old.project_id, old.objective_id, old.name, old.start_date, old.end_date,
        old.priority, old.deliverable, old.assignee, old.assignee_id) then
      raise exception 'SIN_PERMISO';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_guard on tasks;
create trigger tasks_guard
  before insert or update on tasks
  for each row execute function guard_task();

-- Quien sale del equipo deja de ser responsable de sus tareas.
create or replace function unassign_departed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('cronograma.sistema', 'on', true);
  update tasks set assignee_id = null, assignee = ''
   where project_id = old.project_id and assignee_id = old.user_id;
  perform set_config('cronograma.sistema', '', true);
  return old;
end;
$$;

drop trigger if exists members_unassign on project_members;
create trigger members_unassign
  after delete on project_members
  for each row execute function unassign_departed();

-- Si alguien cambia su nombre, la copia en sus tareas se actualiza
-- (la usan el Excel y la pantalla de inicio).
create or replace function sync_assignee_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name then
    perform set_config('cronograma.sistema', 'on', true);
    update tasks set assignee = new.full_name where assignee_id = new.id;
    perform set_config('cronograma.sistema', '', true);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_name on profiles;
create trigger profiles_sync_name
  after update on profiles
  for each row execute function sync_assignee_name();

-- ---------- Importacion: dueno o editor, con responsable por persona ----------
create or replace function import_tasks(
  p_project    uuid,
  p_tasks      jsonb,
  p_objectives jsonb   default '[]'::jsonb,
  p_replace    boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  palette  text[] := array['#c2652a','#0b0b0c','#8e9097','#e0914f','#4a4b51','#7a3612','#c4c6cc','#a8774f'];
  obj      jsonb;
  inserted int;
begin
  if not can_edit_all(p_project) then
    raise exception 'SIN_PERMISO';
  end if;

  for obj in
    select jsonb_build_object('code', upper(btrim(x->>'code')), 'name', coalesce(x->>'name', ''))
      from jsonb_array_elements(coalesce(p_objectives, '[]'::jsonb)) x
     where coalesce(btrim(x->>'code'), '') <> ''
    union
    select distinct jsonb_build_object('code', upper(btrim(t->>'objective_code')), 'name', '')
      from jsonb_array_elements(p_tasks) t
     where coalesce(btrim(t->>'objective_code'), '') <> ''
  loop
    insert into objectives (project_id, code, name, color)
    values (
      p_project,
      obj->>'code',
      obj->>'name',
      palette[1 + (select count(*) from objectives where project_id = p_project) % array_length(palette, 1)]
    )
    on conflict (project_id, upper(code)) do update
      set name = case when excluded.name <> '' then excluded.name else objectives.name end;
  end loop;

  if p_replace then
    delete from tasks where project_id = p_project;
  end if;

  insert into tasks (project_id, objective_id, name, start_date, end_date, status, priority,
                     progress, deliverable, assignee, assignee_id, notes, evidence_url, created_by)
  select p_project,
         (select o.id from objectives o
           where o.project_id = p_project
             and upper(o.code) = upper(btrim(t.objective_code))),
         btrim(t.name),
         t.start_date,
         t.end_date,
         coalesce(t.status, 'pendiente'),
         coalesce(t.priority, 'media'),
         coalesce(t.progress, 0),
         coalesce(t.deliverable, ''),
         coalesce(t.assignee, ''),
         -- Solo se acepta si la persona es del equipo.
         (select m.user_id from project_members m
           where m.project_id = p_project and m.user_id = t.assignee_id),
         coalesce(t.notes, ''),
         coalesce(t.evidence_url, ''),
         auth.uid()
    from jsonb_to_recordset(p_tasks) as t(
           name text, start_date date, end_date date, objective_code text, status text,
           priority text, progress int, deliverable text, assignee text, assignee_id uuid,
           notes text, evidence_url text);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- ---------- Permisos (RLS) ----------
drop policy if exists tasks_all    on tasks;
drop policy if exists tasks_select on tasks;
drop policy if exists tasks_insert on tasks;
drop policy if exists tasks_update on tasks;
drop policy if exists tasks_delete on tasks;

create policy tasks_select on tasks for select to authenticated
  using (can_see_all(project_id) or (assignee_id = auth.uid() and is_member(project_id)));
create policy tasks_insert on tasks for insert to authenticated
  with check (can_edit_all(project_id));
create policy tasks_update on tasks for update to authenticated
  using (can_edit_all(project_id) or (assignee_id = auth.uid() and is_member(project_id)))
  with check (can_edit_all(project_id) or (assignee_id = auth.uid() and is_member(project_id)));
create policy tasks_delete on tasks for delete to authenticated
  using (can_edit_all(project_id));

drop policy if exists objectives_all    on objectives;
drop policy if exists objectives_select on objectives;
drop policy if exists objectives_insert on objectives;
drop policy if exists objectives_update on objectives;
drop policy if exists objectives_delete on objectives;

create policy objectives_select on objectives for select to authenticated
  using (is_member(project_id));
create policy objectives_insert on objectives for insert to authenticated
  with check (can_edit_all(project_id));
create policy objectives_update on objectives for update to authenticated
  using (can_edit_all(project_id)) with check (can_edit_all(project_id));
create policy objectives_delete on objectives for delete to authenticated
  using (can_edit_all(project_id));

-- ---------- Tiempo real de perfiles (nombre y avatar del equipo) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table profiles;
  end if;
end;
$$;
