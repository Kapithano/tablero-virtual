import { useEffect, useRef, useState } from 'react'
import { supabase, configFaltante } from '../lib/supabase.js'
import { cargarTrazos, nombreCanal } from '../lib/drawing.js'
import BoardCanvas from '../components/BoardCanvas.jsx'
import TokenLayer from '../components/TokenLayer.jsx'
import { procesarAvatar } from '../lib/avatar.js'
import { upsertJugador, estiloAvatar, inicial } from '../lib/jugadores.js'
import { APP_VERSION } from '../lib/version.js'

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
    if (err) {
      const msg = (err.message || '').toLowerCase()
      if (msg.includes('invalid login credentials')) {
        setError('Email o contraseña incorrectos.')
      } else if (msg.includes('not confirmed')) {
        setError('Ese usuario no está confirmado. En Supabase: Authentication → Users → confirmá el usuario.')
      } else {
        setError('No se pudo ingresar. Detalle técnico: ' + (err.message || 'error desconocido'))
      }
    }
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
  const [jugadores, setJugadores] = useState([])
  const [tool, setTool] = useState({ color: COLORES[0], size: 6, eraser: false })
  const [aviso, setAviso] = useState('')
  const [copiado, setCopiado] = useState('')
  const [npcNombre, setNpcNombre] = useState('')
  const [npcAvatar, setNpcAvatar] = useState(null)
  const [creandoNpc, setCreandoNpc] = useState(false)
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
        const pj = await supabase
          .from('players')
          .select('id, name, avatar, x, y, visible, is_npc, dead')
          .eq('board_id', data.id)
          .order('created_at', { ascending: true })
        if (pj.error) throw pj.error
        if (!cancelado) {
          setBoard(data)
          setTrazos(t)
          setJugadores(pj.data || [])
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
    canal
      // Un jugador creó o cambió su personaje, o movió/ocultó su token
      .on('broadcast', { event: 'player' }, ({ payload }) => {
        setJugadores((prev) => upsertJugador(prev, payload))
      })
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        setJugadores((prev) =>
          prev.map((j) => (j.id === payload.id ? { ...j, x: payload.x, y: payload.y } : j))
        )
      })
      .subscribe()
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

  // ---- tokens: el director puede mover, ocultar y mostrar el de cualquiera ----
  const guardarToken = async (id, cambios) => {
    const { error } = await supabase.from('players').update(cambios).eq('id', id).eq('board_id', board.id)
    if (error) {
      setAviso('No se pudo actualizar el token.')
      return null
    }
    return true
  }

  const alMoverEnVivo = (id, x, y) => {
    const j = jugadores.find((p) => p.id === id)
    if (j?.visible) enviar('move', { id, x, y }) // oculto: no se avisa a los jugadores
    setJugadores((prev) => prev.map((p) => (p.id === id ? { ...p, x, y } : p)))
  }

  const alSoltarToken = async (id, x, y) => {
    const j = jugadores.find((p) => p.id === id)
    if (!j) return
    const nuevo = { ...j, x, y }
    setJugadores((prev) => upsertJugador(prev, nuevo))
    if (await guardarToken(id, { x, y }) && nuevo.visible) enviar('player', nuevo)
  }

  const alternarToken = async (j) => {
    const nuevo = { ...j, visible: !j.visible }
    if (!(await guardarToken(j.id, { visible: nuevo.visible }))) return
    setJugadores((prev) => upsertJugador(prev, nuevo))
    // Al ocultar, los demás solo reciben el id (no los datos del personaje)
    enviar('player', nuevo.visible ? nuevo : { id: j.id, visible: false })
  }

  // Avisa a los jugadores del estado de un token. Si está fuera del tablero u oculto,
  // solo reciben el id (para que lo quiten) y no los datos del personaje.
  const avisarToken = (t) =>
    enviar('player', t.visible ? t : { id: t.id, visible: false, dead: !!t.dead })

  const alternarMuerto = async (j) => {
    const nuevo = { ...j, dead: !j.dead }
    if (!(await guardarToken(j.id, { dead: nuevo.dead }))) return
    setJugadores((prev) => upsertJugador(prev, nuevo))
    avisarToken(nuevo)
  }

  // ---- PNJ: personajes que solo maneja el director ----
  const elegirAvatarNpc = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    try {
      setNpcAvatar(await procesarAvatar(archivo))
    } catch (err) {
      setAviso(err.message || 'No se pudo usar esa imagen.')
    }
  }

  const crearNpc = async (e) => {
    e.preventDefault()
    const nombre = npcNombre.trim()
    if (!nombre) return
    setCreandoNpc(true)
    const fila = {
      id: crypto.randomUUID(),
      board_id: board.id,
      secret_hash: '', // vacío: ningún jugador puede manejar este token
      name: nombre.slice(0, 24),
      avatar: npcAvatar || null,
      is_npc: true,
      visible: false, // nace en la lista PNJ; el director lo agrega al tablero cuando quiere
    }
    const { data, error } = await supabase
      .from('players')
      .insert(fila)
      .select('id, name, avatar, x, y, visible, is_npc, dead')
      .single()
    setCreandoNpc(false)
    if (error || !data) {
      setAviso('No se pudo crear el PNJ. ¿Ejecutaste el SQL de la versión 0.3.0 en Supabase?')
      return
    }
    setJugadores((prev) => [...prev, data])
    setNpcNombre('')
    setNpcAvatar(null)
  }

  // Agregar un PNJ al tablero o quitarlo (sigue guardado en la lista PNJ)
  const alternarNpcEnTablero = async (j) => {
    const entra = !j.visible
    const cambios = { visible: entra }
    if (entra) {
      // Lo acomoda cerca del centro, sin apilarlo sobre los que ya están
      const n = jugadores.filter((p) => p.is_npc && p.visible).length
      cambios.x = 700 + (n % 8) * 50
      cambios.y = 450 + (Math.floor(n / 8) % 4) * 50
    }
    if (!(await guardarToken(j.id, cambios))) return
    const nuevo = { ...j, ...cambios }
    setJugadores((prev) => upsertJugador(prev, nuevo))
    avisarToken(nuevo)
  }

  const eliminarNpc = async (j) => {
    if (!window.confirm(`¿Eliminar a "${j.name}" de la lista de PNJ? No se puede deshacer.`)) return
    const { error } = await supabase.from('players').delete().eq('id', j.id).eq('board_id', board.id)
    if (error) {
      setAviso('No se pudo eliminar el PNJ.')
      return
    }
    setJugadores((prev) => prev.filter((p) => p.id !== j.id))
    if (j.visible) enviar('player', { id: j.id, visible: false })
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

  // Los PNJ fuera del tablero no se dibujan ni aparecen en "Tokens Activos"
  const enTablero = jugadores.filter((j) => !j.is_npc || j.visible)
  const tokensActivos = [
    ...enTablero.filter((j) => !j.is_npc),
    ...enTablero.filter((j) => j.is_npc),
  ]
  const listaNpc = jugadores.filter((j) => j.is_npc)

  return (
    <div className="admin-layout">
      <header className="topbar">
        <strong>Tablero Virtual · Director</strong>
        <div className="row gap">
          <span
            className={`pill ${board.active ? 'on' : 'off'}`}
            title={
              board.active
                ? 'Los jugadores con el enlace y el código pueden ver el tablero.'
                : 'Los jugadores no pueden entrar. Vos podés dibujar igual.'
            }
          >
            {board.active ? 'Activado' : 'Desactivado'}
          </span>
          <button className="btn small-btn" onClick={alternarActivo}>
            {board.active ? 'Desactivar' : 'Activar'}
          </button>
          <span className="version">v{APP_VERSION}</span>
          <button className="btn small-btn" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="admin-body">
        <aside className="sidebar">
          {aviso && (
            <p className="error boxed" onClick={() => setAviso('')}>
              {aviso} <span className="muted">(tocá para cerrar)</span>
            </p>
          )}

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

          <section className="panel-card">
            <h2>Tokens Activos</h2>
            {tokensActivos.length === 0 ? (
              <p className="hint" style={{ marginTop: 0 }}>
                Cuando un jugador cree su personaje o agregues un PNJ al tablero, va a aparecer acá.
              </p>
            ) : (
              <ul className="player-list">
                {tokensActivos.map((j) => (
                  <li key={j.id} className={`player-item ${j.visible ? '' : 'oculto'} ${j.dead ? 'muerto' : ''}`}>
                    <div className="avatar-bg" style={estiloAvatar(j)}>
                      {!j.avatar && inicial(j.name)}
                    </div>
                    <span className="player-name">
                      {j.name}
                      {j.is_npc && <span className="tag-pnj">PNJ</span>}
                    </span>
                    <div className="item-actions">
                      {j.is_npc ? (
                        <button className="btn small-btn" onClick={() => alternarNpcEnTablero(j)}>
                          Quitar
                        </button>
                      ) : (
                        <button className="btn small-btn" onClick={() => alternarToken(j)}>
                          {j.visible ? 'Ocultar' : 'Mostrar'}
                        </button>
                      )}
                      <button className="btn small-btn danger" onClick={() => alternarMuerto(j)}>
                        {j.dead ? 'Revivir' : 'Muerto'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="hint">Arrastrá cualquier token sobre el tablero para moverlo.</p>
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
        </aside>

        <main className="stage">
          <BoardCanvas
            strokes={trazos}
            canDraw
            tool={herramienta}
            onLive={alDibujarEnVivo}
            onCommit={alTerminarTrazo}
          >
            <TokenLayer
              tokens={enTablero}
              canMove={() => true}
              onLive={alMoverEnVivo}
              onCommit={alSoltarToken}
            />
          </BoardCanvas>

          <section className="panel-card npc-card">
            <h2>PNJ</h2>
            <form className="npc-form" onSubmit={crearNpc}>
              <div
                className="avatar-bg npc-preview"
                style={npcAvatar ? estiloAvatar({ avatar: npcAvatar }) : estiloAvatar({ id: 'nuevo-pnj' })}
              >
                {!npcAvatar && inicial(npcNombre)}
              </div>
              <input
                className="input npc-name"
                value={npcNombre}
                onChange={(e) => setNpcNombre(e.target.value)}
                maxLength={24}
                placeholder="Nombre del PNJ"
                autoComplete="off"
              />
              <label className="btn small-btn file-btn">
                {npcAvatar ? 'Cambiar imagen' : 'Subir imagen'}
                <input type="file" accept="image/*" onChange={elegirAvatarNpc} hidden />
              </label>
              {npcAvatar && (
                <button type="button" className="btn small-btn" onClick={() => setNpcAvatar(null)}>
                  Quitar imagen
                </button>
              )}
              <button className="btn small-btn primary" type="submit" disabled={creandoNpc || !npcNombre.trim()}>
                {creandoNpc ? 'Creando…' : 'Crear PNJ'}
              </button>
            </form>

            {listaNpc.length === 0 ? (
              <p className="hint">Todavía no creaste ningún PNJ. Solo vos podés ver y mover esta lista.</p>
            ) : (
              <ul className="player-list npc-list">
                {listaNpc.map((j) => (
                  <li key={j.id} className="player-item">
                    <div className="avatar-bg" style={estiloAvatar(j)}>
                      {!j.avatar && inicial(j.name)}
                    </div>
                    <span className="player-name">
                      {j.name}
                      <span className={`tag-pnj ${j.visible ? 'en' : ''}`}>{j.visible ? 'En el tablero' : 'Fuera'}</span>
                    </span>
                    <div className="item-actions">
                      <button className="btn small-btn" onClick={() => alternarNpcEnTablero(j)}>
                        {j.visible ? 'Quitar del tablero' : 'Agregar al tablero'}
                      </button>
                      <button className="btn small-btn danger" onClick={() => eliminarNpc(j)}>
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}
