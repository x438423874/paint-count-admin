/**
 * 解析后端返回的图片相对路径（如 /uploads/...）为可访问的完整 URL。
 *
 * - 开发环境：VITE_APP_API_BASE_URL 为相对路径（/fg-api），/uploads 由 vite 代理转发，原样返回即可。
 * - 生产环境：VITE_APP_API_BASE_URL 为绝对地址（如 https://easyapi.devv.zone/api），
 *   H5 与 API 不同域，需要把 /uploads/... 前面拼上 API 的 origin，否则图片 404。
 *
 * /uploads 现为受控访问（登录 + 门店数据权限），<img> 无法携带请求头，
 * 统一追加 ?access_token= 查询参数，由后端 JwtStrategy 的查询参数提取器鉴权。
 */
import { STORAGE_TOKEN_KEY } from '@/stores/mutation-type'
import { useLocalStorage } from '@vueuse/core'

const apiBase = import.meta.env.VITE_APP_API_BASE_URL || ''
const tokenRef = useLocalStorage(STORAGE_TOKEN_KEY, '')

let apiOrigin = ''
if (/^https?:\/\//i.test(apiBase)) {
  try {
    apiOrigin = new URL(apiBase).origin
  } catch {
    apiOrigin = ''
  }
}

export function resolveImageUrl(url?: string | null): string {
  if (!url) return ''
  // 已是完整地址或 blob/data 预览地址，原样返回
  if (/^(https?:|blob:|data:)/i.test(url)) return url
  const token = tokenRef.value
  const auth = token ? `${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : ''
  if (apiOrigin && url.startsWith('/')) return `${apiOrigin}${url}${auth}`
  return `${url}${auth}`
}
