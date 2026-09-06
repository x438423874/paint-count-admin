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
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString } from 'class-validator';

import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';

import { UserShopService } from '../../service/user-shop.service';

class BindShopsDto {
  @IsArray({ message: 'shopIds 必须为数组' })
  @Type(() => String)
  shopIds: string[];

  /**
   * 可选：新绑定门店的在岗开始时间（ISO 字符串，key 为 shopId）。
   * 用于回填历史日期（如门店启用系统前的负责人）。未提供的门店默认从当前时间起算。
   */
  @IsOptional()
  startAtMap?: Record<string, string>;
}

class UpdateTenureDto {
  @IsString()
  shopId: string;

  /** 在岗开始时间（ISO 字符串），支持回填历史日期 */
  @IsString()
  startAt: string;

  /** 离岗时间（ISO 字符串）；不传或传 null 表示在岗中 */
  @IsOptional()
  @IsString()
  endAt?: string | null;
}

@ApiTags('Paint - UserShop')
@Controller('paint/user-shop')
export class UserShopController {
  constructor(private readonly userShopService: UserShopService) {}

  /**
   * 获取当前用户的数据可见范围（含各门店在岗期），用于 H5 展示"可查看范围"提示
   */
  @Get('my-scope')
  @ApiOperation({ summary: '获取当前用户数据可见范围（含各门店在岗期）' })
  async getMyScope(@Request() req: AuthenticatedRequest) {
    const data = await this.userShopService.getMyScope(req.user.uid);
    return ApiRes.success(data);
  }

  /**
   * 获取当前用户拥有的权限点集合（后端 PermGuard 与前端按钮显隐共用同一注册表）
   */
  @Get('my-perms')
  @ApiOperation({ summary: '获取当前用户权限点集合' })
  async getMyPerms(@Request() req: AuthenticatedRequest) {
    const data = await this.userShopService.getMyPerms(req.user.uid);
    return ApiRes.success(data);
  }

  /**
   * 获取指定用户绑定的门店列表（仅超管可用，用于用户管理页）
   * 返回含在岗期（startAt/endAt），endAt 有值为已离岗（留痕，仍可只读查看任期内数据）
   */
  @Get('user/:userId')
  @ApiOperation({ summary: '获取指定用户绑定的门店列表含在岗期（超管用）' })
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
   * 语义为"当前在岗门店集合"：移除的门店自动离岗留痕（endAt=now），重新勾选则视为重新上岗
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
    await this.userShopService.bindShops(userId, dto.shopIds, dto.startAtMap);
    return ApiRes.ok();
  }

  /**
   * 调整指定门店绑定的在岗期（仅超管可用：回填历史开始时间 / 修正离岗时间）
   */
  @Put('user/:userId/tenure')
  @ApiOperation({ summary: '调整指定门店绑定的在岗期（超管用）' })
  async updateTenure(
    @Param('userId') userId: string,
    @Body() dto: UpdateTenureDto,
    @Request() req: AuthenticatedRequest,
  ) {
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new BadRequestException('仅超级管理员可管理用户门店绑定');
    }
    if (!dto.shopId || !dto.startAt) {
      throw new BadRequestException('参数不完整');
    }
    const startAt = new Date(dto.startAt);
    const endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (Number.isNaN(startAt.getTime()) || (endAt && Number.isNaN(endAt.getTime()))) {
      throw new BadRequestException('时间格式错误');
    }
    await this.userShopService.updateTenure(userId, dto.shopId, startAt, endAt);
    return ApiRes.ok();
  }
}
