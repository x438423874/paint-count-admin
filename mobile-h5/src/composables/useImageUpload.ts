import { compressImage } from '@/utils/image-compress'

/**
 * 图片上传共享流程：压缩 → 上传（429/5xx 自动重试）→ 失败信息映射
 *
 * 原先 create（批量带重试）/ detail（保存时静默逐张）/ pending-image
 * （列表上传）各自一份"压缩后上传"循环，重试与错误文案只有 create 有，
 * 其余页面失败原因不透明。此处统一后所有上传路径获得一致的重试与提示口径。
 */

export interface UploadRetryOptions {
  /** 最大重试次数，默认 2 */
  maxRetry?: number
  /** 重试间隔毫秒，默认 2000 */
  retryDelay?: number
}

export interface UploadAttemptResult {
  ok: boolean
  /** 压缩后的文件，供调用方复用（如重放、展示） */
  file?: File
  error?: any
}

function statusOf(err: any): number | undefined {
  return err?.response?.status || err?.statusCode
}

/** 是否值得重试：429 限流或 5xx 服务端错误（401 未登录、400 参数错误不重试） */
export function isRetryableUploadError(err: any): boolean {
  const status = statusOf(err)
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * 压缩并上传单个文件，429/5xx 自动重试。
 * @param file 原始图片文件
 * @param doUpload 接收压缩后的 File 完成实际上传
 * @param options 重试配置（maxRetry 最大重试次数默认 2，retryDelay 重试间隔毫秒默认 2000）
 */
export async function uploadCompressed(
  file: File,
  doUpload: (compressed: File) => Promise<unknown>,
  options: UploadRetryOptions = {},
): Promise<UploadAttemptResult> {
  const { maxRetry = 2, retryDelay = 2000 } = options
  const compressed = await compressImage(file)
  for (let attempt = 0; ; attempt++) {
    try {
      await doUpload(compressed)
      return { ok: true, file: compressed }
    }
    catch (err) {
      if (isRetryableUploadError(err) && attempt < maxRetry) {
        await new Promise(r => setTimeout(r, retryDelay))
        continue
      }
      return { ok: false, file: compressed, error: err }
    }
  }
}

/** 将上传错误映射为用户可读文案（与批量上传结果弹窗的提示口径一致） */
export function describeUploadError(err: any): string {
  const status = statusOf(err)
  const responseMsg = err?.response?.data?.message || err?.response?.data?.error?.message || err?.response?.data?.msg
  if (status === 429)
    return '请求过于频繁，已重试仍失败'
  if (status === 401)
    return '登录已过期，请重新登录'
  if (status >= 500)
    return `服务器错误(${status})`
  return responseMsg || err?.message || '上传失败'
}

/** 拉取网络图片并转为 File（对已有工单图重新 OCR 时使用） */
export async function fetchImageAsFile(url: string): Promise<File> {
  const resp = await fetch(url)
  if (!resp.ok)
    throw new Error('获取图片失败')
  const blob = await resp.blob()
  return new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' })
}
