// Utilidades de los jugadores y sus tokens.

// ---------- identidad del jugador (vive solo en su navegador) ----------
// No hay cuentas: cada navegador guarda un id y un secreto al azar por tablero.
// El secreto es lo que demuestra, ante el servidor, que el token es suyo.
const claveIdentidad = (boardId) => `tablero-jugador-${boardId}`

export function leerIdentidad(boardId) {
  try {
    const crudo = localStorage.getItem(claveIdentidad(boardId))
    if (!crudo) return null
    const v = JSON.parse(crudo)
    return v && v.id && v.secret ? v : null
  } catch {
    return null
  }
}

export function crearIdentidad(boardId) {
  const identidad = {
    id: crypto.randomUUID(),
    secret: crypto.randomUUID() + crypto.randomUUID(),
  }
  try {
    localStorage.setItem(claveIdentidad(boardId), JSON.stringify(identidad))
  } catch {
    /* sin almacenamiento: la identidad dura mientras la página esté abierta */
  }
  return identidad
}

// ---------- lista de jugadores ----------
export function upsertJugador(lista, jugador) {
  const i = lista.findIndex((j) => j.id === jugador.id)
  if (i === -1) return [...lista, jugador]
  const copia = lista.slice()
  copia[i] = { ...copia[i], ...jugador }
  return copia
}

// ---------- aspecto del avatar ----------
export function colorDeId(id) {
  let h = 0
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h} 55% 45%)`
}

export const inicial = (nombre) => (nombre || '').trim().charAt(0).toUpperCase() || '?'

// Estilo de fondo de un avatar: la imagen si la hay, o un color con la inicial
export function estiloAvatar(j) {
  return j.avatar
    ? { backgroundImage: `url("${j.avatar}")` }
    : { backgroundColor: colorDeId(j.id) }
}
