import { prisma } from './helper';
import { initCasbinRule } from './sys/casbinRule';
import { initPaint } from './sys/paint';
import { initSysDomain } from './sys/sysDomain';
import { initSysMenu } from './sys/sysMenu';
import { initSysRole } from './sys/sysRole';
import { initSysRoleMenu } from './sys/sysRoleMenu';
import { initSysUser } from './sys/sysUser';
import { initSysUserRole } from './sys/sysUserRole';

const run = async () => {
  await initSysUser();
  await initSysRole();
  await initSysMenu();
  await initSysDomain();
  await initSysUserRole();
  await initSysRoleMenu();
  await initCasbinRule();
  // 喷漆业务：菜单/角色菜单/权限点（数据导自生产库，替代手工执行的 add-*-menu.sql）
  await initPaint();
};

(async () => {
  const date = new Date().getTime();
  console.log('Database initialization start');
  await run();
  console.log('Database initialization complete');
  console.log('Duration:', new Date().getTime() - date, 'ms');
  // 关闭数据库连接
  await prisma.$disconnect();
})();
