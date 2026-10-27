-- ============================================================
-- Limpiar la base de datos de Cronograma para empezar de cero.
-- Se ejecuta en Supabase -> SQL Editor. NO SE PUEDE DESHACER.
--
-- No toca la estructura (tablas, funciones, permisos, realtime):
-- solo borra los datos. La app sigue funcionando igual.
-- ============================================================

begin;

-- 1) Proyectos. En cascada se borran sus miembros, objetivos y actividades.
delete from public.projects;

-- 2) Cuentas de usuario. En cascada se borran sus perfiles (public.profiles).
--    Si quieres CONSERVAR las cuentas y borrar solo los proyectos, comenta esta linea
--    poniendole "--" al inicio.
delete from auth.users;

commit;

-- Comprobacion: todo debe quedar en 0.
select
  (select count(*) from public.projects)        as proyectos,
  (select count(*) from public.project_members) as miembros,
  (select count(*) from public.objectives)      as objetivos,
  (select count(*) from public.tasks)           as actividades,
  (select count(*) from public.profiles)        as perfiles,
  (select count(*) from auth.users)             as usuarios;
