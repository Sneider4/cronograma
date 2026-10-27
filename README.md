# Cronograma · planeación en equipo

Cronograma colaborativo en tiempo real. Cada proyecto tiene sus objetivos, su equipo
y cuatro formas de ver las mismas actividades:

| Vista | Qué permite |
|---|---|
| **Gantt** | Zoom día / semana / mes, agrupado por objetivo, línea de hoy. Arrastrar la barra mueve la actividad; arrastrar sus bordes cambia inicio o fin. Doble clic en el fondo crea una actividad. |
| **Calendario** | Mes, semana o lista (FullCalendar). Arrastrar para mover, estirar para cambiar duración, seleccionar días para crear. |
| **Kanban** | Columnas por estado; arrastrar una tarjeta cambia su estado. |
| **Lista** | Tabla ordenable con edición rápida de estado y prioridad. |

Los filtros (texto, objetivo, estado, vencidas, responsable) y los indicadores aplican a las cuatro vistas.

**Angular 21 (signals, standalone, zoneless) + Supabase (Postgres, Auth, Realtime, RLS) + ExcelJS.** Sin backend propio y sin Docker.

## Excel

- **Descargar plantilla**: libro con la hoja `Tareas` (encabezados fijos, listas desplegables en
  Estado / Prioridad / Objetivo, validación de fechas y avance), la hoja `Objetivos` con los del
  proyecto y una hoja `Instrucciones` con un ejemplo.
- **Importar**: vista previa antes de guardar, con los errores fila por fila. Se puede *agregar* al
  cronograma o *reemplazarlo*. Los objetivos que no existan se crean por su código. Toda la
  importación ocurre en una sola transacción (`import_tasks`): o entra completa o no entra nada.
- **Exportar**: el mismo formato de la plantilla (se puede volver a importar tal cual) más una hoja
  `Cronograma` con un Gantt por semanas hecho con celdas de color.

El importador busca las columnas por nombre (no por posición) y acepta fechas como fecha real de
Excel, `dd/mm/aaaa`, `aaaa-mm-dd` o número serial; estados con sinónimos (*en progreso*, *terminado*…)
y avance como `50`, `50%` o `0,5` con formato de porcentaje.

## Puesta en marcha

1. Crea un proyecto **nuevo** en [supabase.com](https://supabase.com). No reutilices el de otra app:
   el esquema define funciones como `is_member` que podrían chocar con las suyas.
2. En **SQL Editor** pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
3. Para desarrollo: *Authentication → Sign In / Providers → Email* → desactiva **Confirm email**.
4. Copia la URL y la *anon key* (*Project Settings → API*) en
   [`src/environments/environment.ts`](src/environments/environment.ts).
5. Instala y arranca:

   ```bash
   npm install
   npm start          # http://localhost:4200
   npm test           # pruebas de Excel y fechas
   ```

## Correos y recuperación de contraseña

En el login, «¿La olvidaste?» envía un enlace. Ese enlace abre `/restablecer`, donde se crea la contraseña
nueva. Para que funcione:

1. **Authentication → URL Configuration**:
   - **Site URL**: la dirección de la app (`http://localhost:4200` en desarrollo, la de Vercel en producción).
   - **Redirect URLs**: agrega `http://localhost:4200/**` y luego `https://<tu-app>.vercel.app/**`.
2. **Authentication → Emails → Templates**: pega el HTML de [`supabase/email-templates/`](supabase/email-templates)
   - *Confirm signup* → `confirmar-cuenta.html`, asunto «Confirma tu cuenta en Cronograma».
   - *Reset password* → `recuperar-contrasena.html`, asunto «Restablece tu contraseña de Cronograma».
3. **Producción**: el correo que trae Supabase solo llega a los miembros del equipo de Supabase y envía muy
   pocos por hora. Por eso se envía con la cuenta `cronogramaxi@gmail.com` por SMTP
   (*Authentication → Emails → SMTP Settings*):
   - Host `smtp.gmail.com`, puerto `465`, usuario `cronogramaxi@gmail.com`.
   - Contraseña: una **contraseña de aplicación** de Google (no la normal; requiere verificación en 2 pasos).
   - Remitente `cronogramaxi@gmail.com`, nombre «Cronograma».
   - Gmail permite unos 500 correos al día.

Los logos para descargar están en [`public/brand/`](public/brand) y en producción en
`/brand/cronograma-logo-perfil.png` (foto de perfil, cuadrada) y `/brand/cronograma-logo.png`.

## Equipo

Quien crea un proyecto es su **dueño**. En *Invitar* aparece un código de 6 caracteres; los demás
entran con *Unirme con código* y quedan como **editores** (crean, editan, importan). Solo el dueño
cambia nombre/color, administra miembros, regenera el código o elimina el proyecto.

## Despliegue en Vercel

`vercel.json` ya trae el build y la reescritura para la SPA. Importa el repo en Vercel y listo. La
*anon key* puede ir versionada: es pública por diseño y quien protege los datos es RLS. **Nunca** pongas
ahí la `service_role`.

## Estructura

```
src/app/
  core/          servicios (auth, board con realtime, excel, fechas), modelos
  components/    gantt, calendar, kanban, task-list, diálogos
  pages/         login, projects, project
supabase/schema.sql
```
