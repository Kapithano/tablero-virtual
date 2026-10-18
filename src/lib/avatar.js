// Reduce la imagen que sube el jugador para que el avatar pese muy poco.
// Se recorta al centro en cuadrado, se achica a 128 x 128 px y se guarda como
// JPEG. Normalmente queda en 4-8 KB; el límite es ~22 KB.

export const AVATAR_PX = 128
const MAX_ORIGINAL = 15 * 1024 * 1024 // la foto original, antes de reducirla
const MAX_CARACTERES = 30000 // largo del texto resultante (≈ 22 KB)
const CALIDADES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]

function cargarImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolver(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rechazar(new Error('No se pudo leer la imagen. Probá con un JPG o PNG.'))
    }
    img.src = url
  })
}

export async function procesarAvatar(archivo) {
  if (!archivo || !archivo.type.startsWith('image/')) {
    throw new Error('El archivo no es una imagen.')
  }
  if (archivo.size > MAX_ORIGINAL) {
    throw new Error('La imagen original es demasiado grande (máximo 15 MB).')
  }

  const img = await cargarImagen(archivo)
  const lado = Math.min(img.naturalWidth, img.naturalHeight)
  if (!lado) throw new Error('No se pudo leer la imagen.')

  const sx = (img.naturalWidth - lado) / 2
  const sy = (img.naturalHeight - lado) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_PX
  canvas.height = AVATAR_PX
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff' // el JPEG no tiene transparencia
  ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, lado, lado, 0, 0, AVATAR_PX, AVATAR_PX)

  for (const calidad of CALIDADES) {
    const url = canvas.toDataURL('image/jpeg', calidad)
    if (url.length <= MAX_CARACTERES) return url
  }
  throw new Error('No se pudo reducir lo suficiente la imagen. Probá con otra.')
}
