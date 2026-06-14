import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateShopDto {
  @ApiProperty({ description: '店铺名称' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '店铺编码' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: '品牌' })
  @IsString()
  @IsNotEmpty()
  brand: string;

  @ApiPropertyOptional({ description: '地址' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '标准模板ID' })
  @IsOptional()
  @IsString()
  standardTemplateId?: string;
}

export class UpdateShopDto {
  @ApiProperty({ description: '店铺ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: '店铺名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '品牌' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ description: '地址' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: '电话' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '标准模板ID' })
  @IsOptional()
  @IsString()
  standardTemplateId?: string;
}

export class PageShopDto {
  @ApiPropertyOptional({ description: '当前页' })
  @Type(() => Number)
  @IsOptional()
  current?: number = 1;

  @ApiPropertyOptional({ description: '每页数量' })
  @Type(() => Number)
  @IsOptional()
  size?: number = 10;

  @ApiPropertyOptional({ description: '店铺名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '品牌' })
  @IsOptional()
  @IsString()
  brand?: string;
}
