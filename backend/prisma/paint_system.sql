-- 喷漆幅数统计系统 MySQL 建表脚本

CREATE TABLE IF NOT EXISTS `paint_standard_template` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL COMMENT '标准名称',
    `description` TEXT COMMENT '标准描述',
    `version` VARCHAR(20) COMMENT '版本号',
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3),
    PRIMARY KEY (`id`)
) COMMENT='标准模板';

CREATE TABLE IF NOT EXISTS `paint_standard_template_item` (
    `id` VARCHAR(30) NOT NULL,
    `template_id` VARCHAR(30) NOT NULL,
    `category_id` VARCHAR(30) NOT NULL,
    `coefficient` DECIMAL(4,2) NOT NULL COMMENT '系数',
    `new_part_addition` DECIMAL(4,2) NOT NULL DEFAULT 0 COMMENT '新件加幅',
    `alias` VARCHAR(50) COMMENT '别名',
    `unit` VARCHAR(10) NOT NULL DEFAULT '幅' COMMENT '单位',
    PRIMARY KEY (`id`),
    UNIQUE KEY `paint_std_tpl_item_uniq` (`template_id`, `category_id`),
    KEY `paint_std_tpl_item_template` (`template_id`),
    KEY `paint_std_tpl_item_category` (`category_id`),
    CONSTRAINT `paint_std_tpl_item_template_fk` FOREIGN KEY (`template_id`) REFERENCES `paint_standard_template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `paint_std_tpl_item_category_fk` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) COMMENT='标准模板项目';

CREATE TABLE IF NOT EXISTS `paint_special_paint` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL COMMENT '特殊车漆名称',
    `multiplier` DECIMAL(4,2) NOT NULL COMMENT '倍数',
    `description` TEXT COMMENT '描述',
    `is_active` BOOLEAN NOT NULL DEFAULT TRUE COMMENT '是否启用',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3),
    PRIMARY KEY (`id`)
) COMMENT='特殊车漆';

CREATE TABLE IF NOT EXISTS `paint_shop` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(255) NOT NULL COMMENT '门店名称',
    `code` VARCHAR(255) NOT NULL COMMENT '门店编码',
    `brand` VARCHAR(100) NOT NULL COMMENT '品牌',
    `address` TEXT COMMENT '地址',
    `phone` TEXT COMMENT '电话',
    `status` VARCHAR(20) NOT NULL DEFAULT 'ENABLED',
    `standard_template_id` VARCHAR(30) COMMENT '当前使用的标准模板ID',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `paint_shop_code_key` (`code`),
    KEY `paint_shop_template_fk` (`standard_template_id`),
    CONSTRAINT `paint_shop_template_fk` FOREIGN KEY (`standard_template_id`) REFERENCES `paint_standard_template`(`id`) ON UPDATE CASCADE
) COMMENT='门店';

CREATE TABLE IF NOT EXISTS `paint_item_category` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(50) NOT NULL COMMENT '项目名称',
    `code` VARCHAR(50) NOT NULL COMMENT '项目编码',
    `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
    `is_special` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否特殊项目',
    `shop_id` VARCHAR(30) COMMENT '门店ID(null=全局)',
    PRIMARY KEY (`id`),
    UNIQUE KEY `paint_category_code_shop` (`code`, `shop_id`),
    KEY `paint_category_shop_fk` (`shop_id`),
    CONSTRAINT `paint_category_shop_fk` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) COMMENT='喷漆项目类别';

CREATE TABLE IF NOT EXISTS `paint_standard` (
    `id` VARCHAR(30) NOT NULL,
    `shop_id` VARCHAR(30) NOT NULL,
    `category_id` VARCHAR(30) NOT NULL,
    `coefficient` DECIMAL(4,2) NOT NULL COMMENT '系数',
    `new_part_addition` DECIMAL(4,2) NOT NULL DEFAULT 0 COMMENT '新件加幅',
    `alias` VARCHAR(50) COMMENT '别名',
    `unit` VARCHAR(10) NOT NULL DEFAULT '幅' COMMENT '单位',
    PRIMARY KEY (`id`),
    UNIQUE KEY `paint_standard_shop_category` (`shop_id`, `category_id`),
    KEY `paint_standard_shop_fk` (`shop_id`),
    KEY `paint_standard_category_fk` (`category_id`),
    CONSTRAINT `paint_standard_shop_fk` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `paint_standard_category_fk` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) COMMENT='幅数标准';

