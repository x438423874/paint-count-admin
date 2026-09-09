import { Controller, Get, Post, Body, Query, Request, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthZGuard, UsePermissions } from '@lib/infra/casbin';
import { Log } from '@lib/infra/decorators/log.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';

import { SealService } from '../seal.service';
import { UserShopService } from '../../service/user-shop.service';

/**
 * 封单接口此前无任何权限校验（任何登录角色可封/解封任意门店任意月份，直接影响统计口径）。
 * 写操作要求 paint:seal:seal/unseal 且必须拥有该门店数据权限；查看要求 paint:seal:read。
 */
@ApiTags('Paint - Seal')
@Log('封单管理')
@UseGuards(AuthZGuard)
@Controller('paint/seal')
export class SealController {
  constructor(
    private readonly sealService: SealService,
    private readonly userShopService: UserShopService,
  ) {}

  @Post('seal')
  @UsePermissions({ resource: 'paint:seal', action: 'seal' })
  @ApiOperation({ summary: '封单：锁定门店+月份' })
  async seal(@Body() body: { shopId: string; month: string; force?: boolean }, @Request() _req: AuthenticatedRequest) {
    if (!body.shopId || !body.month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    await this.userShopService.assertShopAccess(_req.user.uid, body.shopId);
    const data = await this.sealService.seal(body.shopId, body.month, _req.user?.uid, { force: body.force === true });
    return ApiRes.success(data);
  }

  @Post('unseal')
  @UsePermissions({ resource: 'paint:seal', action: 'unseal' })
  @ApiOperation({ summary: '解封：解除门店+月份的封单锁定' })
  async unseal(@Body() body: { shopId: string; month: string }, @Request() _req: AuthenticatedRequest) {
    if (!body.shopId || !body.month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    await this.userShopService.assertShopAccess(_req.user.uid, body.shopId);
    const data = await this.sealService.unseal(body.shopId, body.month);
    return ApiRes.success(data);
  }

  @Get('status')
  @UsePermissions({ resource: 'paint:seal', action: 'read' })
  @ApiOperation({ summary: '查询门店某月的封单状态' })
  async getStatus(
    @Query('shopId') shopId: string,
    @Query('month') month: string,
    @Request() req: AuthenticatedRequest
  ) {
    if (!shopId || !month) {
      throw new BadRequestException('请提供门店ID和月份');
    }
    await this.userShopService.assertShopAccess(req.user.uid, shopId);
    const data = await this.sealService.getSealStatus(shopId, month);
    return ApiRes.success(data);
  }

  @Get('list')
  @UsePermissions({ resource: 'paint:seal', action: 'read' })
  @ApiOperation({ summary: '查询封单月份列表' })
  async listSealed(@Query('shopId') shopId?: string, @Request() req?: AuthenticatedRequest) {
    if (shopId && req) {
      await this.userShopService.assertShopAccess(req.user.uid, shopId);
    }
    const data = await this.sealService.listSealedMonths(shopId);
    return ApiRes.success(data);
  }

  @Get('overview')
  @UsePermissions({ resource: 'paint:seal', action: 'read' })
  @ApiOperation({ summary: '封单总览：门店×月份汇总与封单状态' })
  async overview(
    @Query('shopId') shopId?: string,
    @Query('month') month?: string,
    @Query('current') current?: string,
    @Query('size') size?: string,
    @Request() req?: AuthenticatedRequest
  ) {
    if (shopId && req) {
      await this.userShopService.assertShopAccess(req.user.uid, shopId);
    }
    const data = await this.sealService.getOverview({
      shopId,
      month,
      current: current ? Number(current) : 1,
      size: size ? Number(size) : 20,
    });
    return ApiRes.success(data);
  }
}
