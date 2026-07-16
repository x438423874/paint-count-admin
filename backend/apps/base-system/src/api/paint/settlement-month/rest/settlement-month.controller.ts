import { Controller, Get, Post, Body, Query, Request, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettlementMonthService } from '../../service/settlement-month.service';
import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';

@ApiTags('Paint - SettlementMonth')
@Controller('paint/settlement-month')
export class SettlementMonthController {
  constructor(private readonly settlementMonthService: SettlementMonthService) {}

  @Post('seal')
  @ApiOperation({ summary: '封单：锁定门店+月份' })
  async seal(@Body() body: { shopId: string; month: string }, @Request() _req: AuthenticatedRequest) {
    if (!body.shopId || !body.month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    const data = await this.settlementMonthService.seal(body.shopId, body.month, _req.user?.uid);
    return ApiRes.success(data);
  }

  @Post('unseal')
  @ApiOperation({ summary: '解封：解除门店+月份的封单锁定' })
  async unseal(@Body() body: { shopId: string; month: string }, @Request() _req: AuthenticatedRequest) {
    if (!body.shopId || !body.month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    const data = await this.settlementMonthService.unseal(body.shopId, body.month);
    return ApiRes.success(data);
  }

  @Get('status')
  @ApiOperation({ summary: '查询门店某月的封单状态' })
  async getStatus(@Query('shopId') shopId: string, @Query('month') month: string) {
    if (!shopId || !month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    const data = await this.settlementMonthService.getSealStatus(shopId, month);
    return ApiRes.success(data);
  }

  @Get('list')
  @ApiOperation({ summary: '查询封单月份列表' })
  async listSealed(@Query('shopId') shopId?: string) {
    const data = await this.settlementMonthService.listSealedMonths(shopId);
    return ApiRes.success(data);
  }
}
