import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { SealService } from '../seal/seal.service';

@Injectable()
export class WorkOrderSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sealService: SealService,
  ) {}

  /** 结算工单：只改状态，参照审核逻辑，不修改 settlementMonth */
  async settle(orderId: string, _settlementMonth?: string, settledBy?: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(orderId);

    const currentStatus = order.status;

    if (currentStatus === ('ABNORMAL' as any)) {
      throw new BadRequestException('工单有异常标注，不能结算');
    }

    if (currentStatus === ('SETTLED' as any)) {
      throw new BadRequestException('工单已结算，不能重复结算');
    }

    if (currentStatus !== ('AUDITED' as any)) {
      throw new BadRequestException('只有已审核的工单才能结算');
    }

    // 结算只改状态，不修改 settlementMonth
    // 如果工单没有 settlementMonth，则从 orderDate 推导
    const updateData: any = {
      status: 'SETTLED',
      settledAt: new Date(),
      settledBy: settledBy || null,
    };

    // 仅在工单没有 settlementMonth 时才补充
    if (!order.settlementMonth) {
      updateData.settlementMonth = this.getMonthFromDate(order.orderDate);
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: orderId },
      data: updateData,
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }

  /** 取消结算：只改状态回已审核 */
  async unsettle(orderId: string) {
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('工单不存在');

    // 封单校验
    await this.sealService.assertOrderNotSealed(orderId);

    const currentStatus = order.status;

    if (currentStatus !== ('SETTLED' as any)) {
      throw new BadRequestException('只有已结算的工单才能取消结算');
    }

    return this.prisma.paintWorkOrder.update({
      where: { id: orderId },
      data: {
        status: 'AUDITED' as any,
        settledAt: null,
        settledBy: null,
      },
      include: { items: { include: { category: true, specialPaint: true } }, shop: true },
    });
  }

  /** 批量结算工单 */
  async batchSettle(orderIds: string[], settledBy?: string) {
    let success = 0;
    let failed = 0;
    const errors: { id: string; message: string }[] = [];

    for (const id of orderIds) {
      try {
        await this.settle(id, undefined, settledBy);
        success++;
      } catch (e: any) {
        failed++;
        errors.push({ id, message: e?.message || '结算失败' });
      }
    }

    return { success, failed, errors };
  }

  /** 批量取消结算 */
  async batchUnsettle(orderIds: string[]) {
    let success = 0;
    let failed = 0;
    const errors: { id: string; message: string }[] = [];

    for (const id of orderIds) {
      try {
        await this.unsettle(id);
        success++;
      } catch (e: any) {
        failed++;
        errors.push({ id, message: e?.message || '取消结算失败' });
      }
    }

    return { success, failed, errors };
  }

  private getMonthFromDate(date: Date | null | undefined): string {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
