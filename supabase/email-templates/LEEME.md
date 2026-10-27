# Plantillas de correo para Supabase

Cada archivo `.html` de esta carpeta es el contenido de un correo. Se pega en Supabase en
**Authentication → Emails → Templates**.

| Plantilla en Supabase | Archivo de esta carpeta     | Subject (asunto)                         |
|-----------------------|-----------------------------|------------------------------------------|
| **Confirm signup**    | `confirmar-cuenta.html`     | `Confirma tu cuenta en Cronograma`       |
| **Reset password**    | `recuperar-contrasena.html` | `Restablece tu contraseña de Cronograma` |

## Pasos (repetir con cada plantilla)

1. Abre el archivo `.html` con el Bloc de notas o VS Code: clic derecho → *Abrir con*.
2. Selecciona todo con **Ctrl+A** y cópialo con **Ctrl+C**.
3. En Supabase entra a **Authentication → Emails → Templates** y elige la plantilla de la tabla.
4. Escribe el **Subject** de la tabla.
5. Haz clic en el cuadro **Message body**, selecciona todo con **Ctrl+A** y pega con **Ctrl+V**.
6. Revisa la vista previa (logo y botón negro) y dale **Save**.

No cambies lo que está entre llaves dobles, por ejemplo `{{ .ConfirmationURL }}` o `{{ .Email }}`.
Supabase lo reemplaza en cada envío por el enlace y el correo de cada persona.
