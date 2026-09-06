-- 用户-门店绑定增加在岗期字段（门店负责人只能看自己在岗时的数据）
ALTER TABLE `sys_user_shop` ADD COLUMN `start_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
ALTER TABLE `sys_user_shop` ADD COLUMN `end_at` DATETIME(3) NULL;

-- 存量绑定：在岗开始时间取绑定创建时间，视为一直在岗
UPDATE `sys_user_shop` SET `start_at` = `created_at`;
