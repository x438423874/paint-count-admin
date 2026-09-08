import { request } from '../../request';
import type { UserBoundShop } from './types';

// ==================== 用户-门店绑定 API（数据权限） ====================

/** 获取指定用户绑定的门店列表（仅超管可用） */
export function fetchUserBoundShops(userId: string) {
  return request<UserBoundShop[]>({
    url: `/paint/user-shop/user/${userId}`,
    method: 'get'
  });
}

/** 设置指定用户绑定的门店（仅超管可用，全量覆盖） 移除的门店自动离岗留痕；重新勾选视为重新上岗； startAtMap：新上岗门店的自定义在岗开始时间（ISO 字符串，key 为 shopId），用于回填历史日期 */
export function bindUserShops(userId: string, shopIds: string[], startAtMap?: Record<string, string>) {
  return request({
    url: `/paint/user-shop/user/${userId}`,
    method: 'put',
    data: { shopIds, startAtMap }
  });
}

/** 获取当前用户权限点集合（按钮显隐与后端 PermGuard 共用同一注册表口径） */
export function getMyPerms() {
  return request({
    url: '/paint/user-shop/my-perms',
    method: 'get'
  });
}

/** 调整指定门店绑定的在岗期（仅超管用：回填历史开始时间 / 设置离岗时间） */
// eslint-disable-next-line max-params -- userId/shopId/startAt/endAt 与后端 PUT 语义一一对应
export function updateUserShopTenure(userId: string, shopId: string, startAt: string, endAt?: string | null) {
  return request({
    url: `/paint/user-shop/user/${userId}/tenure`,
    method: 'put',
    data: { shopId, startAt, endAt: endAt ?? null }
  });
}
