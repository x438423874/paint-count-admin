import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';

import { UserShopService } from '../../service/user-shop.service';

class BindShopsDto {
  shopIds: string[];
}

@ApiTags('Paint - UserShop')
@Controller('paint/user-shop')
export class UserShopController {
  constructor(private readonly userShopService: UserShopService) {}

  /**
   * 获取指定用户绑定的门店列表（仅超管可用，用于用户管理页）
   */
  @Get('user/:userId')
  @ApiOperation({ summary: '获取指定用户绑定的门店列表（超管用）' })
  async getUserBoundShops(
    @Param('userId') userId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    // 权限校验：仅超管可查询其他用户的绑定
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new BadRequestException('仅超级管理员可管理用户门店绑定');
    }
    const shops = await this.userShopService.getBoundShops(userId);
    return ApiRes.success(shops);
  }

  /**
   * 设置指定用户绑定的门店（仅超管可用）
   */
  @Put('user/:userId')
  @ApiOperation({ summary: '设置指定用户绑定的门店（超管用）' })
  async bindUserShops(
    @Param('userId') userId: string,
    @Body() dto: BindShopsDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new BadRequestException('仅超级管理员可管理用户门店绑定');
    }
    if (!Array.isArray(dto.shopIds)) {
      throw new BadRequestException('shopIds 必须为数组');
    }
    await this.userShopService.bindShops(userId, dto.shopIds);
    return ApiRes.ok();
  }
}
