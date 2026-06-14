import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintStandardTemplateService } from '../../service/paint-standard-template.service';
import { PaintCategoryService } from '../../service/paint-category.service';
import { PaintSpecialPaintService } from '../../service/paint-special-paint.service';
import { CreateStandardTemplateDto, UpdateStandardTemplateDto } from '../dto/standard-template.dto';
import { ApiRes } from '@lib/infra/rest/res.response';

@ApiTags('Paint - StandardTemplate')
@Controller('paint/standard-template')
export class PaintStandardTemplateController {
  constructor(
    private readonly templateService: PaintStandardTemplateService,
    private readonly categoryService: PaintCategoryService,
    private readonly specialPaintService: PaintSpecialPaintService,
  ) {}

  // ==================== 部位管理 ====================

  @Get('categories')
  @ApiOperation({ summary: '获取所有部位' })
  async findAllCategories() {
    const data = await this.categoryService.findAll();
    return ApiRes.success(data);
  }

  @Post('categories')
  @ApiOperation({ summary: '创建部位' })
  async createCategory(@Body() body: { name: string; code: string; sortOrder?: number; isSpecial?: boolean }) {
    const data = await this.categoryService.create(body);
    return ApiRes.success(data);
  }

  @Put('categories/:id')
  @ApiOperation({ summary: '更新部位' })
  async updateCategory(@Param('id') id: string, @Body() body: { name?: string; code?: string; sortOrder?: number; isSpecial?: boolean }) {
    const data = await this.categoryService.update(id, body);
    return ApiRes.success(data);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: '删除部位' })
  async deleteCategory(@Param('id') id: string) {
    await this.categoryService.delete(id);
    return ApiRes.ok();
  }

  // ==================== 特殊车漆管理 ====================

  @Get('special-paints')
  @ApiOperation({ summary: '获取特殊车漆列表' })
  async findSpecialPaints(@Query('activeOnly') activeOnly?: string) {
    const data = await this.specialPaintService.findAll(activeOnly === 'true');
    return ApiRes.success(data);
  }

  @Post('special-paint')
  @ApiOperation({ summary: '创建特殊车漆' })
  async createSpecialPaint(@Body() body: { name: string; multiplier: number; description?: string; isActive?: boolean }) {
    const data = await this.specialPaintService.create(body);
    return ApiRes.success(data);
  }

  @Put('special-paint')
  @ApiOperation({ summary: '更新特殊车漆' })
  async updateSpecialPaint(@Body() body: { id: string; name?: string; multiplier?: number; description?: string; isActive?: boolean }) {
    const { id, ...data } = body;
    const result = await this.specialPaintService.update(id, data);
    return ApiRes.success(result);
  }

  @Delete('special-paint/:id')
  @ApiOperation({ summary: '删除特殊车漆' })
  async deleteSpecialPaint(@Param('id') id: string) {
    await this.specialPaintService.delete(id);
    return ApiRes.ok();
  }

  // ==================== 标准模板管理 ====================

  @Get('list')
  @ApiOperation({ summary: '获取所有标准模板' })
  async findAll() {
    const data = await this.templateService.findAll();
    return ApiRes.success(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取标准模板详情' })
  async findById(@Param('id') id: string) {
    const data = await this.templateService.findById(id);
    return ApiRes.success(data);
  }

  @Post()
  @ApiOperation({ summary: '创建标准模板' })
  async create(@Body() dto: CreateStandardTemplateDto) {
    const data = await this.templateService.create(dto);
    return ApiRes.success(data);
  }

  @Put()
  @ApiOperation({ summary: '更新标准模板' })
  async update(@Body() dto: UpdateStandardTemplateDto) {
    const data = await this.templateService.update(dto);
    return ApiRes.success(data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除标准模板' })
  async delete(@Param('id') id: string) {
    await this.templateService.delete(id);
    return ApiRes.ok();
  }

  @Post('apply')
  @ApiOperation({ summary: '将标准模板应用到门店' })
  async applyToShop(@Body() body: { templateId: string; shopId: string }) {
    const data = await this.templateService.applyToShop(body.templateId, body.shopId);
    return ApiRes.success(data);
  }
}
