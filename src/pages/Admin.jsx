import { useEffect, useRef, useState } from 'react'
import { supabase, configFaltante } from '../lib/supabase.js'
import { cargarTrazos, nombreCanal } from '../lib/drawing.js'
import BoardCanvas from '../components/BoardCanvas.jsx'

const COLORES = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed']
const GROSORES = [
  { etiqueta: 'Fino', valor: 3 },
  { etiqueta: 'Medio', valor: 6 },
  { etiqueta: 'Grueso', valor: 12 },
  { etiqueta: 'Extra', valor: 24 },
]

export default function Admin() {
  const [session, setSession] = useState(null)
  const [listo, setListo] = useState(false)

  useEffect(() => {
    if (configFaltante) {
      setListo(true)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setListo(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (configFaltante) {
    return (
      <main className="center-screen">
        <div className="card narrow">
          <h1>Falta configurar</h1>
          <p className="muted">
            No se encontraron las variables <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>. Revisá la guía de instalación.
          </p>
        </div>
      </main>
    )
  }

  if (!listo) {
    return (
      <main className="center-screen">
        <p className="muted">Cargando…</p>
      </main>
    )
  }

  if (!session) return <Login />
  return <Panel user={session.user} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  const ingresar = async (e) => {
    e.preventDefault()
    setError('')
    setEnviando(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password: clave })
    setEnviando(false)
    if (err) setError('Email o contraseña incorrectos.')
  }

  return (
    <main className="center-screen">
      <form className="card narrow" onSubmit={ingresar}>
        <h1>Panel del director</h1>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <label htmlFor="clave">Contraseña</label>
        <input
          id="clave"
          type="password"
          className="input"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" type="submit" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  )
}

function Panel({ user }) {
  const [board, setBoard] = useState(null)
  const [trazos, setTrazos] = useState([])
  const [tool, setTool] = useState({ color: COLORES[0], size: 6, eraser: false })
  const [aviso, setAviso] = useState('')
  const [copiado, setCopiado] = useState('')
  const canalRef = useRef(null)

  // Cargar (o crear la primera vez) el tablero del administrador
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        const buscar = () =>
          supabase.from('boards').select('*').eq('owner_id', user.id).maybeSingle()

        let { data, error } = await buscar()
        if (error) throw error

        if (!data) {
          const r = await supabase.from('boards').insert({ owner_id: user.id }).select().single()
          if (r.error) {
            // Puede pasar si otra carga lo creó justo antes: volvemos a buscar
            const otra = await buscar()
            if (otra.error || !otra.data) throw r.error
            data = otra.data
          } else {
            data = r.data
          }
        }

        const t = await cargarTrazos(supabase, data.id)
        if (!cancelado) {
          setBoard(data)
          setTrazos(t)
        }
      } catch (e) {
        if (!cancelado) {
          setAviso('No se pudo cargar el tablero. ¿Ejecutaste el SQL de Supabase? (' + (e.message || 'error') + ')')
        }
      }
    })()
    return () => {
      cancelado = true
    }
  }, [user.id])

  // Canal en tiempo real: cambia cuando se renueva el código
  useEffect(() => {
    if (!board) return
    const canal = supabase.channel(nombreCanal(board.id, board.access_code))
    canal.subscribe()
    canalRef.current = canal
    return () => {
      supabase.removeChannel(canal)
      canalRef.current = null
    }
  }, [board?.id, board?.access_code])

  const enviar = (event, payload = {}) =>
    canalRef.current?.send({ type: 'broadcast', event, payload })

  const alDibujarEnVivo = (trazo) => enviar('live', trazo)

  const alTerminarTrazo = (trazo) => {
    setTrazos((prev) => [...prev, trazo])
    enviar('stroke', trazo)
    supabase
      .from('strokes')
      .insert({ board_id: board.id, data: trazo })
      .then(({ error }) => {
        if (error) setAviso('No se pudo guardar el último trazo. Los jugadores lo ven, pero se perdería al recargar.')
      })
  }

  const deshacer = async () => {
    const ultimo = trazos[trazos.length - 1]
    if (!ultimo) return
    setTrazos((prev) => prev.slice(0, -1))
    enviar('undo', { id: ultimo.id })
    const { error } = await supabase
      .from('strokes')
      .delete()
      .eq('board_id', board.id)
      .eq('data->>id', ultimo.id)
    if (error) setAviso('No se pudo deshacer en la base de datos.')
  }

  const borrarTodo = async () => {
    if (!window.confirm('¿Borrar todo el dibujo? No se puede deshacer.')) return
    setTrazos([])
    enviar('clear')
    const { error } = await supabase.from('strokes').delete().eq('board_id', board.id)
    if (error) setAviso('No se pudo borrar en la base de datos.')
  }

  const alternarActivo = async () => {
    const nuevo = !board.active
    const { error } = await supabase.from('boards').update({ active: nuevo }).eq('id', board.id)
    if (error) {
      setAviso('No se pudo cambiar el estado del tablero.')
      return
    }
    setBoard((b) => ({ ...b, active: nuevo }))
    enviar('state', { active: nuevo })
  }

  const renovarCodigo = async () => {
    if (!window.confirm('Al renovar el código, los jugadores conectados saldrán y necesitarán el nuevo. ¿Continuar?')) return
    const { data: nuevo, error } = await supabase.rpc('renew_code', { p_board: board.id })
    if (error || !nuevo) {
      setAviso('No se pudo renovar el código.')
      return
    }
    // Avisamos en el canal viejo antes de pasar al nuevo
    try {
      await canalRef.current?.send({ type: 'broadcast', event: 'closed', payload: {} })
    } catch {
      /* si falla el aviso, igual el código viejo ya no sirve */
    }
    setBoard((b) => ({ ...b, access_code: nuevo }))
  }

  const copiar = async (clave, texto) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(clave)
      setTimeout(() => setCopiado(''), 1800)
    } catch {
      setAviso('No se pudo copiar automáticamente. Seleccioná el texto y copialo a mano.')
    }
  }

  const cerrarSesion = () => supabase.auth.signOut()

  if (!board) {
    return (
      <main className="center-screen">
        {aviso ? (
          <div className="card narrow">
            <h1>Algo salió mal</h1>
            <p className="error">{aviso}</p>
            <button className="btn" onClick={cerrarSesion}>
              Cerrar sesión
            </button>
          </div>
        ) : (
          <p className="muted">Cargando tablero…</p>
        )}
      </main>
    )
  }

  const enlace = `${window.location.origin}/t/${board.id}`
  const herramienta = { ...tool, size: tool.eraser ? tool.size * 3 : tool.size }

  return (
    <div className="admin-layout">
      <header className="topbar">
        <strong>Tablero Virtual · Director</strong>
        <button className="btn small-btn" onClick={cerrarSesion}>
          Cerrar sesión
        </button>
      </header>

      <div className="admin-body">
        <aside className="sidebar">
          <section className="panel-card">
            <h2>Estado</h2>
            <div className="row between">
              <span className={`pill ${board.active ? 'on' : 'off'}`}>
                {board.active ? 'Activado' : 'Desactivado'}
              </span>
              <button className="btn" onClick={alternarActivo}>
                {board.active ? 'Desactivar' : 'Activar'}
              </button>
            </div>
            <p className="hint">
              {board.active
                ? 'Los jugadores con el enlace y el código pueden ver el tablero.'
                : 'Los jugadores no pueden entrar. Vos podés dibujar igual.'}
            </p>
          </section>

          <section className="panel-card">
            <h2>Acceso</h2>
            <label>Enlace para los jugadores</label>
            <div className="copy-row">
              <input className="input" readOnly value={enlace} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => copiar('enlace', enlace)}>
                {copiado === 'enlace' ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
            <label>Código de acceso</label>
            <div className="copy-row">
              <input className="input code-input" readOnly value={board.access_code} />
              <button className="btn" onClick={() => copiar('codigo', board.access_code)}>
                {copiado === 'codigo' ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
            <button className="btn full" onClick={renovarCodigo}>
              Renovar código
            </button>
          </section>

          <section className="panel-card">
            <h2>Dibujo</h2>
            <label>Color</label>
            <div className="swatches">
              {COLORES.map((c) => (
                <button
                  key={c}
                  className={`swatch ${!tool.eraser && tool.color === c ? 'sel' : ''}`}
                  style={{ background: c }}
                  aria-label={`Color ${c}`}
                  onClick={() => setTool((t) => ({ ...t, color: c, eraser: false }))}
                />
              ))}
            </div>
            <label>Grosor</label>
            <div className="seg">
              {GROSORES.map((g) => (
                <button
                  key={g.valor}
                  className={`seg-btn ${tool.size === g.valor ? 'sel' : ''}`}
                  onClick={() => setTool((t) => ({ ...t, size: g.valor }))}
                >
                  {g.etiqueta}
                </button>
              ))}
            </div>
            <div className="row gap">
              <button
                className={`btn grow ${tool.eraser ? 'primary' : ''}`}
                onClick={() => setTool((t) => ({ ...t, eraser: !t.eraser }))}
              >
                Borrador
              </button>
              <button className="btn grow" onClick={deshacer} disabled={trazos.length === 0}>
                Deshacer
              </button>
            </div>
            <button className="btn danger full" onClick={borrarTodo} disabled={trazos.length === 0}>
              Borrar todo
            </button>
          </section>

          {aviso && (
            <p className="error boxed" onClick={() => setAviso('')}>
              {aviso} <span className="muted">(tocá para cerrar)</span>
            </p>
          )}
        </aside>

        <main className="stage">
          <BoardCanvas
            strokes={trazos}
            canDraw
            tool={herramienta}
            onLive={alDibujarEnVivo}
            onCommit={alTerminarTrazo}
          />
        </main>
      </div>
    </div>
  )
}
