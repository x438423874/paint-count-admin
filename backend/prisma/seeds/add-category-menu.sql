INSERT INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(104, 'menu', 'paint_category', 1, 'mdi:format-list-bulleted-type', 'paint_category', '/paint/category', 'view.paint_category', 'ENABLED', false, 100, 3, 'route.paint_category', false, false, false, '-1', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 104, 'built-in' FROM sys_role r
ON CONFLICT (role_id, menu_id, domain) DO NOTHING;
