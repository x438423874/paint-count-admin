import { ApiProperty } from '@nestjs/swagger';
import { Status } from '@prisma/client';

import { UpdateAuditInfo } from '@lib/shared/prisma/db.constant';
import { CreationAuditInfoProperties } from '@lib/typings/global';

export type UserEssentialProperties = Readonly<
  Required<{
    id: string;
    username: string;
    domain: string;
    realName: string | null;
    status: Status;
  }>
>;

export type UserOptionalProperties = Readonly<
  Partial<{
    password: string;
    avatar: string | null;
    email: string | null;
    phoneNumber: string | null;
  }>
>;

export type UserProperties = UserEssentialProperties &
  Required<UserOptionalProperties>;

export type UserCreateProperties = UserProperties & CreationAuditInfoProperties;

export type UserUpdateProperties = Omit<
  UserProperties,
  'password' | 'domain'
> &
  CreationAuditInfoProperties;

/** 用户分页列表项：用户字段 + 绑定角色名 + 绑定门店（含在岗期） */
export type UserPageItem = UserProperties & {
  roles: string[];
  shops: {
    shopId: string;
    shopName: string;
    startAt: Date;
    endAt: Date | null;
  }[];
};

export class UserShopBindingReadModel {
  @ApiProperty({ description: 'Shop id' })
  shopId: string;

  @ApiProperty({ description: 'Shop name' })
  shopName: string;

  @ApiProperty({ description: 'Tenure start time' })
  startAt: Date;

  @ApiProperty({ description: 'Tenure end time, null means on duty', nullable: true })
  endAt: Date | null;
}

export class UserReadModel extends UpdateAuditInfo {
  @ApiProperty({ description: 'The unique identifier of the user' })
  id: string;

  @ApiProperty({ description: 'Username of the user' })
  username: string;

  @ApiProperty({ description: 'Domain associated with the user' })
  domain: string;

  @ApiProperty({ description: 'Real name of the user', nullable: true })
  realName: string | null;

  @ApiProperty({
    description: 'Current status of the user',
    enum: Object.values(Status),
  })
  status: Status;

  @ApiProperty({ description: 'Avatar URL of the user', nullable: true })
  avatar: string | null;

  @ApiProperty({ description: 'Email address of the user', nullable: true })
  email: string | null;

  @ApiProperty({ description: 'Phone number of the user', nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ description: 'Role names bound to the user', type: [String] })
  roles: string[];

  @ApiProperty({
    description: 'Shop bindings with tenure period',
    type: [UserShopBindingReadModel],
  })
  shops: UserShopBindingReadModel[];
}
