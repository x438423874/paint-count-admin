import crypto from 'node:crypto';

import { prisma } from '../helper';

/**
 * 系统级按钮权限种子（芋道式：权限点 = sys_menu 的按钮行 + sys_role_menu 绑定）。
 * 原 casbin_rule 种子已废弃（casbin 存储层移除）。
 */

/** 权限标识 → 所属菜单 id */
const PERM_PARENT: Record<string, number> = {
  'authorization:assign-users': 63,
  'authorization:assign-routes': 63,
  'authorization:assign-permission': 63,
  'api-endpoint:read': 63,
  'login-log:read': 71,
  'operation-log:read': 72,
};

/** 权限标识 → 按钮中文名 */
const PERM_NAMES: Record<string, string> = {
  'authorization:assign-users': '授权分配用户角色',
  'authorization:assign-routes': '授权分配菜单',
  'authorization:assign-permission': '授权分配API权限',
  'api-endpoint:read': '接口查看',
  'login-log:read': '登录日志查看',
  'operation-log:read': '操作日志查看',
};

/** 各按钮的授权角色（角色代码） */
const PERM_ROLES: Record<string, string[]> = {
  'authorization:assign-users': ['ROLE_SUPER'],
  'authorization:assign-routes': ['ROLE_SUPER'],
  'authorization:assign-permission': ['ROLE_SUPER'],
  'api-endpoint:read': ['ROLE_SUPER'],
  'login-log:read': ['ROLE_SUPER', 'ROLE_ADMIN'],
  'operation-log:read': ['ROLE_SUPER', 'ROLE_ADMIN'],
};

export const initCasbinRule = async () => {
  const roles = await prisma.sysRole.findMany({ select: { id: true, code: true } });
  const roleIdByCode = new Map(roles.map((r) => [r.code, r.id]));

  for (const [perm, parent] of Object.entries(PERM_PARENT)) {
    const routeName = `btn_${crypto.createHash('md5').update(perm).digest('hex').slice(0, 16)}`;
    const existing = await prisma.sysMenu.findFirst({ where: { permission: perm } });
    const menu =
      existing ??
      (await prisma.sysMenu.create({
        data: {
          menuType: 'button',
          menuName: PERM_NAMES[perm] || perm,
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
      }));

    for (const code of PERM_ROLES[perm] || []) {
      const roleId = roleIdByCode.get(code);
      if (!roleId) continue;
      const bound = await prisma.sysRoleMenu.findFirst({
        where: { roleId, menuId: menu.id, domain: 'built-in' },
      });
      if (!bound) {
        await prisma.sysRoleMenu.create({ data: { roleId, menuId: menu.id, domain: 'built-in' } });
      }
    }
  }
  console.log('[sys-buttons] 系统级按钮权限种子完成');
};
