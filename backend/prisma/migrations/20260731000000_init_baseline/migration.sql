-- CreateTable
CREATE TABLE `sys_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `access_token` VARCHAR(191) NOT NULL,
    `refresh_token` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `login_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ip` VARCHAR(191) NOT NULL,
    `port` INTEGER NULL,
    `address` VARCHAR(191) NOT NULL,
    `user_agent` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `sys_tokens_access_token_key`(`access_token`),
    UNIQUE INDEX `sys_tokens_refresh_token_key`(`refresh_token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `built_in` BOOLEAN NOT NULL DEFAULT false,
    `avatar` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone_number` VARCHAR(191) NULL,
    `nick_name` VARCHAR(191) NOT NULL,
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `sys_user_username_key`(`username`),
    UNIQUE INDEX `sys_user_email_key`(`email`),
    UNIQUE INDEX `sys_user_phone_number_key`(`phone_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `casbin_rule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ptype` VARCHAR(191) NOT NULL,
    `v0` VARCHAR(191) NULL,
    `v1` VARCHAR(191) NULL,
    `v2` VARCHAR(191) NULL,
    `v3` VARCHAR(191) NULL,
    `v4` VARCHAR(191) NULL,
    `v5` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_domain` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `sys_domain_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `pid` VARCHAR(191) NOT NULL DEFAULT '0',
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `sys_role_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user_role` (
    `user_id` VARCHAR(191) NOT NULL,
    `role_id` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_user_shop` (
    `user_id` VARCHAR(191) NOT NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`user_id`, `shop_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_endpoint` (
    `id` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `controller` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_organization` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `pid` VARCHAR(191) NOT NULL DEFAULT '0',
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `sys_organization_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_login_log` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `login_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ip` VARCHAR(191) NOT NULL,
    `port` INTEGER NULL,
    `address` VARCHAR(191) NOT NULL,
    `user_agent` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_operation_log` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `module_name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `request_id` VARCHAR(191) NOT NULL,
    `method` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `user_agent` VARCHAR(191) NULL,
    `params` JSON NULL,
    `body` JSON NULL,
    `response` JSON NULL,
    `start_time` DATETIME(3) NOT NULL,
    `end_time` DATETIME(3) NOT NULL,
    `duration` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_menu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menu_type` ENUM('directory', 'menu') NOT NULL,
    `menu_name` VARCHAR(64) NOT NULL,
    `icon_type` INTEGER NULL DEFAULT 1,
    `icon` VARCHAR(64) NULL,
    `route_name` VARCHAR(64) NOT NULL,
    `route_path` VARCHAR(128) NOT NULL,
    `component` VARCHAR(64) NOT NULL,
    `path_param` VARCHAR(64) NULL,
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `active_menu` VARCHAR(64) NULL,
    `hide_in_menu` BOOLEAN NULL DEFAULT false,
    `pid` INTEGER NOT NULL DEFAULT 0,
    `sequence` INTEGER NOT NULL,
    `i18n_key` VARCHAR(64) NULL,
    `keep_alive` BOOLEAN NULL DEFAULT false,
    `constant` BOOLEAN NOT NULL DEFAULT false,
    `href` VARCHAR(64) NULL,
    `multi_tab` BOOLEAN NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,
    `updated_at` DATETIME(3) NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `sys_menu_route_name_key`(`route_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_role_menu` (
    `role_id` VARCHAR(191) NOT NULL,
    `menu_id` INTEGER NOT NULL,
    `domain` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`role_id`, `menu_id`, `domain`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_access_key` (
    `id` VARCHAR(191) NOT NULL,
    `domain` VARCHAR(191) NOT NULL,
    `access_key_id` VARCHAR(191) NOT NULL,
    `access_key_secret` VARCHAR(191) NOT NULL,
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL,
    `description` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `sys_access_key_access_key_id_key`(`access_key_id`),
    UNIQUE INDEX `sys_access_key_access_key_secret_key`(`access_key_secret`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_standard_template` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `version` VARCHAR(20) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_standard_template_item` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `category_id` VARCHAR(191) NOT NULL,
    `coefficient` DECIMAL(4, 2) NOT NULL,
    `new_part_addition` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `alias` VARCHAR(50) NULL,
    `unit` VARCHAR(10) NOT NULL DEFAULT '幅',
    `special_paint_id` VARCHAR(191) NULL,

    UNIQUE INDEX `paint_standard_template_item_template_id_category_id_key`(`template_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_special_paint` (
    `id` VARCHAR(191) NOT NULL,
    `template_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `multiplier` DECIMAL(4, 2) NOT NULL,
    `description` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_shop` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(100) NOT NULL,
    `address` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `status` ENUM('ENABLED', 'DISABLED', 'BANNED') NOT NULL DEFAULT 'ENABLED',
    `standard_template_id` VARCHAR(191) NULL,
    `excel_template_config` TEXT NULL,
    `category_alias_map` TEXT NULL,
    `order_no_rules` TEXT NULL,
    `ocr_config` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    UNIQUE INDEX `paint_shop_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_item_category` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_special` BOOLEAN NOT NULL DEFAULT false,
    `shop_id` VARCHAR(191) NULL,

    UNIQUE INDEX `paint_item_category_code_shop_id_key`(`code`, `shop_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_standard` (
    `id` VARCHAR(191) NOT NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `category_id` VARCHAR(191) NOT NULL,
    `coefficient` DECIMAL(4, 2) NOT NULL,
    `new_part_addition` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `alias` VARCHAR(50) NULL,
    `unit` VARCHAR(10) NOT NULL DEFAULT '幅',

    UNIQUE INDEX `paint_standard_shop_id_category_id_key`(`shop_id`, `category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_work_order` (
    `id` VARCHAR(191) NOT NULL,
    `order_no` VARCHAR(191) NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `order_date` DATETIME(3) NULL,
    `settlement_month` VARCHAR(7) NULL,
    `settled_at` DATETIME(3) NULL,
    `settled_by` VARCHAR(100) NULL,
    `car_model` VARCHAR(100) NULL DEFAULT '',
    `plate_number` VARCHAR(50) NULL DEFAULT '',
    `vin` VARCHAR(30) NULL,
    `brand` VARCHAR(50) NULL,
    `customer_name` VARCHAR(50) NULL DEFAULT '',
    `phone` VARCHAR(20) NULL,
    `contact_person` VARCHAR(50) NULL,
    `description` TEXT NULL,
    `total_paint_count` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'PENDING', 'AUDITED', 'SETTLED', 'ABNORMAL') NOT NULL DEFAULT 'PENDING',
    `audited_at` DATETIME(3) NULL,
    `audited_by` VARCHAR(100) NULL,
    `abnormal_remark` VARCHAR(500) NULL,
    `is_rework` BOOLEAN NOT NULL DEFAULT false,
    `rework_remark` VARCHAR(200) NULL,
    `remark` VARCHAR(191) NULL,
    `merge_group_id` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,
    `vehicle_id` VARCHAR(191) NULL,

    INDEX `paint_work_order_shop_id_settlement_month_idx`(`shop_id`, `settlement_month`),
    INDEX `paint_work_order_shop_id_settlement_month_status_idx`(`shop_id`, `settlement_month`, `status`),
    INDEX `paint_work_order_settlement_month_idx`(`settlement_month`),
    INDEX `paint_work_order_shop_id_order_date_idx`(`shop_id`, `order_date`),
    INDEX `paint_work_order_order_no_idx`(`order_no`),
    INDEX `paint_work_order_merge_group_id_idx`(`merge_group_id`),
    INDEX `paint_work_order_plate_number_idx`(`plate_number`),
    INDEX `paint_work_order_vehicle_id_idx`(`vehicle_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_work_order_item` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `category_id` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `paint_count` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `new_part_quantity` INTEGER NOT NULL DEFAULT 0,
    `special_paint_id` VARCHAR(191) NULL,
    `special_paint_multiplier` DECIMAL(4, 2) NULL,
    `remarks` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_work_order_image` (
    `id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `thumbnail_url` VARCHAR(191) NULL,
    `image_type` ENUM('BEFORE', 'DURING', 'AFTER') NOT NULL DEFAULT 'BEFORE',
    `description` VARCHAR(191) NULL,
    `file_size` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_settlement_month` (
    `id` VARCHAR(191) NOT NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `is_sealed` BOOLEAN NOT NULL DEFAULT false,
    `sealed_at` DATETIME(3) NULL,
    `sealed_by` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    UNIQUE INDEX `paint_settlement_month_shop_id_month_key`(`shop_id`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_vehicle` (
    `id` VARCHAR(191) NOT NULL,
    `plate_number` VARCHAR(50) NOT NULL,
    `vin` VARCHAR(30) NULL,
    `car_model` VARCHAR(100) NULL DEFAULT '',
    `brand` VARCHAR(50) NULL,
    `customer_name` VARCHAR(50) NULL DEFAULT '',
    `phone` VARCHAR(20) NULL,
    `contact_person` VARCHAR(50) NULL,
    `remark` VARCHAR(191) NULL,
    `last_order_at` DATETIME(3) NULL,
    `last_shop_id` VARCHAR(191) NULL,
    `total_order_count` INTEGER NOT NULL DEFAULT 0,
    `total_paint_count` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NULL,

    INDEX `paint_vehicle_customer_name_idx`(`customer_name`),
    INDEX `paint_vehicle_phone_idx`(`phone`),
    INDEX `paint_vehicle_last_shop_id_idx`(`last_shop_id`),
    INDEX `paint_vehicle_last_order_at_idx`(`last_order_at`),
    UNIQUE INDEX `paint_vehicle_plate_number_key`(`plate_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `paint_pending_image` (
    `id` VARCHAR(191) NOT NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `settlement_month` VARCHAR(7) NULL,
    `url` VARCHAR(191) NOT NULL,
    `thumbnail_url` VARCHAR(191) NULL,
    `file_size` INTEGER NULL,
    `file_hash` VARCHAR(64) NULL,
    `ocr_order_no` VARCHAR(191) NULL,
    `ocr_plate_number` VARCHAR(191) NULL,
    `ocr_vin` VARCHAR(191) NULL,
    `ocr_car_model` VARCHAR(191) NULL,
    `ocr_brand` VARCHAR(191) NULL,
    `ocr_customer_name` VARCHAR(191) NULL,
    `ocr_phone` VARCHAR(191) NULL,
    `ocr_date` VARCHAR(191) NULL,
    `ocr_raw_json` TEXT NULL,
    `status` ENUM('PENDING', 'MATCHED', 'NEEDS_REVIEW', 'MANUAL', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `matched_order_id` VARCHAR(191) NULL,
    `match_remark` VARCHAR(500) NULL,
    `uploaded_by` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `matched_at` DATETIME(3) NULL,
    `ocr_status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',

    INDEX `paint_pending_image_shop_id_settlement_month_status_idx`(`shop_id`, `settlement_month`, `status`),
    INDEX `paint_pending_image_shop_id_status_idx`(`shop_id`, `status`),
    INDEX `paint_pending_image_ocr_order_no_idx`(`ocr_order_no`),
    INDEX `paint_pending_image_ocr_plate_number_idx`(`ocr_plate_number`),
    INDEX `paint_pending_image_status_idx`(`status`),
    INDEX `paint_pending_image_ocr_status_idx`(`ocr_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sys_user_shop` ADD CONSTRAINT `sys_user_shop_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `sys_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_user_shop` ADD CONSTRAINT `sys_user_shop_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_standard_template_item` ADD CONSTRAINT `paint_standard_template_item_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `paint_standard_template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_standard_template_item` ADD CONSTRAINT `paint_standard_template_item_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_standard_template_item` ADD CONSTRAINT `paint_standard_template_item_special_paint_id_fkey` FOREIGN KEY (`special_paint_id`) REFERENCES `paint_special_paint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_special_paint` ADD CONSTRAINT `paint_special_paint_template_id_fkey` FOREIGN KEY (`template_id`) REFERENCES `paint_standard_template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_shop` ADD CONSTRAINT `paint_shop_standard_template_id_fkey` FOREIGN KEY (`standard_template_id`) REFERENCES `paint_standard_template`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_item_category` ADD CONSTRAINT `paint_item_category_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_standard` ADD CONSTRAINT `paint_standard_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_standard` ADD CONSTRAINT `paint_standard_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order` ADD CONSTRAINT `paint_work_order_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order` ADD CONSTRAINT `paint_work_order_vehicle_id_fkey` FOREIGN KEY (`vehicle_id`) REFERENCES `paint_vehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order_item` ADD CONSTRAINT `paint_work_order_item_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `paint_work_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order_item` ADD CONSTRAINT `paint_work_order_item_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order_item` ADD CONSTRAINT `paint_work_order_item_special_paint_id_fkey` FOREIGN KEY (`special_paint_id`) REFERENCES `paint_special_paint`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_work_order_image` ADD CONSTRAINT `paint_work_order_image_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `paint_work_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_settlement_month` ADD CONSTRAINT `paint_settlement_month_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_pending_image` ADD CONSTRAINT `paint_pending_image_shop_id_fkey` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `paint_pending_image` ADD CONSTRAINT `paint_pending_image_matched_order_id_fkey` FOREIGN KEY (`matched_order_id`) REFERENCES `paint_work_order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

