import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditWorkOrderDto } from '../work-order/dto/work-order.dto';

@Injectable()
export class WorkOrderAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** 审核工单 */
  async audit(dto: AuditWorkOrderDto) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('工单不存在');

    if (existing.isAudited) {
      throw new BadRequestException('工单已审核，不能重复审核');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: dto.id },
      data: {
        isAudited: true,
        auditedAt: new Date(),
        auditedBy: dto.auditedBy || null,
        status: 'COMPLETED',
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }

  /** 取消审核 */
  async unaudit(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('工单不存在');

    if (!existing.isAudited) {
      throw new BadRequestException('工单未审核，无需取消');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        isAudited: false,
        auditedAt: null,
        auditedBy: null,
        status: 'PENDING',
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }
}
