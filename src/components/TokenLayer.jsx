import { useRef, useState } from 'react'
import { BOARD_W, BOARD_H } from '../lib/drawing.js'
import { estiloAvatar, inicial } from '../lib/jugadores.js'

/**
 * Capa de tokens: va encima del lienzo, dentro del marco del tablero.
 * - tokens: [{ id, name, avatar, x, y, visible, dead }] en coordenadas del tablero
 *   (dead = true dibuja una X roja encima del token)
 * - canMove(token): true si quien mira puede mover/arrastrar ese token
 * - onLive(id, x, y): mientras se arrastra (limitado en frecuencia)
 * - onCommit(id, x, y): al soltar el token
 * El nombre aparece al pasar el cursor (ver .token::after en styles.css).
 */
export default function TokenLayer({ tokens, canMove, onLive, onCommit }) {
  const capa = useRef(null)
  const arrastre = useRef(null) // { id, dx, dy, x, y }
  const ultimoEnvio = useRef(0)
  const [moviendo, setMoviendo] = useState(null) // { id, x, y } solo para dibujar

  const aPunto = (e) => {
    const r = capa.current.getBoundingClientRect()
    return [((e.clientX - r.left) * BOARD_W) / r.width, ((e.clientY - r.top) * BOARD_H) / r.height]
  }
  const limitar = (v, max) => Math.round(Math.min(max, Math.max(0, v)))

  const alPresionar = (e, t) => {
    if (!canMove(t)) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const [px, py] = aPunto(e)
    // Guardamos la distancia entre el dedo y el centro, para que no "salte"
    arrastre.current = { id: t.id, dx: t.x - px, dy: t.y - py, x: undefined, y: undefined }
    setMoviendo({ id: t.id, x: t.x, y: t.y })
  }

  const alMover = (e) => {
    const d = arrastre.current
    if (!d) return
    const [px, py] = aPunto(e)
    d.x = limitar(px + d.dx, BOARD_W)
    d.y = limitar(py + d.dy, BOARD_H)
    setMoviendo({ id: d.id, x: d.x, y: d.y })
    const ahora = performance.now()
    if (onLive && ahora - ultimoEnvio.current > 60) {
      ultimoEnvio.current = ahora
      onLive(d.id, d.x, d.y)
    }
  }

  const alSoltar = () => {
    const d = arrastre.current
    if (!d) return
    arrastre.current = null
    setMoviendo(null)
    if (d.x !== undefined) onCommit?.(d.id, d.x, d.y) // si solo fue un toque, no hay nada que guardar
  }

  return (
    <div className="token-layer" ref={capa}>
      {tokens.map((t) => {
        const enArrastre = moviendo && moviendo.id === t.id
        const x = enArrastre ? moviendo.x : t.x
        const y = enArrastre ? moviendo.y : t.y
        const clases = [
          'avatar-bg',
          'token',
          canMove(t) ? 'movible' : '',
          t.visible ? '' : 'oculto',
          t.dead ? 'muerto' : '',
          enArrastre ? 'moviendo' : '',
          y > BOARD_H * 0.8 ? 'tip-up' : '',
          x < 140 ? 'tip-left' : '',
          x > BOARD_W - 140 ? 'tip-right' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={t.id}
            className={clases}
            style={{
              left: `${(x / BOARD_W) * 100}%`,
              top: `${(y / BOARD_H) * 100}%`,
              ...estiloAvatar(t),
            }}
            data-name={t.name || 'Jugador'}
            onPointerDown={(e) => alPresionar(e, t)}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerCancel={alSoltar}
          >
            {!t.avatar && inicial(t.name)}
            {t.dead && (
              <svg className="token-x" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M18 18 L82 82 M82 18 L18 82" className="x-borde" />
                <path d="M18 18 L82 82 M82 18 L18 82" className="x-roja" />
              </svg>
            )}
          </div>
        )
      })}
    </div>
  )
}
