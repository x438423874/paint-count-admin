import { Module } from '@nestjs/common';
import { PrismaModule } from '@lib/shared/prisma/prisma.module';
import { PaintShopService } from './service/paint-shop.service';
import { WorkOrderService } from './service/work-order.service';
import { PaintStatisticsService } from './service/paint-statistics.service';
import { PaintStandardService } from './service/paint-standard.service';
import { PaintStandardTemplateService } from './service/paint-standard-template.service';
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
  ],
  providers: [
    PaintShopService,
    WorkOrderService,
    PaintStatisticsService,
    PaintStandardService,
    PaintStandardTemplateService,
  ],
  exports: [PaintShopService, WorkOrderService, PaintStatisticsService, PaintStandardService, PaintStandardTemplateService],
})
export class PaintModule {}
