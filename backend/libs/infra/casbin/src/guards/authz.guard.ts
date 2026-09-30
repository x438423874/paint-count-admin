import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '@lib/shared/prisma/prisma.service';

import {
  AUTHZ_MODULE_OPTIONS,
  PERMISSIONS_METADATA,
} from '../constants/authz.constants';
import { AuthZModuleOptions, Permission } from '../interfaces';

/** 超管角色码：拥有全部权限 */
const SUPER_ROLE_CODES = new Set(['ROLE_SUPER', 'R_SUPER']);
/** 权限集合缓存 TTL：菜单授权变更后最多 30s 全端生效 */
const PERM_CACHE_TTL_MS = 30_000;
/** 通配标记：超管放行 */
const ALL_PERMISSIONS = '*';

/**
 * 芋道式菜单权限守卫（原 casbin enforce 已废弃）：
 * 鉴权数据源 = 用户角色 → sys_role_menu → sys_menu.permission 权限标识串。
 * @UsePermissions({resource, action}) 装饰器签名不变，
 * 校验规则为用户权限串集合是否包含 `${resource}:${action}`。
 */
@Injectable()
export class AuthZGuard implements CanActivate {
  /** uid → 权限串集合（进程内 TTL 缓存） */
  private static permCache = new Map<string, { perms: Set<string>; expires: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(AUTHZ_MODULE_OPTIONS) private readonly options: AuthZModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions: Permission[] | undefined = this.reflector.get<Permission[]>(
      PERMISSIONS_METADATA,
      context.getHandler(),
    );
    if (!permissions) {
      return true;
    }

    const user = this.options.userFromContext(context);
    if (!user) {
      throw new UnauthorizedException('未登录或登录已失效');
    }

    const userPerms = await this.loadUserPermissions(user.uid);

    return permissions.every((permission) =>
      userPerms.has(ALL_PERMISSIONS) || userPerms.has(`${permission.resource}:${permission.action}`),
    );
  }

  /**
   * 加载用户权限串集合（进程内 30s 缓存）。
   * 超管返回含通配符 `*` 的集合。
   */
  private async loadUserPermissions(uid: string): Promise<Set<string>> {
    const cached = AuthZGuard.permCache.get(uid);
    if (cached && cached.expires > Date.now()) {
      return cached.perms;
    }

    const perms = await this.queryUserPermissions(uid);
    // 防止 Map 无限增长：超阈值时先清理已过期条目
    if (AuthZGuard.permCache.size >= 500) {
      const now = Date.now();
      for (const [key, entry] of AuthZGuard.permCache) {
        if (entry.expires <= now) AuthZGuard.permCache.delete(key);
      }
    }
    AuthZGuard.permCache.set(uid, { perms, expires: Date.now() + PERM_CACHE_TTL_MS });
    return perms;
  }

  private async queryUserPermissions(uid: string): Promise<Set<string>> {
    const perms = new Set<string>();

    const userRoles = await this.prisma.sysUserRole.findMany({
      where: { userId: uid },
      select: { roleId: true },
    });
    if (userRoles.length === 0) return perms;
    const roleIds = userRoles.map((r) => r.roleId);

    const roles = await this.prisma.sysRole.findMany({
      where: { id: { in: roleIds } },
      select: { code: true },
    });
    if (roles.some((r) => SUPER_ROLE_CODES.has(r.code))) {
      perms.add(ALL_PERMISSIONS);
      return perms;
    }

    const roleMenus = await this.prisma.sysRoleMenu.findMany({
      where: { roleId: { in: roleIds } },
      select: { menuId: true },
    });
    const menuIds = [...new Set(roleMenus.map((rm) => rm.menuId))];
    if (menuIds.length === 0) return perms;

    const menus = await this.prisma.sysMenu.findMany({
      where: { id: { in: menuIds }, permission: { not: null } },
      select: { permission: true },
    });
    for (const menu of menus) {
      if (menu.permission) perms.add(menu.permission);
    }
    return perms;
  }
}
