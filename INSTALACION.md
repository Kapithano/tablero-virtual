# Tablero Virtual — Versión 1 (tablero en blanco)

## Qué hace esta versión.

- Un **tablero en blanco** donde **solo el administrador (director de juego) dibuja**.
- Los jugadores entran con un **enlace** que les pasa el administrador y un **código de acceso**.
- Desde el **panel de administrador** se puede:
  - **Activar / desactivar** el tablero (si está desactivado, los jugadores esperan en una pantalla de pausa).
  - **Renovar el código** (los jugadores conectados salen y necesitan el nuevo).
  - Dibujar con 6 colores, 4 grosores, borrador, deshacer y borrar todo.
- Los jugadores ven el dibujo **en vivo**, sin recargar.

Tecnología: React + Vite, Supabase (usuarios, base de datos y tiempo real), Vercel (publicación).

---

## Paso 1 — Supabase

Recomiendo crear un **proyecto nuevo** para empezar limpio.

1. Entrá a https://supabase.com → **New project**. Anotá la contraseña de la base de datos.
2. En el menú izquierdo: **SQL Editor** → **New query**.
3. Abrí el archivo `supabase/schema.sql` de esta carpeta, copiá **todo** el contenido, pegalo en el editor y apretá **Run**. Debe decir "Success".
4. Creá tu usuario de administrador: **Authentication → Users → Add user → Create new user**.
   - Poné tu email y una contraseña.
   - Tildá **Auto Confirm User**.
5. **Importante:** para que nadie más pueda registrarse, andá a **Authentication → Sign In / Providers** (o *Providers → Email*) y **desactivá "Allow new users to sign up"**.
6. Copiá los dos datos que vas a necesitar:
   - **Project URL** (algo como `https://abcdefgh.supabase.co`). Lo encontrás en el botón **Connect** de la barra superior, o en **Project Settings → Data API**. También se arma con el identificador que aparece en la barra de direcciones del navegador, después de `/project/`: `https://IDENTIFICADOR.supabase.co`.
   - **Publishable key** (empieza con `sb_publishable_...`). Está en **Project Settings → API Keys**, pestaña **Publishable and secret API keys**, en la sección **Publishable key**. Apretá el botón de copiar al lado de la clave.
   - Si tu panel es más viejo y no tiene esa sección, usá la pestaña **Legacy anon, service_role API keys** y copiá la clave **anon public**. Sirve igual.

   ⚠️ **No uses la "Secret key" ni la "service_role".** Esas claves son privadas y nunca deben ir en Vercel, en el `.env` ni en GitHub. Solo la Publishable (o la anon).

   Aunque el valor ahora sea la Publishable key, la variable se sigue llamando `VITE_SUPABASE_ANON_KEY`: el nombre no cambia.

---

## Paso 2 — Probarlo en tu computadora (opcional)

Necesitás Node.js instalado (https://nodejs.org, versión LTS). En una terminal, dentro de la carpeta `tablero-virtual`:

```
npm install
```

Copiá el archivo `.env.example` con el nombre `.env` y completalo con tus dos valores:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_tu-clave
```

Después:

```
npm run dev
```

Abrí la dirección que aparece (normalmente http://localhost:5173/admin).

---

## Paso 3 — Subir a GitHub

1. En https://github.com → **New repository**. Nombre: `tablero-virtual`. Dejalo vacío (sin README).
2. En la terminal, dentro de la carpeta `tablero-virtual`:

```
git init
git add .
git commit -m "Version 1: tablero en blanco"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/tablero-virtual.git
git push -u origin main
```

(Reemplazá `TU-USUARIO` por tu usuario de GitHub. Cuando pida contraseña, usá tu **Personal Access Token**, no la contraseña de la cuenta.)

> El archivo `.gitignore` ya evita que se suba el `.env` con tus claves.

Si querés reemplazar el proyecto anterior en un repositorio que ya tenías, lo más simple es crear uno nuevo con este nombre y apuntar Vercel a ese.

---

## Paso 4 — Publicar en Vercel

1. En https://vercel.com → **Add New… → Project** → elegí el repositorio `tablero-virtual`.
2. En **Framework Preset** elegí **Vite**.
3. Abrí **Environment Variables** y agregá estas dos, con **exactamente** estos nombres (incluido el `VITE_`):

| Nombre | Valor |
|---|---|
| `VITE_SUPABASE_URL` | tu Project URL |
| `VITE_SUPABASE_ANON_KEY` | tu Publishable key (`sb_publishable_...`) |

4. Apretá **Deploy**.

Si más adelante cambiás o corregís una variable, tenés que hacer un **Redeploy** (Deployments → los tres puntos → Redeploy) para que tome el cambio.

---

## Cómo se usa

**Director de juego**

1. Entrá a `https://TU-SITIO.vercel.app/admin` e ingresá con el usuario del Paso 1.
2. Apretá **Activar**.
3. En **Acceso**, copiá el **enlace** y el **código** y mandáselos a tus jugadores.
4. Dibujá. Todo se guarda: si recargás, el dibujo sigue ahí.

**Jugadores**

1. Abren el enlace, escriben el código y ven el tablero.
2. Si el tablero está desactivado, ven una pantalla de pausa que se actualiza sola.

---

## Problemas frecuentes

- **"NetworkError" o falla al iniciar sesión:** casi siempre es una variable de Vercel mal escrita o faltante. Revisá que se llamen `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, y hacé Redeploy.
- **"No se pudo cargar el tablero" en el panel:** no se ejecutó el SQL del Paso 1, o se ejecutó con errores. Volvé a correr `supabase/schema.sql`.
- **Email o contraseña incorrectos:** revisá que el usuario esté creado en Authentication → Users y con *Auto Confirm*.
- **Error 404 al abrir un enlace de jugador:** verificá que el archivo `vercel.json` esté en el repositorio.
- **Los jugadores no ven los trazos nuevos en vivo:** pedíles que recarguen la página; si sigue igual, revisá que el proyecto de Supabase no esté pausado (los proyectos gratuitos se pausan tras un tiempo sin uso).

---

## Notas de seguridad de esta versión

- Los jugadores **no pueden dibujar**: solo reciben datos. Las escrituras en la base de datos están protegidas para que únicamente el administrador logueado pueda hacerlas.
- El **código de acceso** se valida en el servidor antes de entregar el dibujo, y además es parte del nombre del canal en tiempo real: al renovarlo, el código anterior deja de servir.
- Está pensado para partidas entre amigos. No lo uses para guardar información sensible.

---

## Estructura del proyecto

```
supabase/schema.sql          tablas, seguridad y funciones
src/pages/Admin.jsx          login y panel del director
src/pages/Tablero.jsx        pantalla de los jugadores
src/components/BoardCanvas.jsx   lienzo de dibujo
src/lib/                     conexión a Supabase y utilidades de dibujo
src/styles.css               estilo visual
```
