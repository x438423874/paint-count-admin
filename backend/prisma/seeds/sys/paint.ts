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
  for (const rm of PAINT_ROLE_MENUS) {
    await prisma.sysRoleMenu.upsert({
      where: { roleId_menuId_domain: { roleId: rm.roleId, menuId: rm.menuId, domain: rm.domain } },
      update: {},
      create: rm,
    });
  }

  // 3) Casbin 权限点：先读已有键，再补齐缺失（表无唯一约束，不能 skipDuplicates）
  const existing = await prisma.casbinRule.findMany({
    where: { ptype: 'p', v1: { startsWith: 'paint:' } },
    select: { v0: true, v1: true, v2: true },
  });
  const keys = new Set(existing.map(r => r.v0 + '|' + r.v1 + '|' + r.v2));
  const missing = PAINT_CASBIN.filter((r: { role: string; resource: string; action: string }) => !keys.has(r.role + '|' + r.resource + '|' + r.action));
  if (missing.length > 0) {
    await prisma.casbinRule.createMany({
      data: missing.map(r => ({ ptype: 'p', v0: r.role, v1: r.resource, v2: r.action, v3: r.domain || 'built-in', v4: 'allow' })),
    });
  }
  console.log('[paint] 菜单 12、角色菜单 52、权限点补齐 ' + missing.length + '/' + 110);
};