CREATE TABLE IF NOT EXISTS `paint_work_order` (
    `id` VARCHAR(30) NOT NULL,
    `order_no` VARCHAR(255) NOT NULL COMMENT '工单号',
    `shop_id` VARCHAR(30) NOT NULL,
    `order_date` DATETIME(3) NOT NULL COMMENT '工单日期',
    `settlement_month` VARCHAR(7) COMMENT '结算月份',
    `car_model` VARCHAR(100) DEFAULT '' COMMENT '车型',
    `plate_number` VARCHAR(20) DEFAULT '' COMMENT '车牌号',
    `vin` VARCHAR(30) COMMENT '车架号',
    `customer_name` VARCHAR(50) DEFAULT '' COMMENT '客户名称',
    `phone` VARCHAR(20) COMMENT '电话',
    `contact_person` VARCHAR(50) COMMENT '联系人',
    `description` TEXT COMMENT '问题描述',
    `total_paint_count` DECIMAL(8,2) NOT NULL DEFAULT 0 COMMENT '总幅数',
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT '状态',
    `is_audited` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否已审核',
    `audited_at` DATETIME(3) COMMENT '审核时间',
    `audited_by` VARCHAR(100) COMMENT '审核人',
    `remark` TEXT COMMENT '备注',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3),
    PRIMARY KEY (`id`),
    UNIQUE KEY `paint_work_order_no_key` (`order_no`),
    KEY `paint_work_order_shop_month` (`shop_id`, `settlement_month`),
    KEY `paint_work_order_month` (`settlement_month`),
    CONSTRAINT `paint_work_order_shop_fk` FOREIGN KEY (`shop_id`) REFERENCES `paint_shop`(`id`) ON UPDATE CASCADE
) COMMENT='喷漆工单';

CREATE TABLE IF NOT EXISTS `paint_work_order_item` (
    `id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `category_id` VARCHAR(30) NOT NULL,
    `quantity` INT NOT NULL DEFAULT 1 COMMENT '数量',
    `paint_count` DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT '计算后幅数',
    `is_new_part` BOOLEAN NOT NULL DEFAULT FALSE COMMENT '是否新件',
    `special_paint_id` VARCHAR(30) COMMENT '特殊车漆ID',
    `special_paint_multiplier` DECIMAL(4,2) COMMENT '特殊车漆倍数',
    `remarks` TEXT COMMENT '备注',
    PRIMARY KEY (`id`),
    KEY `paint_wo_item_order_fk` (`order_id`),
    KEY `paint_wo_item_category_fk` (`category_id`),
    KEY `paint_wo_item_special_paint_fk` (`special_paint_id`),
    CONSTRAINT `paint_wo_item_order_fk` FOREIGN KEY (`order_id`) REFERENCES `paint_work_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `paint_wo_item_category_fk` FOREIGN KEY (`category_id`) REFERENCES `paint_item_category`(`id`) ON UPDATE CASCADE,
    CONSTRAINT `paint_wo_item_special_paint_fk` FOREIGN KEY (`special_paint_id`) REFERENCES `paint_special_paint`(`id`) ON UPDATE CASCADE
) COMMENT='工单喷漆明细项';

CREATE TABLE IF NOT EXISTS `paint_work_order_image` (
    `id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `url` TEXT NOT NULL,
    `image_type` VARCHAR(20) NOT NULL DEFAULT 'BEFORE' COMMENT '图片类型',
    `description` TEXT,
    `file_size` INT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    KEY `paint_wo_image_order_fk` (`order_id`),
    CONSTRAINT `paint_wo_image_order_fk` FOREIGN KEY (`order_id`) REFERENCES `paint_work_order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) COMMENT='工单图片';
