import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configFaltante = !url || !anonKey

// Si faltan las variables, usamos valores de relleno para que la app cargue
// y pueda mostrar un mensaje claro en lugar de una pantalla en blanco.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'sin-configurar'
)
