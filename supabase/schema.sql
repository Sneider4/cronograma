-- ============================================================
-- Cronograma · esquema v1
--
-- Pegar completo en Supabase -> SQL Editor -> Run.
-- Es idempotente: borra y recrea todo (incluidos los datos).
--
-- Para desarrollo conviene desactivar la confirmacion de correo:
--   Authentication -> Sign In / Providers -> Email -> "Confirm email" off
-- Si la dejas activa, cada cuenta nueva debe confirmar desde su correo.
--
-- Despues de este archivo corre perfil-y-permisos.sql (avatares,
-- responsable por persona y los roles Dueno/Editor/Colaborador/Integrante).
-- ============================================================

drop table if exists tasks           cascade;
drop table if exists objectives      cascade;
drop table if exists project_members cascade;
drop table if exists projects        cascade;
drop table if exists profiles        cascade;
drop function if exists handle_new_user() cascade;

-- ---------- Perfiles ----------
-- Copia publica minima de auth.users (nombre y correo) para mostrar quien
-- esta en cada proyecto. auth.users no es legible desde el cliente.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Cuentas que ya existian antes de correr este script.
insert into profiles (id, full_name, email)
select id,
       coalesce(nullif(btrim(raw_user_meta_data->>'full_name'), ''), split_part(email, '@', 1)),
       coalesce(email, '')
  from auth.users
on conflict (id) do nothing;

-- ---------- Proyectos ----------
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '',
  color       text not null default '#4f46e5',
  invite_code text unique not null,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null default 'editor' check (role in ('owner', 'editor')),
  joined_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------- Objetivos (OE1, OE2...) ----------
create table objectives (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code       text not null check (length(btrim(code)) between 1 and 20),
  name       text not null default '',
  color      text not null default '#64748b',
  created_at timestamptz not null default now()
);

-- El codigo es la llave con la que el Excel referencia el objetivo.
create unique index objectives_code on objectives (project_id, upper(code));

-- ---------- Tareas ----------
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  objective_id uuid references objectives(id) on delete set null,
  name         text not null check (length(btrim(name)) between 1 and 300),
  start_date   date not null,
  end_date     date not null,
  status       text not null default 'pendiente'
               check (status in ('pendiente', 'en_proceso', 'bloqueada', 'completada')),
  priority     text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  progress     int  not null default 0 check (progress between 0 and 100),
  deliverable  text not null default '',
  assignee     text not null default '',
  notes        text not null default '',
  evidence_url text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

create index idx_members_user     on project_members (user_id);
create index idx_objectives_proj  on objectives (project_id);
create index idx_tasks_project    on tasks (project_id, start_date);

create or replace function touch_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger tasks_touch
  before update on tasks
  for each row execute function touch_task();

-- ============================================================
-- Helpers de pertenencia
--
-- security definer: una politica sobre project_members que consulta
-- project_members se llamaria a si misma (recursion infinita).
-- ============================================================
create or replace function is_member(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
     where project_id = p_project and user_id = auth.uid()
  );
$$;

create or replace function is_owner(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members
     where project_id = p_project and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Dos usuarios "se ven" si comparten al menos un proyecto.
create or replace function shares_project_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from project_members a
      join project_members b on b.project_id = a.project_id
     where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- ============================================================
-- Codigos de invitacion
-- ============================================================
create or replace function generate_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- sin O/0/I/1
  v_code   text;
  i        int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from projects p where p.invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- ============================================================
-- Crear proyecto / unirse / salir
--
-- Pasan por funciones porque hay que escribir antes de ser miembro.
-- ============================================================
create or replace function create_project(p_name text, p_description text default '', p_color text default '#4f46e5')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  insert into projects (name, description, color, invite_code, created_by)
  values (btrim(p_name), coalesce(btrim(p_description), ''), coalesce(p_color, '#4f46e5'),
          generate_invite_code(), auth.uid())
  returning id into new_id;

  insert into project_members (project_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return new_id;
end;
$$;

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
  values (target, auth.uid(), 'editor')
  on conflict do nothing;

  return target;
end;
$$;

create or replace function regenerate_invite_code(p_project uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not is_owner(p_project) then
    raise exception 'SOLO_DUENO';
  end if;
  v_code := generate_invite_code();
  update projects set invite_code = v_code where id = p_project;
  return v_code;
end;
$$;

-- El ultimo dueno no puede irse: el proyecto quedaria sin quien lo administre.
create or replace function leave_project(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_owner(p_project) and (
    select count(*) from project_members where project_id = p_project and role = 'owner'
  ) = 1 then
    raise exception 'ULTIMO_DUENO';
  end if;

  delete from project_members where project_id = p_project and user_id = auth.uid();
end;
$$;

-- ============================================================
-- Importacion desde Excel
--
-- Todo en una transaccion: si una fila falla no queda el cronograma a
-- medias. Los objetivos que no existan se crean por su codigo.
--
-- p_objectives: [{ "code": "OE1", "name": "..." }]
-- p_tasks:      [{ "name", "start_date", "end_date", "objective_code",
--                  "status", "priority", "progress", "deliverable",
--                  "assignee", "notes", "evidence_url" }]
-- ============================================================
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
  palette  text[] := array['#4f46e5','#0891b2','#16a34a','#d97706','#db2777','#7c3aed','#dc2626','#0d9488'];
  obj      jsonb;
  inserted int;
begin
  if not is_member(p_project) then
    raise exception 'NO_ERES_MIEMBRO';
  end if;

  -- Objetivos declarados en la hoja "Objetivos" mas los que solo aparecen
  -- referenciados en las tareas.
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
                     progress, deliverable, assignee, notes, evidence_url, created_by)
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
         coalesce(t.notes, ''),
         coalesce(t.evidence_url, ''),
         auth.uid()
    from jsonb_to_recordset(p_tasks) as t(
           name text, start_date date, end_date date, objective_code text, status text,
           priority text, progress int, deliverable text, assignee text, notes text,
           evidence_url text);

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- ---------- Realtime ----------
alter publication supabase_realtime add table projects;
alter publication supabase_realtime add table project_members;
alter publication supabase_realtime add table objectives;
alter publication supabase_realtime add table tasks;

-- ============================================================
-- RLS
--
-- Cada quien ve y edita solo los proyectos a los que pertenece. Crear,
-- unirse y salir pasan por las funciones de arriba, por eso no hay
-- politicas de INSERT sobre projects ni project_members.
-- ============================================================
alter table profiles        enable row level security;
alter table projects        enable row level security;
alter table project_members enable row level security;
alter table objectives      enable row level security;
alter table tasks           enable row level security;

create policy profiles_select on profiles for select to authenticated
  using (id = auth.uid() or shares_project_with(id));
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy projects_select on projects for select to authenticated
  using (is_member(id));
create policy projects_update on projects for update to authenticated
  using (is_owner(id)) with check (is_owner(id));
create policy projects_delete on projects for delete to authenticated
  using (is_owner(id));

create policy members_select on project_members for select to authenticated
  using (is_member(project_id));
-- El dueno cambia roles o saca gente; nadie se cambia el rol a si mismo.
create policy members_update on project_members for update to authenticated
  using (is_owner(project_id) and user_id <> auth.uid())
  with check (is_owner(project_id));
create policy members_delete on project_members for delete to authenticated
  using (is_owner(project_id) and user_id <> auth.uid());

create policy objectives_all on objectives for all to authenticated
  using (is_member(project_id)) with check (is_member(project_id));

create policy tasks_all on tasks for all to authenticated
  using (is_member(project_id)) with check (is_member(project_id));
