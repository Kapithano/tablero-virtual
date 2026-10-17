import { useEffect, useRef } from 'react'
import { BOARD_W, BOARD_H, RESOLUCION, redibujar } from '../lib/drawing.js'

/**
 * Lienzo del tablero.
 * - strokes: trazos ya terminados
 * - live: trazos en curso de otros (para ver dibujar en vivo)
 * - canDraw: solo el administrador puede dibujar
 * - tool: { color, size, eraser }
 * - onLive(trazo): se llama mientras se dibuja (limitado en frecuencia)
 * - onCommit(trazo): se llama al soltar el lápiz
 */
export default function BoardCanvas({ strokes, live = [], canDraw = false, tool, onLive, onCommit }) {
  const canvasRef = useRef(null)
  const actual = useRef(null)
  const ultimoEnvio = useRef(0)
  const strokesRef = useRef(strokes)
  const liveRef = useRef(live)
  strokesRef.current = strokes
  liveRef.current = live

  const pintar = () => {
    const extra = actual.current ? [actual.current] : []
    redibujar(canvasRef.current, [...strokesRef.current, ...liveRef.current, ...extra])
  }

  useEffect(pintar, [strokes, live])

  const aPunto = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    const x = ((e.clientX - r.left) * BOARD_W) / r.width
    const y = ((e.clientY - r.top) * BOARD_H) / r.height
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10]
  }

  const alPresionar = (e) => {
    if (!canDraw) return
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    actual.current = {
      id: crypto.randomUUID(),
      color: tool.color,
      size: tool.size,
      eraser: !!tool.eraser,
      points: [aPunto(e)],
    }
    pintar()
  }

  const alMover = (e) => {
    if (!actual.current) return
    actual.current.points.push(aPunto(e))
    pintar()
    const ahora = performance.now()
    if (onLive && ahora - ultimoEnvio.current > 70) {
      ultimoEnvio.current = ahora
      onLive({ ...actual.current, points: [...actual.current.points] })
    }
  }

  const alSoltar = () => {
    if (!actual.current) return
    const trazo = actual.current
    actual.current = null
    onCommit?.(trazo)
  }

  return (
    <div className="board-frame">
      <canvas
        ref={canvasRef}
        className={`board-canvas ${canDraw ? 'can-draw' : ''}`}
        width={BOARD_W * RESOLUCION}
        height={BOARD_H * RESOLUCION}
        onPointerDown={alPresionar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      />
    </div>
  )
}
