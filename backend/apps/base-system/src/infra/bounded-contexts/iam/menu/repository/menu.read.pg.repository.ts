import { Injectable } from '@nestjs/common';
import { MenuType, Status } from '@prisma/client';

import {
  MenuProperties,
  MenuTreeProperties,
} from '@app/base-system/lib/bounded-contexts/iam/menu/domain/menu.read.model';
import { MenuReadRepoPort } from '@app/base-system/lib/bounded-contexts/iam/menu/ports/menu.read.repo-port';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

@Injectable()
export class MenuReadPostgresRepository implements MenuReadRepoPort {
  constructor(private prisma: PrismaService) {}

  async getChildrenMenuCount(id: number): Promise<number> {
    return this.prisma.sysMenu.count({
      where: {
        pid: id,
      },
    });
  }

  async getMenuById(id: number): Promise<Readonly<MenuProperties> | null> {
    return this.prisma.sysMenu.findUnique({
      where: { id },
    });
  }

  async findMenusByRoleCode(
    roleCode: string[],
    domain: string,
  ): Promise<Readonly<MenuProperties[]> | []> {
    const roles = await this.prisma.sysRole.findMany({
      where: {
        code: {
          in: roleCode,
        },
      },
      select: {
        id: true,
      },
    });

    const roleIds = roles.map((role) => role.id);

    const roleMenus = await this.prisma.sysRoleMenu.findMany({
      where: {
        roleId: { in: roleIds },
        domain: domain,
      },
      select: {
        menuId: true,
      },
    });

    const menuIds = roleMenus.map((rm) => rm.menuId);

    if (menuIds.length > 0) {
      // 按钮型菜单只承载权限标识，不参与路由构建
      return this.prisma.sysMenu.findMany({
        where: {
          id: { in: menuIds },
          status: Status.ENABLED,
          menuType: { not: MenuType.button },
        },
      });
    }

    return [];
  }

  async findMenusByRoleId(
    roleId: string,
    domain: string,
  ): Promise<Readonly<MenuProperties[]> | []> {
    const roleMenus = await this.prisma.sysRoleMenu.findMany({
      where: {
        roleId: roleId,
        domain: domain,
      },
      select: {
        menuId: true,
      },
    });

    const menuIds = roleMenus.map((rm) => rm.menuId);

    if (menuIds.length > 0) {
      // 授权回显数据源：包含按钮型菜单行（菜单+按钮同一份绑定存储）
      return this.prisma.sysMenu.findMany({
        where: {
          id: { in: menuIds },
          status: Status.ENABLED,
          constant: false,
        },
      });
    }

    return [];
  }

  async getConstantRoutes(): Promise<Readonly<MenuProperties[]> | []> {
    return this.prisma.sysMenu.findMany({
      where: {
        constant: true,
        status: Status.ENABLED,
      },
    });
  }

  async findAll(): Promise<MenuTreeProperties[] | []> {
    return this.prisma.sysMenu.findMany();
  }

  async findAllConstantMenu(
    constant: boolean,
  ): Promise<MenuTreeProperties[] | []> {
    return this.prisma.sysMenu.findMany({
      where: {
        constant: constant,
      },
    });
  }

  async findMenusByIds(ids: number[]): Promise<MenuProperties[]> {
    return this.prisma.sysMenu.findMany({
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  async findMenuIdsByUserId(userId: string, domain: string): Promise<number[]> {
    const roleIds = await this.prisma.sysUserRole
      .findMany({
        where: {
          userId,
        },
        select: {
          roleId: true,
        },
      })
      .then((results) => results.map((item) => item.roleId));

    return this.prisma.sysRoleMenu
      .findMany({
        where: {
          roleId: {
            in: roleIds,
          },
          domain,
        },
        select: {
          menuId: true,
        },
      })
      .then((results) => results.map((item) => item.menuId));
  }
}
