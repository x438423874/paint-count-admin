import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintStandardService } from '../../service/paint-standard.service';
import { ApiRes } from '@lib/infra/rest/res.response';

@ApiTags('Paint - Standard')
@Controller('paint/standard')
export class PaintStandardController {
  constructor(private readonly standardService: PaintStandardService) {}

  @Get('shop/:shopId')
  @ApiOperation({ summary: '获取门店的幅数标准' })
  async findByShopId(@Param('shopId') shopId: string) {
    const data = await this.standardService.findByShopId(shopId);
    return ApiRes.success(data);
  }

  @Get('shop/:shopId/categories')
  @ApiOperation({ summary: '获取门店可用类别及标准（全局+自定义）' })
  async findShopCategoriesWithStandard(@Param('shopId') shopId: string) {
    const data = await this.standardService.findShopCategoriesWithStandard(shopId);
    return ApiRes.success(data);
  }

  @Post('shop/:shopId')
  @ApiOperation({ summary: '批量设置门店幅数标准' })
  async setShopStandards(
    @Param('shopId') shopId: string,
    @Body() body: { standards: { categoryId: string; coefficient: number; newPartAddition?: number; alias?: string }[] },
  ) {
    const data = await this.standardService.setShopStandards(shopId, body.standards);
    return ApiRes.success(data);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新单个幅数标准' })
  async updateStandard(@Param('id') id: string, @Body() body: { coefficient?: number; newPartAddition?: number; alias?: string }) {
    const data = await this.standardService.updateStandard(id, body);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除单个幅数标准' })
  async deleteStandard(@Param('id') id: string) {
    await this.standardService.deleteStandard(id);
    return ApiRes.ok();
  }
}
