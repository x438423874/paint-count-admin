import { Controller, Get, Param, Query, Req, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';

import { WorkOrderLogService } from '../../service/work-order-log.service';
import { UserShopService } from '../../service/user-shop.service';

@ApiTags('Paint - WorkOrderLog')
@Controller('paint/work-order-log')
export class WorkOrderLogController {
  constructor(
    private readonly workOrderLogService: WorkOrderLogService,
    private readonly userShopService: UserShopService,
  ) {}

  /**
   * 全局操作日志分页（「我的→操作日志」页）。
   * 数据范围与工单一致：按账号可见门店过滤；门店账号只能看到本店（含已删除工单）的操作记录。
   */
  @Get('page')
  @ApiOperation({ summary: '工单操作日志分页（按账号门店权限过滤）' })
  async page(
    @Query('shopId') shopId: string | undefined,
    @Query('action') action: string | undefined,
    @Query('current') current: string | undefined,
    @Query('size') size: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ApiRes<any>> {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(request.user.uid);
    if (accessibleShopIds !== null && accessibleShopIds.length === 0) {
      return ApiRes.success({ records: [], total: 0, current: 1, size: Number(size) || 20 });
    }
    const data = await this.workOrderLogService.page({
      shopIds: accessibleShopIds,
      shopId: shopId || undefined,
      action: action || undefined,
      current: current ? Number(current) : 1,
      size: size ? Number(size) : 20,
    });
    return ApiRes.success(data);
  }

  /** 单据维度：某工单的操作流水（详情页「操作记录」区块）。工单已删除的记录按日志行的门店快照校验权限 */
  @Get('by-order/:orderId')
  @ApiOperation({ summary: '某工单的操作流水' })
  async listByOrder(@Param('orderId') orderId: string, @Req() request: FastifyRequest & { user?: { uid: string } }): Promise<ApiRes<any>> {
    if (!orderId) throw new BadRequestException('缺少工单 id');
    const logs = await this.workOrderLogService.listByOrder(orderId);
    // 权限：按日志行的门店快照校验（工单可能已删除，无法回查工单表）
    const shopId = logs[0]?.shopId;
    if (shopId && request.user?.uid) {
      await this.userShopService.assertShopAccess(request.user.uid, shopId);
    }
    return ApiRes.success(logs);
  }
}
