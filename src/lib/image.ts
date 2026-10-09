/**
 * Reduz a foto da câmera (3–8 MB) para JPEG de até 1600px (~250–400 KB).
 * Sem isso, 20 fotos estouram a cota do IndexedDB no iOS e o upload no 4G fica lento.
 */
export async function comprimirImagem(file: Blob, maxLado = 1600, qualidade = 0.78): Promise<Blob> {
  let bitmap: ImageBitmap | HTMLImageElement
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    bitmap = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image()
      img.onload = () => res(img)
      img.onerror = rej
      img.src = URL.createObjectURL(file)
    })
  }
  const w = bitmap.width, h = bitmap.height
  const escala = Math.min(1, maxLado / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * escala)
  canvas.height = Math.round(h * escala)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  if ('close' in bitmap) bitmap.close()
  const out = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', qualidade))
  return out && out.size < file.size ? out : file
}
