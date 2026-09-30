import crypto from 'node:crypto';

import { prisma } from '../helper';

/**
 * 喷漆业务种子：菜单 / 角色菜单 / Casbin 权限点。
 * 数据来源：生产库导出（2026-09），替代早期 PostgreSQL 方言的 add-*-menu.sql（MySQL 无法执行）。
 * 幂等：重复执行仅补齐缺失行。
 */

const PAINT_MENUS = [
    { id: 100, menuType: 'directory', menuName: 'paint', iconType: 1, icon: 'mdi:format-paint', routeName: 'paint', routePath: '/paint', component: 'layout.base', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 0, order: 5, i18nKey: 'route.paint', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 101, menuType: 'menu', menuName: 'paint_work-order', iconType: 1, icon: 'mdi:clipboard-text-outline', routeName: 'paint_work-order', routePath: '/paint/work-order', component: 'view.paint_work-order', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 1, i18nKey: 'route.paint_work-order', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 102, menuType: 'menu', menuName: 'paint_statistics', iconType: 1, icon: 'mdi:chart-bar', routeName: 'paint_statistics', routePath: '/paint/statistics', component: 'view.paint_statistics', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 2, i18nKey: 'route.paint_statistics', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 103, menuType: 'menu', menuName: 'paint_shop', iconType: 1, icon: 'mdi:store-outline', routeName: 'paint_shop', routePath: '/paint/shop', component: 'view.paint_shop', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 0, i18nKey: 'route.paint_shop', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 105, menuType: 'menu', menuName: 'paint_standard-template', iconType: 1, icon: 'mdi:file-document-outline', routeName: 'paint_standard-template', routePath: '/paint/standard-template', component: 'view.paint_standard-template', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 4, i18nKey: 'route.paint_standard-template', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 107, menuType: 'menu', menuName: 'paint_category', iconType: 1, icon: 'ic:round-category', routeName: 'paint_category', routePath: '/paint/category', component: 'view.paint_category', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 3, i18nKey: 'route.paint_category', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: 'system' },
    { id: 108, menuType: 'menu', menuName: 'paint_scheduled-task', iconType: 1, icon: 'mdi:timer-outline', routeName: 'paint_scheduled-task', routePath: '/paint/scheduled-task', component: 'view.paint_scheduled-task', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 6, i18nKey: 'route.paint_scheduled-task', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 109, menuType: 'menu', menuName: '工单对账', iconType: 1, icon: 'material-symbols:account-balance-wallet', routeName: 'paint_work-order_reconcile', routePath: '/paint/work-order/reconcile', component: 'view.paint_work-order_reconcile', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 7, i18nKey: 'route.paint_work-order_reconcile', keepAlive: true, constant: false, href: null, multiTab: false, createdBy: 'system' },
    { id: 110, menuType: 'menu', menuName: 'paint_vehicle', iconType: 1, icon: 'mdi:car-key', routeName: 'paint_vehicle', routePath: '/paint/vehicle', component: 'view.paint_vehicle', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 1, i18nKey: 'route.paint_vehicle', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 111, menuType: 'menu', menuName: 'paint_pending-image', iconType: 1, icon: 'mdi:image-multiple-outline', routeName: 'paint_pending-image', routePath: '/paint/pending-image', component: 'view.paint_pending-image', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 8, i18nKey: 'route.paint_pending-image', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 112, menuType: 'menu', menuName: 'paint_seal', iconType: 1, icon: 'mdi:lock-check', routeName: 'paint_seal', routePath: '/paint/seal', component: 'view.paint_seal', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 99, i18nKey: 'route.paint_seal', keepAlive: false, constant: false, href: null, multiTab: false, createdBy: '-1' },
    { id: 113, menuType: 'menu', menuName: 'paint_adjustment', iconType: 1, icon: 'mdi:calculator-variant', routeName: 'paint_adjustment', routePath: '/paint/adjustment', component: 'view.paint_adjustment', pathParam: null, status: 'ENABLED', activeMenu: null, hideInMenu: false, pid: 100, order: 7, i18nKey: 'route.paint_adjustment', keepAlive: true, constant: false, href: null, multiTab: false, createdBy: 'System' }
];

