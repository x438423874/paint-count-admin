-- CreateTable
CREATE TABLE `ocr_annotation` (
    `id` VARCHAR(191) NOT NULL,
    `shop_id` VARCHAR(191) NOT NULL,
    `order_id` VARCHAR(191) NULL,
    `image_url` VARCHAR(191) NOT NULL,
    `image_width` INTEGER NOT NULL,
    `image_height` INTEGER NOT NULL,
    `regions` JSON NOT NULL,
    `ground_truth` JSON NULL,
    `is_verified` BOOLEAN NOT NULL DEFAULT false,
    `annotated_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE INDEX `ocr_annotation_shop_id_idx` ON `ocr_annotation`(`shop_id`);

-- CreateTable
CREATE INDEX `ocr_annotation_shop_id_is_verified_idx` ON `ocr_annotation`(`shop_id`, `is_verified`);
