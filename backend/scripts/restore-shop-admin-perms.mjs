/**
 * 一键恢复门店管理员（角色10）的标准权限集（按既定规则）。
 * 用于权限配置误保存后的快速恢复。
 * 用法：node scripts/restore-shop-admin-perms.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ROLE_ID = '10';

const MENUS = [50, 101, 102, 109, 110, 111, 113];
const BUTTON_PERMS = [
  'paint:work-order:create', 'paint:work-order:quick-create', 'paint:work-order:batch-create',
  'paint:work-order:batch-ocr', 'paint:work-order:update', 'paint:work-order:items',
  'paint:work-order:delete', 'paint:work-order:audit', 'paint:work-order:unaudit',
  'paint:work-order:merge', 'paint:work-order:import', 'paint:work-order:export',
  'paint:work-order:unvoid', 'paint:work-order:void', 'paint:work-order:reconcile',
  'paint:work-order:view-customer',
  'paint:statistics:export',
  'paint:vehicle:create', 'paint:vehicle:update', 'paint:vehicle:delete',
  'paint:pending-image:upload', 'paint:pending-image:match', 'paint:pending-image:assign',
  'paint:pending-image:create-order', 'paint:pending-image:correct', 'paint:pending-image:retry',
  'paint:pending-image:delete',
];

async function main() {
  const buttons = await prisma.sysMenu.findMany({
    where: { menuType: 'button', permission: { in: BUTTON_PERMS } },
    select: { id: true, permission: true },
  });
  const found = new Set(buttons.map((b) => b.permission));
  const missingDefs = BUTTON_PERMS.filter((x) => !found.has(x));
  if (missingDefs.length) {
    console.error('以下按钮菜单行不存在，请先跑按钮迁移：', missingDefs);
    process.exit(1);
  }

  const target = new Set([...MENUS, ...buttons.map((b) => b.id)]);
  const existing = await prisma.sysRoleMenu.findMany({ where: { roleId: ROLE_ID }, select: { menuId: true } });
  const existingIds = new Set(existing.map((e) => e.menuId));

  let added = 0;
  let removed = 0;
  for (const id of target) {
    if (!existingIds.has(id)) {
      await prisma.sysRoleMenu.create({ data: { roleId: ROLE_ID, menuId: id, domain: 'built-in' } });
      added++;
    }
  }
  for (const id of existingIds) {
    if (!target.has(id)) {
      await prisma.sysRoleMenu.deleteMany({ where: { roleId: ROLE_ID, menuId: id } });
      removed++;
    }
  }
  const total = await prisma.sysRoleMenu.count({ where: { roleId: ROLE_ID } });
  console.log(`恢复完成：补绑 ${added}，移除 ${removed}，当前绑定 ${total} 行（菜单 ${MENUS.length} + 按钮 ${BUTTON_PERMS.length}）`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
