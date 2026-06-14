import Tesseract from 'tesseract.js';

interface OcrResult {
  plateNumber: string;
  orderNo: string;
  rawText: string;
}

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 中国车牌正则：汉字+字母+5位字母数字（新能源6位）
const PLATE_REGEX = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]/;

// 工单号正则：字母+数字组合，常见格式如 P20240601001、WO-2024-001 等
const ORDER_NO_REGEX = /(?:工单[号编码]?[:\s]*)?([A-Za-z]{0,3}[-]?\d{6,})/;

let worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker('chi_sim+eng', undefined, {
      logger: () => {}
    });
  }
  return worker;
}

/**
 * 计算自适应阈值（Otsu 方法）
 * 根据图像直方图自动计算最佳二值化阈值，适应不同光照条件
 */
function otsuThreshold(grayValues: Uint8Array): number {
  const histogram = new Array(256).fill(0);
  for (const v of grayValues) {
    histogram[v]++;
  }

  const total = grayValues.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

/**
 * 图像预处理：灰度化 + 对比度增强 + 自适应二值化
 * 通过 Canvas 对图像进行预处理，提高 OCR 识别率
 */
function preprocessImage(source: HTMLImageElement | HTMLCanvasElement, region?: CropRegion): HTMLCanvasElement {
  const canvas = document.createElement('canvas');

  if (region) {
    canvas.width = region.width;
    canvas.height = region.height;
  } else {
    canvas.width = source.width;
    canvas.height = source.height;
  }

  const ctx = canvas.getContext('2d')!;

  // 绘制源图像（可能裁剪区域）
  if (region) {
    ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
  } else {
    ctx.drawImage(source, 0, 0);
  }

  // 灰度化
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const grayValues = new Uint8Array(canvas.width * canvas.height);

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grayValues[i / 4] = gray;
  }

  // 对比度增强
  const contrast = 1.5;
  for (let i = 0; i < grayValues.length; i++) {
    let val = contrast * (grayValues[i] - 128) + 128;
    grayValues[i] = Math.max(0, Math.min(255, Math.round(val)));
  }

  // 自适应二值化（Otsu 阈值）
  const threshold = otsuThreshold(grayValues);

  for (let i = 0; i < data.length; i += 4) {
    const val = grayValues[i / 4] > threshold ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * 将 File 加载为 HTMLImageElement
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/**
 * 从图片文件中识别车牌号和工单号（全图识别）
 */
export async function recognizeWorkOrderImage(file: File): Promise<OcrResult> {
  return recognizeFromRegion(file);
}

/**
 * 从图片指定区域识别（标记区域识别）
 * @param file 图片文件
 * @param region 标记的裁剪区域（相对于原图的像素坐标）
 */
export async function recognizeFromRegion(file: File, region?: CropRegion): Promise<OcrResult> {
  const img = await loadImage(file);
  const canvas = preprocessImage(img, region);

  // 释放 ObjectURL
  URL.revokeObjectURL(img.src);

  const w = await getWorker();

  // 针对车牌和工单号优化 Tesseract 参数
  await w.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK, // 单块文本模式，适合工单
  });

  const { data } = await w.recognize(canvas, {}, {
    text: true
  });

  const rawText = data.text || '';

  // 提取车牌号
  const plateMatch = rawText.match(PLATE_REGEX);
  const plateNumber = plateMatch ? plateMatch[0] : '';

  // 提取工单号
  const orderMatch = rawText.match(ORDER_NO_REGEX);
  const orderNo = orderMatch ? orderMatch[1] || orderMatch[0] : '';

  return { plateNumber, orderNo, rawText };
}

/**
 * 从 Canvas/Blob 识别（用于标记区域裁剪后的识别）
 */
export async function recognizeFromCanvas(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const w = await getWorker();

  await w.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE, // 单行模式，适合标记区域
  });

  const { data } = await w.recognize(canvas, {}, {
    text: true
  });

  const rawText = data.text || '';

  const plateMatch = rawText.match(PLATE_REGEX);
  const plateNumber = plateMatch ? plateMatch[0] : '';

  const orderMatch = rawText.match(ORDER_NO_REGEX);
  const orderNo = orderMatch ? orderMatch[1] || orderMatch[0] : '';

  return { plateNumber, orderNo, rawText };
}

/**
 * 裁剪图片指定区域并返回 Canvas（供标记区域使用）
 * region 坐标为原图像素坐标，displayWidth/Height 也应为原图尺寸
 */
export function cropImageRegion(
  imgElement: HTMLImageElement,
  region: CropRegion,
  displayWidth: number,
  displayHeight: number
): HTMLCanvasElement {
  // 计算显示尺寸与实际尺寸的比例
  const scaleX = imgElement.naturalWidth / displayWidth;
  const scaleY = imgElement.naturalHeight / displayHeight;

  const actualX = Math.round(region.x * scaleX);
  const actualY = Math.round(region.y * scaleY);
  const actualW = Math.round(region.width * scaleX);
  const actualH = Math.round(region.height * scaleY);

  return preprocessImage(imgElement, {
    x: actualX,
    y: actualY,
    width: actualW,
    height: actualH
  });
}

/**
 * 销毁 worker 释放资源
 */
export async function destroyOcrWorker() {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

export type { CropRegion };
