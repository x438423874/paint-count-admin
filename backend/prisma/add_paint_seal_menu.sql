-- 将「封单管理」菜单加入前端动态菜单（sys_menu），并继承 paint 父菜单的角色权限
-- 适用数据库：MySQL
-- 前提：数据库中已存在 route_name = 'paint' 的父菜单（喷涂管理）
-- 执行方式：
--   方式A（Prisma）：  npx prisma db execute --file ./prisma/add_paint_seal_menu.sql --schema ./prisma/schema.prisma
--   方式B（mysql）：   mysql -h <host> -P <port> -u <user> -p <db> < ./prisma/add_paint_seal_menu.sql

-- 1) 插入菜单项（pid 取自 paint 父菜单的 id）
INSERT INTO sys_menu (
  menu_type, menu_name, icon_type, icon, route_name, route_path, component,
  path_param, status, active_menu, hide_in_menu, pid, sequence, i18n_key,
  keep_alive, constant, href, multi_tab, created_by, created_at
)
SELECT
  'menu', 'paint_seal', 1, 'mdi:lock-check', 'paint_seal', '/paint/seal', 'view.paint_seal',
  NULL, 'ENABLED', NULL, 0, s.id, 99, 'route.paint_seal',
  0, 0, NULL, 0, '-1', NOW()
FROM sys_menu s
WHERE s.route_name = 'paint';

-- 2) 继承 paint 父菜单已分配的角色权限；若父菜单无角色记录（默认全员可见），则不插入任何记录
INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT rm.role_id, m.id, rm.domain
FROM sys_menu m
JOIN sys_role_menu rm ON rm.menu_id = (SELECT id FROM sys_menu WHERE route_name = 'paint')
WHERE m.route_name = 'paint_seal'
ON DUPLICATE KEY UPDATE domain = VALUES(domain);
