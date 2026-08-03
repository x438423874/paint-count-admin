INSERT IGNORE INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(111, 'menu', 'paint_pending-image', 1, 'mdi:image-multiple-outline', 'paint_pending-image', '/paint/pending-image', 'view.paint_pending-image', 'ENABLED', false, 100, 8, 'route.paint_pending-image', false, false, false, '-1', NOW());

INSERT IGNORE INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 111, 'built-in' FROM sys_role r;
