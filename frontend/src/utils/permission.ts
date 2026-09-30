import { ref } from 'vue';
import { useAuthStore } from '@/store/modules/auth';
import { getMyPerms } from '@/service/api/paint';

/**
 * 权限点缓存（响应式，会话级）：来自 GET /paint/user-shop/my-perms，
 * 与后端 PermGuard 共用同一注册表口径；加载失败/未就绪时回退角色码判断
 */
const permsCache = ref<string[] | null>(null);

/** 退出登录/切换账号后调用：清除权限点缓存，避免新账号沿用上一账号的按钮显隐 */
export function resetPermsCache(): void {
  permsCache.value = null;
}

/** 拉取当前用户权限点集合（登录/刷新后用户信息就绪时调用） */
export async function fetchMyPerms(): Promise<void> {
  // 已有权限数据时跳过（登录与刷新初始化可能各调一次），减少无效请求
  if (permsCache.value !== null) return;
  try {
    const res: any = await getMyPerms();
    const list = res?.data ?? res;
    permsCache.value = Array.isArray(list) ? list : [];
  } catch {
    permsCache.value = null;
  }
}

/** 是否拥有指定权限点 */
export function hasPerm(perm: string): boolean {
  return !!permsCache.value && permsCache.value.includes(perm);
}

/** 权限点是否已就绪（未就绪时 can* 函数回退角色码判断） */
function permReady(): boolean {
  return permsCache.value !== null;
}

/**
 * Web 后台权限判断工具
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
  const authStore = useAuthStore();
  const roles = authStore.userInfo.roles || [];
  return roleCodes.some(code => roles.includes(code));
}

/** 是否为超级管理员 */
export function isSuperAdmin(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER');
}

/** 是否为财务（看所有门店，只读） */
export function isFinance(): boolean {
  return hasRole('ROLE_FINANCE');
}

/** 是否可审核工单（权限点优先，角色码回退） */
export function canAudit(): boolean {
  if (permReady()) return hasPerm('paint:work-order:audit');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可删除工单（权限点优先，角色码回退） */
export function canDelete(): boolean {
  if (permReady()) return hasPerm('paint:work-order:delete');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可使用一键OCR批量填充（权限点优先，角色码回退） */
export function canBatchOcr(): boolean {
  if (permReady()) return hasPerm('paint:work-order:batch-ocr');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可合并工单（权限点优先，角色码回退） */
export function canMerge(): boolean {
  if (permReady()) return hasPerm('paint:work-order:merge');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可结算/取消结算/批量结算（权限点优先）：结算口径仅超级管理员操作 */
export function canSettle(): boolean {
  if (permReady()) return hasPerm('paint:work-order:settle');
  return isSuperAdmin();
}

/** 是否可标记/取消异常（权限点优先）：门店管理员默认未授权，仅超管回退 */
export function canAbnormal(): boolean {
  if (permReady()) return hasPerm('paint:work-order:abnormal');
  return isSuperAdmin();
}

/** 是否可导出工单 Excel（权限点优先，角色码回退） */
export function canExportWorkOrder(): boolean {
  if (permReady()) return hasPerm('paint:work-order:export');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可执行封单/解封（权限点优先）：超管专属敏感操作 */
export function canSealOperate(): boolean {
  if (permReady()) return hasPerm('paint:seal:seal');
  return isSuperAdmin();
}

/** 是否可导出统计数据（权限点优先，角色码回退） */
export function canExportStatistics(): boolean {
  if (permReady()) return hasPerm('paint:statistics:export');
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_FINANCE');
}

/** 车辆档案：新增/编辑/删除（权限点优先，未就绪时仅超管） */
export function canManageVehicle(): boolean {
  if (permReady()) return hasPerm('paint:vehicle:create');
  return isSuperAdmin();
}

export function canVehicleUpdate(): boolean {
  if (permReady()) return hasPerm('paint:vehicle:update');
  return isSuperAdmin();
}

export function canVehicleDelete(): boolean {
  if (permReady()) return hasPerm('paint:vehicle:delete');
  return isSuperAdmin();
}

/** 是否可编辑工单（权限点优先，角色码回退） */
export function canEdit(): boolean {
  if (permReady()) return hasPerm('paint:work-order:create');
  return !hasRole('ROLE_VIEWER', 'ROLE_FINANCE');
}

/** 是否可管理门店（创建/编辑/删除门店，仅超管） */
export function canManageShop(): boolean {
  return isSuperAdmin();
}
