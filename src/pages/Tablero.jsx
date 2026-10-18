import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, configFaltante } from '../lib/supabase.js'
import { nombreCanal } from '../lib/drawing.js'
import BoardCanvas from '../components/BoardCanvas.jsx'
import TokenLayer from '../components/TokenLayer.jsx'
import { procesarAvatar } from '../lib/avatar.js'
import { crearIdentidad, leerIdentidad, upsertJugador, estiloAvatar, inicial } from '../lib/jugadores.js'
import { APP_VERSION } from '../lib/version.js'

const TITULO = 'Tablero Jugador'

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
  const [jugadores, setJugadores] = useState([])
  const [miId, setMiId] = useState(null)
  const [nombreForm, setNombreForm] = useState('')
  const [avatarNuevo, setAvatarNuevo] = useState(undefined) // undefined = sin cambios, '' = quitar
  const [avisoPersonaje, setAvisoPersonaje] = useState('')
  const [guardando, setGuardando] = useState(false)
  const canalRef = useRef(null)
  const miIdRef = useRef(null)

  const entrar = async (codigo, silencioso = false) => {
    setError('')
    if (!silencioso) setEstado('cargando')
    const ident = leerIdentidad(boardId)
    const { data, error: err } = await supabase.rpc('join_board', {
      p_board: boardId,
      p_code: codigo,
      p_player: ident?.id ?? null,
      p_secret: ident?.secret ?? null,
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
      const lista = data.players || []
      setJugadores(lista)
      miIdRef.current = ident?.id ?? null
      setMiId(ident?.id ?? null)
      const mio = lista.find((j) => j.id === ident?.id)
      if (mio) setNombreForm((actual) => actual || mio.name)
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
      .on('broadcast', { event: 'player' }, ({ payload }) => {
        // Un token ajeno que se oculta desaparece; el mío siempre lo veo (aunque esté oculto)
        if (payload.id !== miIdRef.current && payload.visible === false) {
          setJugadores((prev) => prev.filter((j) => j.id !== payload.id))
        } else {
          setJugadores((prev) => upsertJugador(prev, payload))
        }
      })
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        setJugadores((prev) =>
          prev.map((j) => (j.id === payload.id ? { ...j, x: payload.x, y: payload.y } : j))
        )
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

  const yo = jugadores.find((j) => j.id === miId) || null

  const enviar = (event, payload = {}) =>
    canalRef.current?.send({ type: 'broadcast', event, payload })

  const elegirAvatar = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setAvisoPersonaje('')
    try {
      setAvatarNuevo(await procesarAvatar(archivo))
    } catch (err) {
      setAvisoPersonaje(err.message || 'No se pudo usar esa imagen.')
    }
  }

  const guardarPersonaje = async (e) => {
    e.preventDefault()
    const nombreLimpio = nombreForm.trim()
    if (!nombreLimpio) return
    setGuardando(true)
    setAvisoPersonaje('')
    const ident = leerIdentidad(boardId) || crearIdentidad(boardId)
    const { data, error: err } = await supabase.rpc('save_player', {
      p_board: boardId,
      p_code: codigoOk,
      p_player: ident.id,
      p_secret: ident.secret,
      p_name: nombreLimpio,
      p_avatar: avatarNuevo === undefined ? null : avatarNuevo,
    })
    setGuardando(false)
    if (err || !data) {
      setAvisoPersonaje(
        (err?.message || '').includes('lleno')
          ? 'El tablero está lleno.'
          : 'No se pudo guardar. Probá de nuevo en unos segundos.'
      )
      return
    }
    miIdRef.current = data.id
    setMiId(data.id)
    setJugadores((prev) => upsertJugador(prev, data))
    setAvatarNuevo(undefined)
    setNombreForm(data.name)
    // Si mi token está oculto, los demás no deben recibir mis datos
    if (data.visible) enviar('player', data)
  }

  const cambiarVisibilidad = async () => {
    if (!yo) return
    await actualizarToken({ p_visible: !yo.visible })
  }

  // Mover u ocultar mi token (el servidor comprueba que sea realmente mío)
  const actualizarToken = async (cambios) => {
    const ident = leerIdentidad(boardId)
    if (!ident) return
    const { data, error: err } = await supabase.rpc('update_token', {
      p_board: boardId,
      p_code: codigoOk,
      p_player: ident.id,
      p_secret: ident.secret,
      ...cambios,
    })
    if (err || !data) {
      setAvisoPersonaje('No se pudo actualizar tu token.')
      return
    }
    setJugadores((prev) => upsertJugador(prev, data))
    enviar('player', data.visible ? data : { id: data.id, visible: false })
  }

  const puedeMover = (t) => t.id === miId
  const alMoverEnVivo = (id, x, y) => {
    if (yo?.visible) enviar('move', { id, x, y }) // oculto: no se avisa a los demás
  }
  const alSoltarToken = (id, x, y) => {
    setJugadores((prev) => prev.map((j) => (j.id === id ? { ...j, x, y } : j)))
    actualizarToken({ p_x: x, p_y: y })
  }

  const fotoActual = avatarNuevo === undefined ? yo?.avatar : avatarNuevo || null
  const hayCambios =
    nombreForm.trim() !== '' && (!yo || nombreForm.trim() !== yo.name || avatarNuevo !== undefined)

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
        <strong>{!nombre || nombre === 'Mi tablero' ? TITULO : nombre}</strong>
        <span className="badge">v{APP_VERSION}</span>
      </header>

      <div className="admin-body">
        <aside className="sidebar">
          <form className="panel-card" onSubmit={guardarPersonaje}>
            <h2>Tu personaje</h2>

            <div className="avatar-edit">
              <div
                className="avatar-bg avatar-preview"
                style={fotoActual ? estiloAvatar({ avatar: fotoActual }) : estiloAvatar({ id: miId || 'nuevo' })}
              >
                {!fotoActual && inicial(nombreForm)}
              </div>
              <div className="avatar-actions">
                <label className="btn small-btn file-btn">
                  {fotoActual ? 'Cambiar imagen' : 'Subir imagen'}
                  <input type="file" accept="image/*" onChange={elegirAvatar} hidden />
                </label>
                {fotoActual && (
                  <button type="button" className="btn small-btn" onClick={() => setAvatarNuevo('')}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
            <p className="hint">La imagen se reduce sola para que pese muy poco.</p>

            <label htmlFor="nombre-jugador">Nombre</label>
            <input
              id="nombre-jugador"
              className="input"
              value={nombreForm}
              onChange={(e) => setNombreForm(e.target.value)}
              maxLength={24}
              placeholder="Tu nombre"
              autoComplete="off"
            />

            {avisoPersonaje && <p className="error">{avisoPersonaje}</p>}

            <button className="btn primary full" type="submit" disabled={guardando || !hayCambios}>
              {guardando ? 'Guardando…' : yo ? 'Guardar cambios' : 'Crear mi token'}
            </button>
          </form>

          {yo && (
            <section className="panel-card">
              <h2>Mi token</h2>
              <div className="row between">
                <span className={`pill ${yo.visible ? 'on' : 'off'}`}>
                  {yo.visible ? 'Visible' : 'Oculto'}
                </span>
                <button className="btn small-btn" type="button" onClick={cambiarVisibilidad}>
                  {yo.visible ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <p className="hint">Arrastrá tu token por el tablero para moverlo.</p>
            </section>
          )}
        </aside>

        <main className="stage">
          <BoardCanvas strokes={trazos} live={Object.values(enVivo)} canDraw={false} tool={{}}>
            <TokenLayer
              tokens={jugadores}
              canMove={puedeMover}
              onLive={alMoverEnVivo}
              onCommit={alSoltarToken}
            />
          </BoardCanvas>
        </main>
      </div>
    </div>
  )
}