const PAINT_ROLE_MENUS: { roleId: string; menuId: number; domain: string }[] = [
    { roleId: '1', menuId: 100, domain: 'built-in' },
    { roleId: '1', menuId: 101, domain: 'built-in' },
    { roleId: '1', menuId: 102, domain: 'built-in' },
    { roleId: '1', menuId: 103, domain: 'built-in' },
    { roleId: '1', menuId: 105, domain: 'built-in' },
    { roleId: '1', menuId: 107, domain: 'built-in' },
    { roleId: '1', menuId: 108, domain: 'built-in' },
    { roleId: '1', menuId: 109, domain: 'built-in' },
    { roleId: '1', menuId: 110, domain: 'built-in' },
    { roleId: '1', menuId: 111, domain: 'built-in' },
    { roleId: '1', menuId: 112, domain: 'built-in' },
    { roleId: '1', menuId: 113, domain: 'built-in' },
    { roleId: '10', menuId: 109, domain: 'built-in' },
    { roleId: '10', menuId: 110, domain: 'built-in' },
    { roleId: '10', menuId: 111, domain: 'built-in' },
    { roleId: '10', menuId: 113, domain: 'built-in' },
    { roleId: '11', menuId: 109, domain: 'built-in' },
    { roleId: '11', menuId: 110, domain: 'built-in' },
    { roleId: '11', menuId: 111, domain: 'built-in' },
    { roleId: '11', menuId: 113, domain: 'built-in' },
    { roleId: '12', menuId: 109, domain: 'built-in' },
    { roleId: '12', menuId: 110, domain: 'built-in' },
    { roleId: '12', menuId: 111, domain: 'built-in' },
    { roleId: '12', menuId: 113, domain: 'built-in' },
    { roleId: '13', menuId: 109, domain: 'built-in' },
    { roleId: '13', menuId: 110, domain: 'built-in' },
    { roleId: '13', menuId: 111, domain: 'built-in' },
    { roleId: '13', menuId: 113, domain: 'built-in' },
    { roleId: '2', menuId: 100, domain: 'built-in' },
    { roleId: '2', menuId: 101, domain: 'built-in' },
    { roleId: '2', menuId: 102, domain: 'built-in' },
    { roleId: '2', menuId: 103, domain: 'built-in' },
    { roleId: '2', menuId: 105, domain: 'built-in' },
    { roleId: '2', menuId: 107, domain: 'built-in' },
    { roleId: '2', menuId: 108, domain: 'built-in' },
    { roleId: '2', menuId: 109, domain: 'built-in' },
    { roleId: '2', menuId: 110, domain: 'built-in' },
    { roleId: '2', menuId: 111, domain: 'built-in' },
    { roleId: '2', menuId: 112, domain: 'built-in' },
    { roleId: '2', menuId: 113, domain: 'built-in' },
    { roleId: '3', menuId: 100, domain: 'built-in' },
    { roleId: '3', menuId: 101, domain: 'built-in' },
    { roleId: '3', menuId: 102, domain: 'built-in' },
    { roleId: '3', menuId: 103, domain: 'built-in' },
    { roleId: '3', menuId: 105, domain: 'built-in' },
    { roleId: '3', menuId: 107, domain: 'built-in' },
    { roleId: '3', menuId: 108, domain: 'built-in' },
    { roleId: '3', menuId: 109, domain: 'built-in' },
    { roleId: '3', menuId: 110, domain: 'built-in' },
    { roleId: '3', menuId: 111, domain: 'built-in' },
    { roleId: '3', menuId: 112, domain: 'built-in' },
    { roleId: '3', menuId: 113, domain: 'built-in' }
];

