/**
 * 一次性迁移：casbin 策略 → 芋道式按钮型菜单行 + sys_role_menu 绑定
 *
 * - 每个 (resource, action) 权限点 → sys_menu 一行（menuType=button，permission=`resource:action`）
 * - 每条 casbin 规则（角色码×权限点）→ sys_role_menu 一行（角色id×按钮菜单id）
 * - 幂等：按 permission 查重；重复执行安全
 * - 不触碰任何业务数据表
 *
 * 用法：node scripts/migrate-casbin-to-menu-buttons.mjs
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 权限点 → 所属菜单（sys_menu.id） */
const PERM_PARENT = {
  'paint:work-order:create': 101,
  'paint:work-order:quick-create': 101,
  'paint:work-order:batch-create': 101,
  'paint:work-order:batch-ocr': 101,
  'paint:work-order:update': 101,
  'paint:work-order:items': 101,
  'paint:work-order:delete': 101,
  'paint:work-order:audit': 101,
  'paint:work-order:unaudit': 101,
  'paint:work-order:merge': 101,
  'paint:work-order:abnormal': 101,
  'paint:work-order:void': 101,
  'paint:work-order:unvoid': 101,
  'paint:work-order:import': 101,
  'paint:work-order:export': 101,
  'paint:work-order:settle': 101,
  'paint:work-order:unsettle': 101,
  'paint:work-order:batch-settle': 101,
  'paint:work-order:batch-unsettle': 101,
  'paint:work-order:reconcile': 109,
  'paint:statistics:export': 102,
  'paint:vehicle:create': 110,
  'paint:vehicle:update': 110,
  'paint:vehicle:delete': 110,
  'paint:pending-image:upload': 111,
  'paint:pending-image:match': 111,
  'paint:pending-image:assign': 111,
  'paint:pending-image:create-order': 111,
  'paint:pending-image:correct': 111,
  'paint:pending-image:retry': 111,
  'paint:pending-image:delete': 111,
  'paint:seal:read': 112,
  'paint:seal:seal': 112,
  'paint:seal:unseal': 112,
  'login-log:read': 71,
  'operation-log:read': 72,
  'authorization:assign-users': 63,
  'authorization:assign-routes': 63,
  'authorization:assign-permission': 63,
  'api-endpoint:read': 63,
};

/** 资源 → 中文名前缀（按钮菜单名 = 前缀 + 操作名） */
const RESOURCE_LABELS = {
  'paint:work-order': '工单',
  'paint:statistics': '统计',
  'paint:vehicle': '车辆',
  'paint:pending-image': '图片',
  'paint:seal': '封单',
  authorization: '授权',
  'api-endpoint': '接口',
  'login-log': '登录日志',
  'operation-log': '操作日志',
};

/** 个别按钮名称覆盖（避免「封单封单」这类重复表述） */
const NAME_OVERRIDES = {
  'paint:seal:seal': '执行封单',
  'paint:seal:unseal': '执行解封'
};

const ACTION_LABELS = {
  create: '创建',
  'quick-create': '快速建单',
  'batch-create': '批量创建',
  'batch-ocr': '批量OCR',
  update: '更新',
  delete: '删除',
  import: '导入',
  audit: '审核',
  unaudit: '反审核',
  settle: '结算',
  unsettle: '取消结算',
  'batch-settle': '批量结算',
  'batch-unsettle': '批量取消结算',
  merge: '合并',
  reconcile: '对账',
  abnormal: '异常标注',
  void: '作废',
  unvoid: '恢复作废',
  items: '项目明细',
  export: '导出',
  read: '查看',
  seal: '封单',
  unseal: '解封',
  upload: '上传',
  match: '匹配',
  assign: '归类',
  'create-order': '补建工单',
  correct: '修正',
  retry: '重试',
  'assign-users': '分配用户角色',
  'assign-routes': '分配菜单',
  'assign-permission': '分配API权限',
};

async function main() {
  const rules = await prisma.casbinRule.findMany({ where: { ptype: 'p' } });
  console.log(`casbin 策略共 ${rules.length} 条`);

  const roles = await prisma.sysRole.findMany({ select: { id: true, code: true } });
  const roleIdByCode = new Map(roles.map((r) => [r.code, r.id]));

  // 1. 权限点 → 按钮菜单行
  const permKeySet = new Set(rules.map((r) => `${r.v1}:${r.v2}`));
  const buttonIdByPerm = new Map();

  for (const perm of permKeySet) {
    const parent = PERM_PARENT[perm];
    if (!parent) {
      console.warn(`⚠ 无父菜单映射，跳过：${perm}`);
      continue;
    }
    const splitAt = perm.lastIndexOf(':');
    const resource = perm.slice(0, splitAt);
    const action = perm.slice(splitAt + 1);
    const menuName = NAME_OVERRIDES[perm] || `${RESOURCE_LABELS[resource] || resource}${ACTION_LABELS[action] || action}`;
    const routeName = `btn_${crypto.createHash('md5').update(perm).digest('hex').slice(0, 16)}`;

    const existing = await prisma.sysMenu.findFirst({ where: { permission: perm } });
    if (existing && existing.menuName !== menuName) {
      await prisma.sysMenu.update({ where: { id: existing.id }, data: { menuName } });
      console.log(`修正按钮菜单 #${existing.id} ${perm}：「${existing.menuName}」→「${menuName}」`);
    }
    const row =
      existing ??
      (await prisma.sysMenu.create({
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
          createdBy: 'migration',
        },
      }));
    buttonIdByPerm.set(perm, row.id);
    if (existing) console.log(`复用按钮菜单 #${row.id} ${perm}`);
    else console.log(`创建按钮菜单 #${row.id} ${perm}（${menuName}）`);
  }

  // 2. casbin 规则 → 角色绑定
  let bound = 0;
  for (const rule of rules) {
    const perm = `${rule.v1}:${rule.v2}`;
    const menuId = buttonIdByPerm.get(perm);
    const roleId = roleIdByCode.get(rule.v0);
    if (!menuId || !roleId) continue;

    const exists = await prisma.sysRoleMenu.findFirst({
      where: { roleId, menuId, domain: rule.v3 },
    });
    if (!exists) {
      await prisma.sysRoleMenu.create({
        data: { roleId, menuId, domain: rule.v3 },
      });
      bound++;
    }
  }
  console.log(`新增角色-按钮绑定 ${bound} 条`);

  // 3. 摘要
  const buttonCount = await prisma.sysMenu.count({ where: { menuType: 'button' } });
  const bindCount = await prisma.sysRoleMenu.count();
  console.log(`完成：按钮菜单共 ${buttonCount} 行，sys_role_menu 共 ${bindCount} 行`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
