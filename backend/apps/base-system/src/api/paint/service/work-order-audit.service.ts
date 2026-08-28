import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { AuditWorkOrderDto } from '../work-order/dto/work-order.dto';
import { SealService } from '../seal/seal.service';

@Injectable()
export class WorkOrderAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sealService: SealService,
  ) {}

  /** 审核工单 */
  async audit(dto: AuditWorkOrderDto) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id: dto.id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(dto.id);

    if (existing.status === 'AUDITED' || existing.status === 'SETTLED' || existing.status === 'ABNORMAL') {
      throw new BadRequestException('工单已审核，不能重复审核');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: dto.id },
      data: {
        auditedAt: new Date(),
        auditedBy: dto.auditedBy || null,
        status: 'AUDITED' as any,
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }

  /** 取消审核 */
  async unaudit(id: string) {
    const existing = await this.prisma.paintWorkOrder.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(id);

    if (existing.status !== 'AUDITED') {
      throw new BadRequestException('只有已审核且未结算、未异常的工单才能取消审核');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id },
      data: {
        auditedAt: null,
        auditedBy: null,
        status: 'PENDING' as any,
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }
}
