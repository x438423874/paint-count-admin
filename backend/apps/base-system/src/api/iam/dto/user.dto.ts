import { ApiProperty, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class UserCreateDto {
  @ApiProperty({ required: true })
  @IsString({ message: '用户名必须是字符串' })
  @IsNotEmpty({ message: '用户名不能为空' })
  @MinLength(4, { message: '用户名长度不能少于 4 个字符' })
  username: string;

  @ApiProperty({ required: true })
  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码长度不能少于 6 个字符' })
  password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString({ message: '域必须是字符串' })
  domain: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString({ message: '姓名必须是字符串' })
  @Type(() => String)
  realName: string | null;

  @ApiProperty({ type: 'string', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: '头像必须是字符串或 null' })
  @Type(() => String)
  avatar: string | null;

  @ApiProperty({ type: 'string', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: '邮箱必须是字符串或 null' })
  @Type(() => String)
  email: string | null;

  @ApiProperty({ type: 'string', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: '手机号必须是字符串或 null' })
  @Type(() => String)
  phoneNumber: string | null;
}

export class UserUpdateDto extends OmitType(UserCreateDto, [
  'password',
  'domain',
]) {
  @ApiProperty({ required: true })
  @IsString({ message: 'id 必须是字符串' })
  @IsNotEmpty({ message: 'id 不能为空' })
  id: string;

  @ApiProperty({ required: false, nullable: true })
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsOptional()
  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码长度不能少于 6 个字符' })
  password?: string;
}
