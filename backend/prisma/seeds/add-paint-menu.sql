INSERT INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(100, 'directory', 'paint', 1, 'mdi:format-paint', 'paint', '/paint', 'layout.base', 'ENABLED', false, 0, 5, 'route.paint', false, false, false, '-1', NOW()),
(101, 'menu', 'paint_work-order', 1, 'mdi:clipboard-text-outline', 'paint_work-order', '/paint/work-order', 'view.paint_work-order', 'ENABLED', false, 100, 1, 'route.paint_work-order', false, false, false, '-1', NOW()),
(102, 'menu', 'paint_statistics', 1, 'mdi:chart-bar', 'paint_statistics', '/paint/statistics', 'view.paint_statistics', 'ENABLED', false, 100, 2, 'route.paint_statistics', false, false, false, '-1', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 100, 'built-in' FROM sys_role r
ON CONFLICT (role_id, menu_id, domain) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 101, 'built-in' FROM sys_role r
ON CONFLICT (role_id, menu_id, domain) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 102, 'built-in' FROM sys_role r
ON CONFLICT (role_id, menu_id, domain) DO NOTHING;
