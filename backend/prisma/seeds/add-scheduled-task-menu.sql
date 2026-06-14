-- 添加定时任务管理菜单
INSERT IGNORE INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(108, 'menu', 'paint_scheduled-task', 1, 'mdi:timer-outline', 'paint_scheduled-task', '/paint/scheduled-task', 'view.paint_scheduled-task', 'ENABLED', false, 100, 6, 'route.paint_scheduled-task', false, false, false, '-1', NOW());

-- 关联到所有角色
INSERT IGNORE INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 108, 'built-in' FROM sys_role r;
