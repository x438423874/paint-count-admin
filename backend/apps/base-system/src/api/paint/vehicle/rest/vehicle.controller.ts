import { Controller, Get, Post, Put, Delete, Body, Query, Param, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthZGuard, UsePermissions } from '@lib/infra/casbin';
import { Log } from '@lib/infra/decorators/log.decorator';
import { AuthenticatedRequest } from '@lib/infra/guard/auth-request.type';
import { ApiRes } from '@lib/infra/rest/res.response';

import { PaintVehicleService } from '../../service/paint-vehicle.service';
import { UserShopService } from '../../service/user-shop.service';
import { CreateVehicleDto, UpdateVehicleDto, PageVehicleDto } from '../dto/vehicle.dto';

/**
 * 车辆主数据按车牌全局唯一、跨门店共享（录单自动 upsert 走服务内部，不受此权限限制）。
 * 读接口维持登录 + 数据权限过滤；写操作要求 paint:vehicle 权限点（限管理角色）。
 */
@ApiTags('Paint - Vehicle')
@Log('车辆管理')
@UseGuards(AuthZGuard)
@Controller('paint/vehicle')
export class PaintVehicleController {
  constructor(
    private readonly vehicleService: PaintVehicleService,
    private readonly userShopService: UserShopService,
  ) {}

  @Post()
  @UsePermissions({ resource: 'paint:vehicle', action: 'create' })
  @ApiOperation({ summary: '创建车辆/客户主数据' })
  async create(@Body() dto: CreateVehicleDto) {
    const data = await this.vehicleService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @UsePermissions({ resource: 'paint:vehicle', action: 'update' })
  @ApiOperation({ summary: '更新车辆/客户主数据' })
  async update(@Body() dto: UpdateVehicleDto) {
    const data = await this.vehicleService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @UsePermissions({ resource: 'paint:vehicle', action: 'delete' })
  @ApiOperation({ summary: '删除车辆（关联工单 vehicleId 自动置空，工单数据不删除）' })
  async delete(@Param('id') id: string) {
    await this.vehicleService.delete(id);
    return ApiRes.ok();
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询车辆（按数据权限过滤）' })
  async page(@Query() dto: PageVehicleDto, @Request() req: AuthenticatedRequest) {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.vehicleService.page(dto, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get('list')
  @ApiOperation({ summary: '车辆列表（精简，用于下拉/联想）' })
  async list(@Query('keyword') keyword: string, @Request() req: AuthenticatedRequest) {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.vehicleService.list(keyword, accessibleShopIds);
    return ApiRes.success(data);
  }

  @Get('by-plate/:plateNumber')
  @ApiOperation({ summary: '按车牌号查询车辆（工单表单自动填充用）' })
  async findByPlate(@Param('plateNumber') plateNumber: string) {
    const data = await this.vehicleService.findByPlateNumber(plateNumber);
    return ApiRes.success(data);
  }

  @Get(':id/history-orders')
  @ApiOperation({ summary: '查询车辆历史工单（含统计摘要）' })
  async getHistory(
    @Param('id') id: string,
    @Query('scope') scope: 'current_shop' | 'all_shops' = 'all_shops',
    @Query('shopId') shopId: string | undefined,
    @Query('current') current: number = 1,
    @Query('size') size: number = 20,
    @Request() req: AuthenticatedRequest,
  ) {
    const accessibleShopIds = await this.userShopService.getAccessibleShopIds(req.user.uid);
    const data = await this.vehicleService.getHistoryOrders(id, accessibleShopIds, {
      current,
      size,
      scope,
      shopId,
    });
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '车辆详情' })
  async findById(@Param('id') id: string) {
    const data = await this.vehicleService.findById(id);
    return ApiRes.success(data);
  }
}
