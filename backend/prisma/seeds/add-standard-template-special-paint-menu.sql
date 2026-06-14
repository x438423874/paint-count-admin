-- 标准模板菜单
INSERT IGNORE INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(105, 'menu', 'paint_standard-template', 1, 'mdi:file-document-outline', 'paint_standard-template', '/paint/standard-template', 'view.paint_standard-template', 'ENABLED', false, 100, 4, 'route.paint_standard-template', false, false, false, '-1', NOW());

INSERT IGNORE INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 105, 'built-in' FROM sys_role r;

-- 特殊车漆菜单
INSERT IGNORE INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(106, 'menu', 'paint_special-paint', 1, 'mdi:palette', 'paint_special-paint', '/paint/special-paint', 'view.paint_special-paint', 'ENABLED', false, 100, 5, 'route.paint_special-paint', false, false, false, '-1', NOW());

INSERT IGNORE INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 106, 'built-in' FROM sys_role r;
