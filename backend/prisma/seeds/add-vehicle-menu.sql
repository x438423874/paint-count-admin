-- 添加车辆管理菜单
INSERT INTO sys_menu (id, menu_type, menu_name, icon_type, icon, route_name, route_path, component, status, hide_in_menu, pid, sequence, i18n_key, keep_alive, constant, multi_tab, created_by, created_at)
VALUES
(110, 'menu', 'paint_vehicle', 1, 'mdi:car-key', 'paint_vehicle', '/paint/vehicle', 'view.paint_vehicle', 'ENABLED', false, 100, 1, 'route.paint_vehicle', false, false, false, '-1', NOW())
ON DUPLICATE KEY UPDATE route_name='paint_vehicle';

-- 关联到所有角色
INSERT INTO sys_role_menu (role_id, menu_id, domain)
SELECT r.id, 110, 'built-in' FROM sys_role r
ON DUPLICATE KEY UPDATE menu_id=110;