const PAINT_CASBIN: { role: string; resource: string; action: string; domain: string }[] = [
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'assign', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'assign', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'assign', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'view-customer', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'view-customer', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'correct', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'correct', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:pending-image', action: 'correct', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'correct', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'create-order', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'create-order', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:pending-image', action: 'create-order', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'create-order', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'match', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'match', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:pending-image', action: 'match', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'match', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'retry', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'retry', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:pending-image', action: 'retry', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'retry', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:pending-image', action: 'upload', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:pending-image', action: 'upload', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:pending-image', action: 'upload', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:pending-image', action: 'upload', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:seal', action: 'read', domain: 'built-in' },
    { role: 'ROLE_FINANCE', resource: 'paint:seal', action: 'read', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:seal', action: 'read', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:seal', action: 'read', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:seal', action: 'seal', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:seal', action: 'seal', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:seal', action: 'seal', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:seal', action: 'unseal', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:seal', action: 'unseal', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:seal', action: 'unseal', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:statistics', action: 'export', domain: 'built-in' },
    { role: 'ROLE_FINANCE', resource: 'paint:statistics', action: 'export', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:statistics', action: 'export', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:statistics', action: 'export', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:vehicle', action: 'create', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:vehicle', action: 'create', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:vehicle', action: 'create', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:vehicle', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:vehicle', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:vehicle', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:vehicle', action: 'update', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:vehicle', action: 'update', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:vehicle', action: 'update', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'abnormal', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'abnormal', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'abnormal', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'audit', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'audit', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'audit', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'batch-create', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'batch-create', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'batch-create', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'batch-ocr', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'batch-ocr', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'batch-ocr', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'batch-settle', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'batch-settle', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'batch-settle', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'batch-unsettle', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'batch-unsettle', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'batch-unsettle', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'create', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'create', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:work-order', action: 'create', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'create', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'delete', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'import', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'import', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'import', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'items', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'items', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:work-order', action: 'items', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'items', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'merge', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'merge', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'merge', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'quick-create', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'quick-create', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:work-order', action: 'quick-create', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'quick-create', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'reconcile', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'reconcile', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'reconcile', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'settle', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'settle', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'settle', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'unaudit', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'unaudit', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'unaudit', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'unsettle', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'unsettle', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'unsettle', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'unvoid', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'unvoid', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'unvoid', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'update', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'update', domain: 'built-in' },
    { role: 'ROLE_SHOP_STAFF', resource: 'paint:work-order', action: 'update', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'update', domain: 'built-in' },
    { role: 'ROLE_ADMIN', resource: 'paint:work-order', action: 'void', domain: 'built-in' },
    { role: 'ROLE_SHOP_ADMIN', resource: 'paint:work-order', action: 'void', domain: 'built-in' },
    { role: 'ROLE_SUPER', resource: 'paint:work-order', action: 'void', domain: 'built-in' }
];

export const initPaint = async () => {
  // 1) 菜单（按 id upsert）
  for (const m of PAINT_MENUS) {
    const { createdAt: _c, updatedAt: _u, ...data } = m as any;
    await prisma.sysMenu.upsert({ where: { id: m.id }, update: {}, create: data });
  }

  // 2) 角色菜单（复合主键 upsert）
  const roles = await prisma.sysRole.findMany({ select: { id: true, code: true } });

  for (const rm of PAINT_ROLE_MENUS) {
    await prisma.sysRoleMenu.upsert({
      where: { roleId_menuId_domain: { roleId: rm.roleId, menuId: rm.menuId, domain: rm.domain } },
      update: {},
      create: rm,
    });
  }

  // 3) 按钮权限（芋道式）：每个权限点 → 按钮菜单行 + 角色绑定（原 casbin 策略已废弃）
  const PERM_PARENT: Record<string, number> = {
    'paint:work-order:view-customer': 101,
    'paint:work-order:reconcile': 109,
    'paint:statistics:export': 102,
    'paint:seal:read': 112,
    'paint:seal:seal': 112,
    'paint:seal:unseal': 112,
  };
  const RESOURCE_PARENT: Record<string, number> = {
    'paint:work-order': 101,
    'paint:vehicle': 110,
    'paint:pending-image': 111,
  };
  const RESOURCE_LABELS: Record<string, string> = {
    'paint:work-order': '工单',
    'paint:statistics': '统计',
    'paint:vehicle': '车辆',
    'paint:pending-image': '图片',
    'paint:seal': '封单',
  };
  const ACTION_LABELS: Record<string, string> = {
    create: '创建', 'quick-create': '快速建单', 'batch-create': '批量创建', 'batch-ocr': '批量OCR',
    update: '更新', delete: '删除', import: '导入', audit: '审核', unaudit: '反审核',
    settle: '结算', unsettle: '取消结算', 'batch-settle': '批量结算', 'batch-unsettle': '批量取消结算',
    merge: '合并', reconcile: '对账', abnormal: '异常标注', void: '作废', unvoid: '恢复作废',
    items: '项目明细', export: '导出', read: '查看', seal: '封单', unseal: '解封',
    upload: '上传', match: '匹配', assign: '归类', 'create-order': '补建工单', correct: '修正', retry: '重试',
  };

  const uniquePerms = [...new Set(PAINT_CASBIN.map((r: { resource: string; action: string }) => `${r.resource}:${r.action}`))];
  const buttonIdByPerm = new Map<string, number>();

  for (const perm of uniquePerms) {
    const parent = PERM_PARENT[perm] || RESOURCE_PARENT[perm.slice(0, perm.lastIndexOf(':'))];
    if (!parent) {
      console.warn('[paint] 无父菜单映射，跳过按钮：' + perm);
      continue;
    }
    const splitAt = perm.lastIndexOf(':');
    const resource = perm.slice(0, splitAt);
    const action = perm.slice(splitAt + 1);
    const menuName = `${RESOURCE_LABELS[resource] || resource}${ACTION_LABELS[action] || action}`;
    const routeName = 'btn_' + crypto.createHash('md5').update(perm).digest('hex').slice(0, 16);

    let menu = await prisma.sysMenu.findFirst({ where: { permission: perm } });
    if (!menu) {
      menu = await prisma.sysMenu.create({
        data: {
          menuType: 'button',
          menuName,
          permission: perm,
          routeName,
          routePath: '',
          component: '',
          status: 'ENABLED',
          pid: parent,
          order: 0,
          constant: false,
          createdBy: 'seed',
        },
      });
    }
    buttonIdByPerm.set(perm, menu.id);
  }

  let boundCount = 0;
  for (const rule of PAINT_CASBIN) {
    const perm = `${rule.resource}:${rule.action}`;
    const menuId = buttonIdByPerm.get(perm);
    const role = roles.find((r: { code: string }) => r.code === rule.role);
    if (!menuId || !role) continue;
    const bound = await prisma.sysRoleMenu.findFirst({
      where: { roleId: role.id, menuId, domain: rule.domain || 'built-in' },
    });
    if (!bound) {
      await prisma.sysRoleMenu.create({ data: { roleId: role.id, menuId, domain: rule.domain || 'built-in' } });
      boundCount++;
    }
  }
  console.log('[paint] 菜单 12、角色菜单 52、按钮 ' + uniquePerms.length + ' 个、新增绑定 ' + boundCount + ' 条');
};
