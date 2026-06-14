import { Controller, Get, Post, Put, Delete, Body, Query, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintShopService } from '../../service/paint-shop.service';
import { CreateShopDto, UpdateShopDto, PageShopDto } from '../dto/shop.dto';
import { ApiRes } from '@lib/infra/rest/res.response';

@ApiTags('Paint - Shop')
@Controller('paint/shop')
export class PaintShopController {
  constructor(private readonly shopService: PaintShopService) {}

  @Post()
  @ApiOperation({ summary: '创建店铺' })
  async create(@Body() dto: CreateShopDto) {
    const data = await this.shopService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @ApiOperation({ summary: '更新店铺' })
  async update(@Body() dto: UpdateShopDto) {
    const data = await this.shopService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除店铺' })
  async delete(@Param('id') id: string) {
    await this.shopService.delete(id);
    return ApiRes.ok();
  }

  @Get('list')
  @ApiOperation({ summary: '获取所有店铺列表' })
  async findAll() {
    const data = await this.shopService.findAll();
    return ApiRes.success(data);
  }

  @Get('page')
  @ApiOperation({ summary: '分页查询店铺' })
  async page(@Query() dto: PageShopDto) {
    const data = await this.shopService.page(dto);
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取店铺详情(含幅数标准)' })
  async findById(@Param('id') id: string) {
    const data = await this.shopService.findById(id);
    return ApiRes.success(data);
  }
}
