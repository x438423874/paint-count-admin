import { useUserStore } from '@/stores'
import { getMyPerms } from '@/api/paint'

/**
 * 权限点缓存（会话级）：来自 GET /paint/user-shop/my-perms，
 * 与后端 PermGuard 共用同一注册表口径；加载失败时回退角色码判断
 */
let permsCache: string[] | null = null

/** 拉取当前用户权限点集合（登录成功后 / 应用启动时调用） */
export async function fetchMyPerms(): Promise<void> {
  try {
    const res = await getMyPerms()
    permsCache = (res as any)?.data || (res as any) || []
    if (!Array.isArray(permsCache)) permsCache = []
  }
  catch {
    permsCache = null
  }
}

/** 是否拥有指定权限点 */
export function hasPerm(perm: string): boolean {
  return !!permsCache && permsCache.includes(perm)
}

/** 确保权限点已加载（路由守卫用：缓存未就绪时等待一次拉取；失败保持 null，由调用方宽松放行） */
export async function ensureMyPerms(): Promise<void> {
  if (permsCache === null)
    await fetchMyPerms()
}

/** 权限点未就绪时是否放行（宽松降级，后端 Casbin 兜底） */
function permReady(): boolean {
  return permsCache !== null
}

/** 权限点集合是否已成功加载（路由守卫用：false 时宽松放行页面，API 层兜底） */
export function isPermsReady(): boolean {
  return permReady()
}

/**
 * H5 端权限判断工具
 *
 * 角色体系：
 *  - ROLE_SUPER / R_SUPER     超级管理员（全部权限）
 *  - ROLE_SHOP_ADMIN          门店管理员（本门店全部权限，含审核/删除）
 *  - ROLE_SHOP_STAFF          门店员工（不能审核/删除/批量OCR）
 *  - ROLE_FINANCE             财务（仅查看，不应使用H5）
 *  - ROLE_VIEWER              只读用户（不能审核/删除/批量OCR/编辑）
 *  - ROLE_ADMIN / ROLE_USER   兼容旧角色
 */

/** 判断当前用户是否拥有指定角色之一 */
export function hasRole(...roleCodes: string[]): boolean {
  const userStore = useUserStore()
  const roles = userStore.userInfo.roles || []
  return roleCodes.some((code) => roles.includes(code))
}

/** 是否为超级管理员 */
export function isSuperAdmin(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER')
}

/** 是否为财务（看所有门店，只读） */
export function isFinance(): boolean {
  return hasRole('ROLE_FINANCE')
}

/** 是否可审核工单（权限点优先，角色码回退） */
export function canAudit(): boolean {
  if (permReady()) return hasPerm('paint:work-order:audit')
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN')
}

/** 是否可删除工单（权限点优先，角色码回退） */
export function canDelete(): boolean {
  if (permReady()) return hasPerm('paint:work-order:delete')
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN')
}

/** 是否可使用一键OCR批量填充（权限点优先，角色码回退） */
export function canBatchOcr(): boolean {
  if (permReady()) return hasPerm('paint:work-order:batch-ocr')
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN')
}

/** 是否可编辑工单（权限点优先，角色码回退） */
export function canEdit(): boolean {
  if (permReady()) return hasPerm('paint:work-order:create')
  return !hasRole('ROLE_VIEWER', 'ROLE_FINANCE')
}
