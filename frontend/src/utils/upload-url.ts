import { localStg } from '@/utils/storage';

/**
 * 上传文件的受控访问 URL。
 *
 * 后端 /uploads 已改为鉴权访问（登录 + 门店数据权限），<img> 标签无法携带 Authorization 请求头，因此统一走 /proxy-demo 代理并追加 access_token 查询参数。 后端通过
 * JwtStrategy 的查询参数提取器完成鉴权。
 */
export function resolveUploadUrl(url?: string | null): string {
  if (!url || /^(https?:|blob:|data:)/i.test(url)) return url || '';
  const token = localStg.get('token') || '';
  const sep = url.includes('?') ? '&' : '?';
  return `/proxy-demo${url}${sep}access_token=${encodeURIComponent(token)}`;
}
