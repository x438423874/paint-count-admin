-- 用户姓名字段；删除昵称字段（用户名与昵称合并）
ALTER TABLE `sys_user` ADD COLUMN `real_name` VARCHAR(191) NULL;
ALTER TABLE `sys_user` DROP COLUMN `nick_name`;
