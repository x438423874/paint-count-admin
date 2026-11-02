-- 工单操作日志（业务级审计）：与工单解绑，工单删除后记录保留
CREATE TABLE `paint_work_order_log` (
    `id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `order_no` VARCHAR(30) NOT NULL,
    `shop_id` VARCHAR(30) NOT NULL,
    `user_id` VARCHAR(30) NOT NULL,
    `username` VARCHAR(50) NOT NULL,
    `action` VARCHAR(30) NOT NULL,
    `detail` VARCHAR(500) NULL,
    `ip` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `paint_work_order_log_order_id_created_at_idx`(`order_id`, `created_at`),
    INDEX `paint_work_order_log_shop_id_created_at_idx`(`shop_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
