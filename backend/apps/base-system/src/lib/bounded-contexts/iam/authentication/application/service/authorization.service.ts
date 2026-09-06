import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { EndpointProperties } from '@app/base-system/lib/bounded-contexts/api-endpoint/api-endpoint/domain/endpoint.read.model';
import { FindEndpointsByIdsQuery } from '@app/base-system/lib/bounded-contexts/api-endpoint/api-endpoint/queries/endpoints.by-ids.query';
import { DomainProperties } from '@app/base-system/lib/bounded-contexts/iam/domain/domain/domain.read.model';
import { FindDomainByCodeQuery } from '@app/base-system/lib/bounded-contexts/iam/domain/queries/domain.by-code.query';
import { MenuProperties } from '@app/base-system/lib/bounded-contexts/iam/menu/domain/menu.read.model';
import { MenuIdsByUserIdAndDomainQuery } from '@app/base-system/lib/bounded-contexts/iam/menu/queries/menu-ids.by-user_id&domain.query';
import { MenusByIdsQuery } from '@app/base-system/lib/bounded-contexts/iam/menu/queries/menus.by-ids.query';
import { RoleProperties } from '@app/base-system/lib/bounded-contexts/iam/role/domain/role.read.model';
import { FindRoleByIdQuery } from '@app/base-system/lib/bounded-contexts/iam/role/queries/role.by-id.query';

import { ISecurityConfig, SecurityConfig } from '@lib/config';
import { CacheConstant } from '@lib/constants/cache.constant';
import { AuthZRBACService } from '@lib/infra/casbin';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { RedisUtility } from '@lib/shared/redis/redis.util';

