import { Module } from '@nestjs/common';
import { PrismaModule } from '@lib/shared/prisma/prisma.module';
import { PaintImageService } from './service/paint-image.service';
import { PaintShopService } from './service/paint-shop.service';
import { WorkOrderService } from './service/work-order.service';
import { WorkOrderAuditService } from './service/work-order-audit.service';
import { WorkOrderMergeService } from './service/work-order-merge.service';
import { WorkOrderSettlementService } from './service/work-order-settlement.service';
import { PaintStatisticsService } from './service/paint-statistics.service';
import { PaintStandardService } from './service/paint-standard.service';
import { PaintStandardTemplateService } from './service/paint-standard-template.service';
import { PaintCategoryService } from './service/paint-category.service';
import { PaintSpecialPaintService } from './service/paint-special-paint.service';
import { OcrService } from './service/ocr.service';
import { WorkOrderExcelService } from './service/work-order-excel.service';
import { ScheduledTaskManager } from './scheduled/scheduled-task-manager.service';
import { ScheduledTaskRegistrar } from './scheduled/scheduled-task-registrar.service';
import { ScheduledTaskController } from './scheduled/rest/scheduled-task.controller';
import { PaintShopController } from './shop/rest/shop.controller';
import { WorkOrderController } from './work-order/rest/work-order.controller';
import { PaintStatisticsController } from './statistics/rest/statistics.controller';
import { PaintStandardController } from './standard/rest/standard.controller';
import { PaintStandardTemplateController } from './standard/rest/standard-template.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    PaintShopController,
    WorkOrderController,
    PaintStatisticsController,
    PaintStandardController,
    PaintStandardTemplateController,
    ScheduledTaskController,
  ],
  providers: [
    PaintImageService,
    ScheduledTaskManager,
    ScheduledTaskRegistrar,
    PaintShopService,
    WorkOrderService,
    WorkOrderAuditService,
    WorkOrderMergeService,
    WorkOrderSettlementService,
    PaintStatisticsService,
    PaintStandardService,
    PaintStandardTemplateService,
    PaintCategoryService,
    PaintSpecialPaintService,
    OcrService,
    WorkOrderExcelService,
  ],
  exports: [
    PaintImageService,
    PaintShopService,
    WorkOrderService,
    WorkOrderAuditService,
    WorkOrderMergeService,
    WorkOrderSettlementService,
    PaintStatisticsService,
    PaintStandardService,
    PaintStandardTemplateService,
    PaintCategoryService,
    PaintSpecialPaintService,
    OcrService,
    WorkOrderExcelService,
  ],
})
export class PaintModule {}
