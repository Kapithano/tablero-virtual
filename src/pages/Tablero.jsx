import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, configFaltante } from '../lib/supabase.js'
import { nombreCanal } from '../lib/drawing.js'
import BoardCanvas from '../components/BoardCanvas.jsx'

const claveGuardada = (id) => `tablero-codigo-${id}`

function leerCodigoGuardado(id) {
  try {
    return localStorage.getItem(claveGuardada(id)) || ''
  } catch {
    return ''
  }
}
function guardarCodigo(id, codigo) {
  try {
    localStorage.setItem(claveGuardada(id), codigo)
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}
function borrarCodigo(id) {
  try {
    localStorage.removeItem(claveGuardada(id))
  } catch {
    /* nada */
  }
}

export default function Tablero() {
  const { boardId } = useParams()
  // estados: pidiendo-codigo | cargando | ok | inactivo | no-existe | codigo-cambio
  const [estado, setEstado] = useState('cargando')
  const [codigoInput, setCodigoInput] = useState('')
  const [codigoOk, setCodigoOk] = useState('')
  const [error, setError] = useState('')
  const [nombre, setNombre] = useState('')
  const [trazos, setTrazos] = useState([])
  const [enVivo, setEnVivo] = useState({})
  const canalRef = useRef(null)

  const entrar = async (codigo, silencioso = false) => {
    setError('')
    if (!silencioso) setEstado('cargando')
    const { data, error: err } = await supabase.rpc('join_board', {
      p_board: boardId,
      p_code: codigo,
    })
    if (err || !data) {
      setError('No pudimos conectar con el tablero. Probá de nuevo en unos segundos.')
      setEstado('pidiendo-codigo')
      return
    }
    if (data.status === 'not_found') {
      setEstado('no-existe')
    } else if (data.status === 'bad_code') {
      borrarCodigo(boardId)
      setError('Ese código no es correcto.')
      setEstado('pidiendo-codigo')
    } else if (data.status === 'inactive') {
      guardarCodigo(boardId, codigo)
      setCodigoOk(codigo.trim().toUpperCase())
      setEstado('inactivo')
    } else {
      guardarCodigo(boardId, codigo)
      setCodigoOk(codigo.trim().toUpperCase())
      setNombre(data.name || '')
      setTrazos(data.strokes || [])
      setEnVivo({})
      setEstado('ok')
    }
  }

  // Al abrir el enlace, si ya habíamos ingresado el código, probamos de nuevo
  useEffect(() => {
    if (configFaltante) return
    const guardado = leerCodigoGuardado(boardId)
    if (guardado) {
      entrar(guardado)
    } else {
      setEstado('pidiendo-codigo')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  // Conexión en tiempo real una vez que el código fue validado
  const conectado = estado === 'ok' || estado === 'inactivo'
  useEffect(() => {
    if (!conectado || !codigoOk) return

    const canal = supabase.channel(nombreCanal(boardId, codigoOk))
    canalRef.current = canal

    canal
      .on('broadcast', { event: 'live' }, ({ payload }) => {
        setEnVivo((prev) => ({ ...prev, [payload.id]: payload }))
      })
      .on('broadcast', { event: 'stroke' }, ({ payload }) => {
        setEnVivo((prev) => {
          const { [payload.id]: _quitado, ...resto } = prev
          return resto
        })
        setTrazos((prev) => (prev.some((t) => t.id === payload.id) ? prev : [...prev, payload]))
      })
      .on('broadcast', { event: 'undo' }, ({ payload }) => {
        setTrazos((prev) => prev.filter((t) => t.id !== payload.id))
      })
      .on('broadcast', { event: 'clear' }, () => {
        setTrazos([])
        setEnVivo({})
      })
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        if (payload.active) {
          entrar(codigoOk, true)
        } else {
          setEstado('inactivo')
        }
      })
      .on('broadcast', { event: 'closed' }, () => {
        borrarCodigo(boardId)
        setCodigoInput('')
        setEstado('codigo-cambio')
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
      canalRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conectado, codigoOk, boardId])

  // Respaldo: mientras el tablero está desactivado, consultamos cada 15 s
  useEffect(() => {
    if (estado !== 'inactivo' || !codigoOk) return
    const t = setInterval(() => entrar(codigoOk, true), 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, codigoOk])

  if (configFaltante) {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>Falta configurar</h1>
          <p className="muted">
            La aplicación no tiene las variables de Supabase. Avisale al administrador.
          </p>
        </div>
      </main>
    )
  }

  if (estado === 'cargando') {
    return (
      <main className="center-screen">
        <p className="muted">Cargando…</p>
      </main>
    )
  }

  if (estado === 'no-existe') {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>Tablero no encontrado</h1>
          <p className="muted">Revisá que el enlace esté completo o pedile uno nuevo al director de juego.</p>
        </div>
      </main>
    )
  }

  if (estado === 'pidiendo-codigo' || estado === 'codigo-cambio') {
    return (
      <main className="center-screen">
        <form
          className="card narrow"
          onSubmit={(e) => {
            e.preventDefault()
            if (codigoInput.trim()) entrar(codigoInput)
          }}
        >
          <h1>Entrar al tablero</h1>
          {estado === 'codigo-cambio' && (
            <p className="notice">El director renovó el código. Pedile el nuevo para volver a entrar.</p>
          )}
          <label htmlFor="codigo">Código de acceso</label>
          <input
            id="codigo"
            className="input code-input"
            value={codigoInput}
            onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
            placeholder="Ej: A1B2C3"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={12}
            autoFocus
          />
          {error && <p className="error">{error}</p>}
          <button className="btn primary" type="submit" disabled={!codigoInput.trim()}>
            Entrar
          </button>
        </form>
      </main>
    )
  }

  if (estado === 'inactivo') {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>El tablero está en pausa</h1>
          <p className="muted">
            El director todavía no lo activó. Esta pantalla se actualiza sola cuando empiece.
          </p>
        </div>
      </main>
    )
  }

  return (
    <div className="player-screen">
      <header className="topbar">
        <strong>{nombre || 'Tablero'}</strong>
        <span className="badge">Solo lectura</span>
      </header>
      <BoardCanvas strokes={trazos} live={Object.values(enVivo)} canDraw={false} tool={{}} />
    </div>
  )
}
