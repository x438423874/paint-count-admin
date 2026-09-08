import { Module } from '@nestjs/common';
import { PrismaModule } from '@lib/shared/prisma/prisma.module';
import { PaintImageService } from './service/paint-image.service';
import { PaintShopService } from './service/paint-shop.service';
import { PaintVehicleService } from './service/paint-vehicle.service';
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
import { LlmOcrService } from './service/llm-ocr.service';
import { WorkOrderExcelService } from './service/work-order-excel.service';
import { WorkOrderNoRuleService } from './service/work-order-no-rule.service';
import { WorkOrderReconcileService } from './service/work-order-reconcile.service';
import { PaintPdfExportService } from './service/paint-pdf-export.service';
import { SealService } from './seal/seal.service';
import { UserShopService } from './service/user-shop.service';
import { PendingImageService } from './service/pending-image.service';
import { ScheduledTaskManager } from './scheduled/scheduled-task-manager.service';
import { ScheduledTaskRegistrar } from './scheduled/scheduled-task-registrar.service';
import { ScheduledTaskController } from './scheduled/rest/scheduled-task.controller';
import { PaintShopController } from './shop/rest/shop.controller';
import { PaintVehicleController } from './vehicle/rest/vehicle.controller';
import { WorkOrderController } from './work-order/rest/work-order.controller';
import { PaintStatisticsController } from './statistics/rest/statistics.controller';
import { PaintStandardController } from './standard/rest/standard.controller';
import { PaintStandardTemplateController } from './standard/rest/standard-template.controller';
import { SealController } from './seal/rest/seal.controller';
import { UserShopController } from './user-shop/rest/user-shop.controller';
import { PendingImageController } from './pending-image/rest/pending-image.controller';
import { UploadsController } from './upload-access/rest/uploads.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    PaintShopController,
    PaintVehicleController,
    WorkOrderController,
    PaintStatisticsController,
    PaintStandardController,
    PaintStandardTemplateController,
    SealController,
    ScheduledTaskController,
    UserShopController,
    PendingImageController,
    UploadsController,
  ],
  providers: [
    PaintImageService,
    ScheduledTaskManager,
    ScheduledTaskRegistrar,
    PaintShopService,
    PaintVehicleService,
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
    LlmOcrService,
    WorkOrderExcelService,
    WorkOrderNoRuleService,
    WorkOrderReconcileService,
    PaintPdfExportService,
    SealService,
    UserShopService,
    PendingImageService,
  ],
  exports: [
    PaintImageService,
    PaintShopService,
    PaintVehicleService,
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
    LlmOcrService,
    WorkOrderExcelService,
    WorkOrderNoRuleService,
    WorkOrderReconcileService,
    PaintPdfExportService,
    SealService,
    UserShopService,
  ],
})
export class PaintModule {}
