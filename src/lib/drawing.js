// El tablero tiene un tamaño "virtual" fijo (16:9). Todos los trazos se guardan
// en estas coordenadas, así se ven igual en cualquier pantalla.
export const BOARD_W = 1600
export const BOARD_H = 900
export const RESOLUCION = 2 // el canvas real es el doble, para que se vea nítido

export function dibujarTrazo(ctx, s) {
  const pts = s.points
  if (!pts || pts.length === 0) return

  ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over'
  ctx.strokeStyle = s.color
  ctx.fillStyle = s.color
  ctx.lineWidth = s.size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0][0], pts[0][1], s.size / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export function redibujar(canvas, trazos) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const k = canvas.width / BOARD_W
  ctx.setTransform(k, 0, 0, k, 0, 0)
  trazos.forEach((t) => dibujarTrazo(ctx, t))
}

// Trae todos los trazos de un tablero (Supabase devuelve máximo 1000 por consulta)
export async function cargarTrazos(supabase, boardId) {
  const todos = []
  const tam = 1000
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await supabase
      .from('strokes')
      .select('data')
      .eq('board_id', boardId)
      .order('id', { ascending: true })
      .range(desde, desde + tam - 1)
    if (error) throw error
    todos.push(...data.map((r) => r.data))
    if (data.length < tam) break
  }
  return todos
}

export function nombreCanal(boardId, codigo) {
  return `tablero:${boardId}:${String(codigo).trim().toUpperCase()}`
}
