import { localStg } from '@/utils/storage';

/**
 * 上传文件的受控访问 URL。
 *
 * 后端 /uploads 为鉴权访问（登录 + 门店数据权限），<img> 标签无法携带 Authorization 请求头，
 * 因此在同源 /uploads 路径后追加 access_token 查询参数，
 * 后端通过 JwtStrategy 的查询参数提取器完成鉴权。
 * （生产 nginx 将 /uploads 反代到后端；本地 dev 由 vite 代理 /uploads 到后端服务）
 */
export function resolveUploadUrl(url?: string | null): string {
  if (!url || /^(https?:|blob:|data:)/i.test(url)) return url || '';
  const token = localStg.get('token') || '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}
