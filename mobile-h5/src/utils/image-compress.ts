/**
 * 图片压缩工具
 * 将手机拍摄的大图压缩为合理尺寸
 */

/**
 * 压缩图片文件
 * @param file 原始图片文件
 * @param maxSize 最大边长，默认 1920px
 * @param quality JPEG 压缩质量 0-1，默认 0.8
 */
export async function compressImage(
  file: File,
  maxSize = 1920,
  quality = 0.8,
): Promise<File> {
  const originalSize = file.size
  try {
    // 先尝试按图片自带方向解码（修复微信/iOS 图片被旋转或解码异常的坑）
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      bitmap = await createImageBitmap(file)
    }
    const canvas = resizeCanvas(bitmap, maxSize)
    const blob = await canvasToBlob(canvas, quality)
    bitmap.close()
    canvas.width = 0
    canvas.height = 0

    // 压缩产物异常（如移动端把微信图压成 1x1 空白）时，回退使用原图，避免存成空白图
    if (!blob || blob.size === 0) return file
    const isTiny = originalSize > 50 * 1024 && blob.size < 3 * 1024
    if (isTiny) return file
    return new File([blob], file.name, { type: 'image/jpeg' })
  } catch {
    // 压缩失败（如浏览器不支持 createImageBitmap），直接用原图
    return file
  }
}

function resizeCanvas(bitmap: ImageBitmap, maxSize: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  let { width, height } = bitmap

  if (width > maxSize || height > maxSize) {
    if (width > height) {
      height = Math.round((height / width) * maxSize)
      width = maxSize
    }
    else {
      width = Math.round((width / height) * maxSize)
      height = maxSize
    }
  }

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob 失败'))
      },
      'image/jpeg',
      quality,
    )
  })
}
