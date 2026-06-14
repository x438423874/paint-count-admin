import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaintStandardTemplateService } from '../../service/paint-standard-template.service';
import { CreateStandardTemplateDto, UpdateStandardTemplateDto } from '../dto/standard-template.dto';
import { ApiRes } from '@lib/infra/rest/res.response';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@ApiTags('Paint - StandardTemplate')
@Controller('paint/standard-template')
export class PaintStandardTemplateController {
  constructor(
    private readonly templateService: PaintStandardTemplateService,
    private readonly prisma: PrismaService
  ) {}

  @Get('categories')
  @ApiOperation({ summary: '获取所有项目类别（用于标准模板编辑）' })
  async findAllCategories() {
    const data = await this.prisma.paintItemCategory.findMany({
      where: { shopId: null },
      orderBy: [{ sortOrder: 'asc' }],
    });
    return ApiRes.success(data);
  }

  @Post('categories')
  @ApiOperation({ summary: '创建部位' })
  async createCategory(@Body() body: { name: string; code: string; sortOrder?: number; isSpecial?: boolean }) {
    if (!body.name?.trim()) return ApiRes.error(400, '部位名称不能为空');
    if (!body.code?.trim()) return ApiRes.error(400, '部位编码不能为空');
    // 检查编码唯一性
    const existing = await this.prisma.paintItemCategory.findFirst({ where: { code: body.code } });
    if (existing) return ApiRes.error(400, '部位编码已存在');
    const data = await this.prisma.paintItemCategory.create({
      data: {
        name: body.name.trim(),
        code: body.code.trim(),
        sortOrder: body.sortOrder ?? 0,
        isSpecial: body.isSpecial ?? false,
        shopId: null,
      },
    });
    return ApiRes.success(data);
  }

  @Put('categories/:id')
  @ApiOperation({ summary: '更新部位' })
  async updateCategory(@Param('id') id: string, @Body() body: { name?: string; code?: string; sortOrder?: number; isSpecial?: boolean }) {
    const data = await this.prisma.paintItemCategory.update({
      where: { id },
      data: body,
    });
    return ApiRes.success(data);
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: '删除部位' })
  async deleteCategory(@Param('id') id: string) {
    // 检查是否被模板引用
    const templateItemCount = await this.prisma.paintStandardTemplateItem.count({ where: { categoryId: id } });
    if (templateItemCount > 0) {
      return ApiRes.error(400, `该部位已被 ${templateItemCount} 个标准模板项目引用，无法删除`);
    }
    // 检查是否被工单引用
    const orderItemCount = await this.prisma.paintWorkOrderItem.count({ where: { categoryId: id } });
    if (orderItemCount > 0) {
      return ApiRes.error(400, `该部位已被 ${orderItemCount} 个工单引用，无法删除`);
    }
    await this.prisma.paintItemCategory.delete({ where: { id } });
    return ApiRes.ok();
  }

  @Get('special-paints')
  @ApiOperation({ summary: '获取特殊车漆列表' })
  async findSpecialPaints(@Query('activeOnly') activeOnly?: string) {
    const where: any = {};
    if (activeOnly === 'true') where.isActive = true;
    const data = await this.prisma.paintSpecialPaint.findMany({ where, orderBy: { name: 'asc' } });
    return ApiRes.success(data);
  }

  @Post('special-paint')
  @ApiOperation({ summary: '创建特殊车漆' })
  async createSpecialPaint(@Body() body: { name: string; multiplier: number; description?: string; isActive?: boolean }) {
    if (!body.name?.trim()) return ApiRes.error(400, '车漆名称不能为空');
    if (!body.multiplier || body.multiplier < 1) return ApiRes.error(400, '倍数必须大于等于1');
    // 检查名称唯一性
    const existing = await this.prisma.paintSpecialPaint.findFirst({ where: { name: body.name.trim() } });
    if (existing) return ApiRes.error(400, '车漆名称已存在');
    const data = await this.prisma.paintSpecialPaint.create({
      data: { name: body.name.trim(), multiplier: body.multiplier, description: body.description, isActive: body.isActive ?? true },
    });
    return ApiRes.success(data);
  }

  @Put('special-paint')
  @ApiOperation({ summary: '更新特殊车漆' })
  async updateSpecialPaint(@Body() body: { id: string; name?: string; multiplier?: number; description?: string; isActive?: boolean }) {
    const { id, ...data } = body;
    const result = await this.prisma.paintSpecialPaint.update({ where: { id }, data });
    return ApiRes.success(result);
  }

  @Delete('special-paint/:id')
  @ApiOperation({ summary: '删除特殊车漆' })
  async deleteSpecialPaint(@Param('id') id: string) {
    // 检查是否被模板引用
    const templateItemCount = await this.prisma.paintStandardTemplateItem.count({ where: { specialPaintId: id } });
    if (templateItemCount > 0) {
      return ApiRes.error(400, `该特殊车漆已被 ${templateItemCount} 个标准模板项目引用，无法删除`);
    }
    // 检查是否被工单引用
    const orderItemCount = await this.prisma.paintWorkOrderItem.count({ where: { specialPaintId: id } });
    if (orderItemCount > 0) {
      return ApiRes.error(400, `该特殊车漆已被 ${orderItemCount} 个工单引用，无法删除`);
    }
    await this.prisma.paintSpecialPaint.delete({ where: { id } });
    return ApiRes.ok();
  }

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
