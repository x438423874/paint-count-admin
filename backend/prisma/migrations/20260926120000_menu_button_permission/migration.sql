-- 芋道式授权改造：按钮型菜单 + 权限标识列
ALTER TABLE `sys_menu` MODIFY COLUMN `menu_type` ENUM('directory', 'menu', 'button') NOT NULL;
ALTER TABLE `sys_menu` ADD COLUMN `permission` VARCHAR(128) NULL;
