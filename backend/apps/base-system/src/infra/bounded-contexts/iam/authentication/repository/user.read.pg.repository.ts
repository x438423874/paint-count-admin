import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  UserPageItem,
  UserProperties,
} from '@app/base-system/lib/bounded-contexts/iam/authentication/domain/user.read.model';
import { UserReadRepoPort } from '@app/base-system/lib/bounded-contexts/iam/authentication/ports/user.read.repo-port';
import { PageUsersQuery } from '@app/base-system/lib/bounded-contexts/iam/authentication/queries/page-users.query';

import { PaginationResult } from '@lib/shared/prisma/pagination';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class UserReadRepository implements UserReadRepoPort {
  constructor(private prisma: PrismaService) {}

  async findUserById(id: string): Promise<UserProperties | null> {
    return this.prisma.sysUser.findUnique({
      where: { id },
    });
  }

  async findUserIdsByRoleId(roleId: string): Promise<string[]> {
    return this.prisma.sysUserRole
      .findMany({
        where: { roleId },
        select: {
          userId: true,
        },
      })
      .then((results) => results.map((item) => item.userId));
  }

  async findUsersByIds(ids: string[]): Promise<UserProperties[]> {
    return this.prisma.sysUser.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  private readonly USER_ESSENTIAL_FIELDS = {
    id: true,
    username: true,
    domain: true,
    avatar: true,
    email: true,
    phoneNumber: true,
    realName: true,
    status: true,
    createdAt: true,
    createdBy: true,
    updatedAt: true,
    updatedBy: true,
    password: false,
  };

  async findUserByIdentifier(
    identifier: string,
  ): Promise<UserProperties | null> {
    return this.prisma.sysUser.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
          { phoneNumber: identifier },
        ],
      },
    });
  }

  async pageUsers(
    query: PageUsersQuery,
  ): Promise<PaginationResult<UserPageItem>> {
    const where: Prisma.SysUserWhereInput = {};

    if (query.username) {
      where.username = {
        contains: query.username,
      };
    }

    if (query.realName) {
      where.realName = {
        contains: query.realName,
      };
    }

    if (query.status) {
      where.status = query.status;
    }

    const users = await this.prisma.sysUser.findMany({
      where: where,
      skip: (query.current - 1) * query.size,
      take: query.size,
      select: this.USER_ESSENTIAL_FIELDS,
    });

    const total = await this.prisma.sysUser.count({ where: where });

    const items = await this.attachRolesAndShops(users);

    return new PaginationResult<UserPageItem>(
      query.current,
      query.size,
      total,
      items,
    );
  }

  /** 批量补充每个用户的角色名与绑定门店（含在岗期） */
  private async attachRolesAndShops(
    users: UserProperties[],
  ): Promise<UserPageItem[]> {
    if (users.length === 0) return [];

    const userIds = users.map((user) => user.id);

    const [userRoles, roleRows, userShops] = await Promise.all([
      this.prisma.sysUserRole.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, roleId: true },
      }),
      this.prisma.sysRole.findMany({
        select: { id: true, name: true },
      }),
      this.prisma.sysUserShop.findMany({
        where: { userId: { in: userIds } },
        orderBy: { startAt: 'desc' },
        select: {
          userId: true,
          shopId: true,
          startAt: true,
          endAt: true,
          shop: { select: { name: true } },
        },
      }),
    ]);

    const roleNameById = new Map(roleRows.map((role) => [role.id, role.name]));

    const rolesByUser = new Map<string, string[]>();
    for (const userRole of userRoles) {
      const roleName = roleNameById.get(userRole.roleId);
      if (!roleName) continue;
      const list = rolesByUser.get(userRole.userId) ?? [];
      list.push(roleName);
      rolesByUser.set(userRole.userId, list);
    }

    const shopsByUser = new Map<string, UserPageItem['shops']>();
    for (const userShop of userShops) {
      const list = shopsByUser.get(userShop.userId) ?? [];
      list.push({
        shopId: userShop.shopId,
        shopName: userShop.shop.name,
        startAt: userShop.startAt,
        endAt: userShop.endAt,
      });
      shopsByUser.set(userShop.userId, list);
    }

    return users.map((user) => ({
      ...user,
      roles: rolesByUser.get(user.id) ?? [],
      shops: shopsByUser.get(user.id) ?? [],
    }));
  }

  async getUserByUsername(
    username: string,
  ): Promise<Readonly<UserProperties> | null> {
    return this.prisma.sysUser.findUnique({
      where: { username },
    });
  }

  async findRolesByUserId(userId: string): Promise<Set<string>> {
    const userRoles = await this.prisma.sysUserRole.findMany({
      where: {
        userId: userId,
      },
      select: {
        roleId: true,
      },
    });

    const roleIds = userRoles.map((userRole) => userRole.roleId);

    const roles = await this.prisma.sysRole.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
      select: {
        code: true,
      },
    });

    return new Set(roles.map((role) => role.code));
  }
}
