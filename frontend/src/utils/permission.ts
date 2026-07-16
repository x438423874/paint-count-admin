import { useAuthStore } from '@/store/modules/auth';

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

/** 是否可审核工单（超管/门店管理员） */
export function canAudit(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可删除工单（超管/门店管理员） */
export function canDelete(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可使用一键OCR批量填充（超管/门店管理员） */
export function canBatchOcr(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可合并工单（超管/门店管理员） */
export function canMerge(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可结算/标记异常（超管/门店管理员） */
export function canSettle(): boolean {
  return hasRole('ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN');
}

/** 是否可编辑工单（除只读用户/财务外都可） */
export function canEdit(): boolean {
  return !hasRole('ROLE_VIEWER', 'ROLE_FINANCE');
}

/** 是否可管理门店（创建/编辑/删除门店，仅超管） */
export function canManageShop(): boolean {
  return isSuperAdmin();
}
