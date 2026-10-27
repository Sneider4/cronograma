-- ============================================================
-- Pasa a azul los colores cobre que ya estan guardados en la base
-- (proyectos y objetivos creados antes del cambio de paleta).
-- Se ejecuta una vez en Supabase -> SQL Editor. No toca nada mas.
-- ============================================================

begin;

with mapa(viejo, nuevo) as (
  values
    ('#c2652a', '#2d5bf0'),  -- cobre      -> azul cobalto
    ('#e0914f', '#6f8fff'),  -- cobre claro -> azul claro
    ('#7a3612', '#15287a'),  -- cobre oscuro -> azul profundo
    ('#a8774f', '#5a6f9e')   -- bronce     -> azul pizarra
)
update public.projects p
set color = m.nuevo
from mapa m
where lower(p.color) = m.viejo;

with mapa(viejo, nuevo) as (
  values
    ('#c2652a', '#2d5bf0'),
    ('#e0914f', '#6f8fff'),
    ('#7a3612', '#15287a'),
    ('#a8774f', '#5a6f9e')
)
update public.objectives o
set color = m.nuevo
from mapa m
where lower(o.color) = m.viejo;

commit;

-- Comprobacion: no debe quedar ningun color cobre.
select 'proyectos' as tabla, color, count(*) from public.projects group by color
union all
select 'objetivos', color, count(*) from public.objectives group by color
order by 1, 2;
