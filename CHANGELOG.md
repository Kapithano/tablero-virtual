# Historial de versiones

El proyecto sigue [versionado semántico](https://semver.org/lang/es/) simplificado: `MAYOR.MENOR.PARCHE`.

- **MENOR** (0.1 → 0.2): una funcionalidad nueva.
- **PARCHE** (0.2.0 → 0.2.1): una corrección sin funcionalidad nueva.
- **MAYOR** (0.x → 1.0): cuando el proyecto se considere estable.

La versión se escribe **solo en `package.json`**; la app la muestra sola (barra superior y pantalla de inicio).

## 0.2.1 — Corrección del SQL

- `schema.sql` ya no falla con `column "board_id" does not exist` si en Supabase había quedado una tabla `players` de un intento anterior: la reemplaza.

## 0.2.0 — Tablero del jugador con tokens

- El tablero del jugador pasa a llamarse **Tablero Jugador** (antes "Mi tablero").
- Panel izquierdo: el jugador escribe su **nombre** y sube una **imagen de avatar**.
- El avatar se reduce solo en el navegador (128 × 128 px, JPEG, ~5–20 KB como máximo).
- El avatar es un **token redondo** en el tablero (si no hay imagen, muestra la inicial).
- Jugador y administrador pueden **mover** el token y **ocultarlo / mostrarlo**.
  El jugador solo maneja el suyo; el administrador maneja todos.
- Al pasar el cursor sobre un token se muestra el **nombre** del jugador.
- Los tokens ocultos no se envían a los demás jugadores (ni siquiera al recargar).
- Nuevo en el panel del director: lista de **Jugadores** con botón Ocultar / Mostrar.
- Se muestra la versión de la app.
- **Base de datos:** hay que volver a ejecutar `supabase/schema.sql` (no borra datos).

## 0.1.0 — Tablero en blanco

- Tablero en blanco donde solo el administrador dibuja.
- Entrada de jugadores por enlace + código de acceso renovable.
- Activar / desactivar el tablero desde el panel del director.
