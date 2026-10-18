import { Link } from 'react-router-dom'
import { APP_VERSION } from '../lib/version.js'

export default function Inicio() {
  return (
    <main className="center-screen">
      <div className="card narrow">
        <h1>Tablero Virtual</h1>
        <p className="muted">
          Para entrar al tablero necesitás el enlace y el código de acceso que te
          pasa el director de juego.
        </p>
        <p className="small">
          <Link to="/admin">Soy el administrador</Link>
        </p>
        <p className="version">Versión {APP_VERSION}</p>
      </div>
    </main>
  )
}
