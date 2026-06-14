interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

interface DualImageResult {
  hd: File;       // 高清版：2560px / 0.92质量，约800KB-1.2MB，用于OCR+存档
  thumbnail: File; // 缩略版：1280px / 0.8质量，约150-300KB，用于列表展示
}

/**
 * 加载图片文件为 HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('图片加载失败'));
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * 缩放+压缩（异步，基于 toBlob）
 */
function resizeAndCompress(
  img: HTMLImageElement,
  originalFile: File,
  maxWidth: number,
  maxHeight: number,
  quality: number,
  mimeType?: string
): Promise<File> {
  return new Promise(resolve => {
    let targetW = img.naturalWidth;
    let targetH = img.naturalHeight;

    if (targetW > maxWidth || targetH > maxHeight) {
      const scale = Math.min(maxWidth / targetW, maxHeight / targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outputType = mimeType || originalFile.type || 'image/jpeg';

    canvas.toBlob(
      blob => {
        if (!blob || blob.size >= originalFile.size) {
          resolve(originalFile);
          return;
        }
        resolve(new File([blob], originalFile.name, { type: outputType }));
      },
      outputType,
      quality
    );
  });
}

/**
 * 压缩图片文件（单图）
 */
export async function compressImage(file: File, options: CompressOptions = {}): Promise<File> {
  const { maxWidth = 1920, maxHeight = 1080, quality = 0.8, mimeType } = options;
  try {
    const img = await loadImage(file);
    return resizeAndCompress(img, file, maxWidth, maxHeight, quality, mimeType);
  } catch {
    return file;
  }
}

/**
 * 生成双图：高清版 + 缩略版
 * 高清版：2560px宽度、0.92质量 → 约800KB-1.2MB，OCR识别率接近原图
 * 缩略版：1280px宽度、0.8质量 → 约150-300KB，列表展示快速加载
 */
export async function compressDualImage(file: File): Promise<DualImageResult> {
  try {
    const img = await loadImage(file);
    const [hd, thumbnail] = await Promise.all([
      resizeAndCompress(img, file, 2560, 1440, 0.92),
      resizeAndCompress(img, file, 1280, 720, 0.8)
    ]);
    return { hd, thumbnail };
  } catch {
    return { hd: file, thumbnail: file };
  }
}
