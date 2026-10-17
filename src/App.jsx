import { Routes, Route } from 'react-router-dom'
import Inicio from './pages/Inicio.jsx'
import Admin from './pages/Admin.jsx'
import Tablero from './pages/Tablero.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/t/:boardId" element={<Tablero />} />
      <Route path="*" element={<Inicio />} />
    </Routes>
  )
}