import { RoleAssignPermissionCommand } from '../../commands/role-assign-permission.command';
import { RoleAssignRouteCommand } from '../../commands/role-assign-route.command';
import { RoleAssignUserCommand } from '../../commands/role-assign-user.command';
import { UserProperties } from '../../domain/user.read.model';
import { UserIdsByRoleIdQuery } from '../../queries/user-ids.by-role_id.query';
import { UsersByIdsQuery } from '../../queries/users.by-ids.query';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly authZRBACService: AuthZRBACService,
    private readonly prisma: PrismaService,
    @Inject(SecurityConfig.KEY)
    private readonly securityConfig: ISecurityConfig,
  ) {}

  async assignPermission(command: RoleAssignPermissionCommand) {
    const { domainCode, roleCode } = await this.checkDomainAndRole(
      command.domain,
      command.roleId,
    );

    const permissions = await this.queryBus.execute<
      FindEndpointsByIdsQuery,
      EndpointProperties[]
    >(new FindEndpointsByIdsQuery(command.permissions));
    if (!permissions.length) {
      throw new NotFoundException('One or more permissions not found.');
    }

    const existingPermissions =
      await this.authZRBACService.enforcer.getFilteredPolicy(
        0,
        roleCode,
        '',
        '',
        domainCode,
      );

    await this.syncRolePermissions(
      roleCode,
      domainCode,
      permissions,
      existingPermissions,
    );
  }

  async assignRoutes(command: RoleAssignRouteCommand) {
    const { domainCode, roleId } = await this.checkDomainAndRole(
      command.domain,
      command.roleId,
    );

    const routes = await this.queryBus.execute<
      MenusByIdsQuery,
      MenuProperties[]
    >(new MenusByIdsQuery(command.menuIds));
    if (!routes.length) {
      throw new NotFoundException('One or more routes not found.');
    }

    const existingRouteIds = await this.queryBus.execute<
      MenuIdsByUserIdAndDomainQuery,
      number[]
    >(new MenuIdsByUserIdAndDomainQuery(roleId, domainCode));

    const newRouteIds = command.menuIds.filter(
      (id) => !existingRouteIds.includes(id),
    );
    const routeIdsToDelete = existingRouteIds.filter(
      (id) => !command.menuIds.includes(id),
    );

    const operations = [
      ...newRouteIds.map((routeId) =>
        this.prisma.sysRoleMenu.create({
          data: {
            roleId: roleId,
            menuId: routeId,
            domain: domainCode,
          },
        }),
      ),
      ...routeIdsToDelete.map((routeId) =>
        this.prisma.sysRoleMenu.deleteMany({
          where: {
            roleId: roleId,
            menuId: routeId,
            domain: domainCode,
          },
        }),
      ),
    ];

    await this.prisma.$transaction(operations);
  }

  async assignUsers(command: RoleAssignUserCommand) {
    await this.checkRole(command.roleId);

    const users = await this.queryBus.execute<
      UsersByIdsQuery,
      UserProperties[]
    >(new UsersByIdsQuery(command.userIds));
    if (!users.length) {
      throw new NotFoundException('One or more users not found.');
    }

    const existingUserIds = await this.queryBus.execute<
      UserIdsByRoleIdQuery,
      string[]
    >(new UserIdsByRoleIdQuery(command.roleId));

    const newUserIds = command.userIds.filter(
      (id) => !existingUserIds.includes(id),
    );
    const userIdsToDelete = existingUserIds.filter(
      (id) => !command.userIds.includes(id),
    );

    const operations = [
      ...newUserIds.map((userId) =>
        this.prisma.sysUserRole.create({
          data: {
            roleId: command.roleId,
            userId: userId,
          },
        }),
      ),
      ...userIdsToDelete.map((userId) =>
        this.prisma.sysUserRole.deleteMany({
          where: {
            roleId: command.roleId,
            userId: userId,
          },
        }),
      ),
    ];

    await this.prisma.$transaction(operations);
  }

  /**
   * 查询用户已分配的角色 ID 列表
   */
  async getUserRoleIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.sysUserRole.findMany({
      where: { userId },
      select: { roleId: true },
    });

    return rows.map((row) => row.roleId);
  }

  /**
   * 以用户为中心分配角色：全量覆盖该用户的角色，并同步刷新 Redis 角色缓存，
   * 避免分配后仍读旧缓存导致权限不生效（用户无需重新登录）。
   */
  async assignUserRoles(userId: string, roleIds: string[]) {
    const users = await this.queryBus.execute<UsersByIdsQuery, UserProperties[]>(
      new UsersByIdsQuery([userId]),
    );
    if (!users.length) {
      throw new NotFoundException('用户不存在');
    }

    if (roleIds.length) {
      const roles = await this.prisma.sysRole.findMany({
        where: { id: { in: roleIds } },
        select: { id: true },
      });
      if (roles.length !== roleIds.length) {
        throw new NotFoundException('一个或多个角色不存在');
      }
    }

    await this.prisma.$transaction([
      this.prisma.sysUserRole.deleteMany({ where: { userId } }),
      ...roleIds.map((roleId) =>
        this.prisma.sysUserRole.create({ data: { userId, roleId } }),
      ),
    ]);

    await this.refreshUserRolesCache(userId);
  }

  /**
   * 刷新 Redis 中的用户角色缓存（存角色 code 集合），与登录时写入保持一致
   */
  private async refreshUserRolesCache(userId: string) {
    const rows = await this.prisma.sysUserRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    const roleIds = rows.map((row) => row.roleId);
    const roles = await this.prisma.sysRole.findMany({
      where: { id: { in: roleIds } },
      select: { code: true },
    });
    const codes = roles.map((role) => role.code);

    const key = `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`;
    await RedisUtility.instance.del(key);
    if (codes.length > 0) {
      await RedisUtility.instance.sadd(key, ...codes);
      await RedisUtility.instance.expire(key, this.securityConfig.jwtExpiresIn);
    }
  }

  private async checkDomainAndRole(domainCode: string, roleId: string) {
    const domain = await this.queryBus.execute<
      FindDomainByCodeQuery,
      Readonly<DomainProperties> | null
    >(new FindDomainByCodeQuery(domainCode));
    if (!domain) {
      throw new NotFoundException('Domain not found.');
    }

    const { roleCode } = await this.checkRole(roleId);

    return { domainCode: domain.code, roleId, roleCode };
  }

  private async checkRole(roleId: string) {
    const role = await this.queryBus.execute<
      FindRoleByIdQuery,
      Readonly<RoleProperties> | null
    >(new FindRoleByIdQuery(roleId));
    if (!role) {
      throw new NotFoundException('Role not found.');
    }

    return { roleCode: role.code };
  }

  private async syncRolePermissions(
    roleCode: string,
    domain: string,
    newPermissions: EndpointProperties[],
    existingPermissions: string[][],
  ): Promise<void> {
    // 转换新权限为 Casbin 策略格式
    const newPermSet = new Set(
      newPermissions.map((perm) =>
        JSON.stringify([roleCode, perm.resource, perm.action, domain, 'allow']),
      ),
    );

    const existingPermSet = new Set(
      existingPermissions.map((perm) => JSON.stringify(perm)),
    );

    // 删除在新权限中不存在的现有权限
    for (const perm of existingPermissions) {
      if (!newPermSet.has(JSON.stringify(perm))) {
        await this.authZRBACService.enforcer.removeFilteredPolicy(
          0,
          roleCode,
          perm[1],
          perm[2],
          domain,
        );
      }
    }

    // 添加不存在的新权限
    for (const perm of newPermissions) {
      const permArray = [roleCode, perm.resource, perm.action, domain, 'allow'];
      if (!existingPermSet.has(JSON.stringify(permArray))) {
        await this.authZRBACService.enforcer.addPermissionForUser(
          roleCode,
          perm.resource,
          perm.action,
          domain,
        );
      }
    }
  }
}
