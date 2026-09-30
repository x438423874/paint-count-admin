import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '姓名' })
  @IsOptional()
  @IsString()
  realName?: string;

  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phoneNumber?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
