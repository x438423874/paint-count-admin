INSERT INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(103, 'menu', 'paint_shop', 1, 'mdi:store-outline', 'paint_shop', '/paint/shop', 'view.paint_shop', 'ENABLED', false, 100, 0, 'route.paint_shop', false, false, false, '-1', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 103, 'built-in' FROM sys_role r
ON CONFLICT (role_id, menu_id, domain) DO NOTHING;
