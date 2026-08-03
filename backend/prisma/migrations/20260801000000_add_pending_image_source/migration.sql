-- AlterTable
ALTER TABLE `paint_pending_image` ADD COLUMN `source` ENUM('POOL', 'CREATE') NOT NULL DEFAULT 'POOL';
