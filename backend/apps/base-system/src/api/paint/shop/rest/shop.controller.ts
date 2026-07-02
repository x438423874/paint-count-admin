import { Controller, Get, Post, Put, Delete, Body, Query, Param, Request, ForbiddenException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintShopService } from '../../service/paint-shop.service';
import { UserShopService } from '../../service/user-shop.service';
import { CreateShopDto, UpdateShopDto, PageShopDto } from '../dto/shop.dto';
import { ApiRes } from '@lib/infra/rest/res.response';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';

@ApiTags('Paint - Shop')
@Controller('paint/shop')
export class PaintShopController {
  constructor(
    private readonly shopService: PaintShopService,
    private readonly userShopService: UserShopService,
  ) {}

  @Post()
  @ApiOperation({ summary: '创建店铺（仅超管）' })
  async create(@Body() dto: CreateShopDto, @Request() req: AuthenticatedRequest) {
    // 仅超管可创建门店
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new ForbiddenException('仅超级管理员可创建门店');
    }
    const data = await this.shopService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @ApiOperation({ summary: '更新店铺（仅超管）' })
  async update(@Body() dto: UpdateShopDto, @Request() req: AuthenticatedRequest) {
    // 仅超管可修改门店信息
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new ForbiddenException('仅超级管理员可修改门店信息');
    }
    const data = await this.shopService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除店铺（仅超管）' })
  async delete(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    // 仅超管可删除门店
    const isSuperAdmin = await this.userShopService.isSuperAdmin(req.user.uid);
    if (!isSuperAdmin) {
      throw new ForbiddenException('仅超级管理员可删除门店');
    }
    await this.shopService.delete(id);
    return ApiRes.ok();
  }

  @Get('list')
  @ApiOperation({ summary: '获取店铺列表（按当前用户权限过滤）' })
  async findAll(@Request() req: AuthenticatedRequest) {
    // 数据权限：返回当前用户可访问的门店列表
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.shopService.findAll(accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询店铺（按当前用户权限过滤）' })
  async page(@Query() dto: PageShopDto, @Request() req: AuthenticatedRequest) {
    // 数据权限：非超管/财务仅返回自己绑定的门店
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.shopService.page(dto, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取店铺详情(含幅数标准)' })
  async findById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    // 数据权限：校验用户是否有权访问该门店
    await this.userShopService.assertShopAccess(req.user.uid, id);
    const data = await this.shopService.findById(id);
    return ApiRes.success(data);
  }
}
