import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class StandardTemplateItemDto {
  @ApiProperty({ description: '项目类别ID' })
  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ description: '系数' })
  @IsNotEmpty()
  @Type(() => Number)
  coefficient: number;

  @ApiPropertyOptional({ description: '新件加幅' })
  @IsOptional()
  @Type(() => Number)
  newPartAddition?: number;

  @ApiPropertyOptional({ description: '别名' })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiPropertyOptional({ description: '特殊车漆ID' })
  @IsOptional()
  @IsString()
  specialPaintId?: string;
}

export class CreateStandardTemplateDto {
  @ApiProperty({ description: '标准名称' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '标准描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '版本号' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '标准项目列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StandardTemplateItemDto)
  @IsOptional()
  items?: StandardTemplateItemDto[];
}

export class UpdateStandardTemplateDto {
  @ApiProperty({ description: '标准ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '标准名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '标准描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '版本号' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '标准项目列表，传入则整体替换' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StandardTemplateItemDto)
  @IsOptional()
  items?: StandardTemplateItemDto[];
}
