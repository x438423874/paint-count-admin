import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaintStatsCache } from './paint-stats-cache';
import { CacheConstant } from '@lib/constants/cache.constant';
import { RedisUtility } from '@lib/shared/redis/redis.util';

/**
 * 用户-门店绑定服务
 * 实现"用户只能访问绑定门店的数据"的数据权限隔离
 *
 * 角色绕过规则：
 *  - ROLE_SUPER（超级管理员）：不限制，可访问所有门店
 *  - ROLE_FINANCE（财务）：不限制，可查看所有门店数据（只读由按钮权限控制）
 *  - 其他角色：只能访问绑定的门店
 */
@Injectable()
export class UserShopService {
  /** 拥有全门店访问权限的角色代码 */
  private static readonly BYPASS_ROLE_CODES = ['ROLE_SUPER', 'ROLE_FINANCE'];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户绑定的门店ID列表（不含绕过判断，仅返回绑定关系）
   */
  async getBoundShopIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.sysUserShop.findMany({
      where: { userId },
      select: { shopId: true },
    });
    return rows.map((r: any) => r.shopId);
  }

  /**
   * 获取用户可访问的门店ID列表
   * - 超管/财务：返回 null 表示不限制
   * - 其他用户：返回绑定的门店ID列表（可能为空数组）
   */
  async getAccessibleShopIds(userId: string): Promise<string[] | null> {
    if (await this.isBypassUser(userId)) {
      return null; // null = 不限制
    }
    return this.getBoundShopIds(userId);
  }

  /**
   * 判断用户是否为绕过权限的角色（超管/财务）
   */
  async isBypassUser(userId: string): Promise<boolean> {
    const roleCodes = await this.getUserRoleCodes(userId);
    return UserShopService.BYPASS_ROLE_CODES.some((c) => roleCodes.includes(c));
  }

  /**
   * 判断用户是否为超级管理员
   */
  async isSuperAdmin(userId: string): Promise<boolean> {
    const roleCodes = await this.getUserRoleCodes(userId);
    return roleCodes.includes('ROLE_SUPER');
  }

  /**
   * 获取用户的角色代码列表（优先从 Redis 缓存读取，回退到数据库）
   */
  async getUserRoleCodes(userId: string): Promise<string[]> {
    // 优先从登录态缓存读取
    try {
      const cached = await RedisUtility.instance.smembers(
        `${CacheConstant.AUTH_TOKEN_PREFIX}${userId}`,
      );
      if (cached && cached.length > 0) {
        return cached;
      }
    } catch {
      // Redis 不可用时回退到数据库
    }

    // 回退：从数据库查询（SysUserRole 无关联字段，需两步查询）
    const userRoles = await this.prisma.sysUserRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    if (userRoles.length === 0) return [];
    const roleIds = userRoles.map((r: any) => r.roleId);
    const roles = await this.prisma.sysRole.findMany({
      where: { id: { in: roleIds } },
      select: { code: true },
    });
    return roles.map((r: any) => r.code);
  }

  /**
   * 设置用户绑定的门店（全量覆盖）
   */
  async bindShops(userId: string, shopIds: string[]): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      // 1. 删除旧绑定
      await tx.sysUserShop.deleteMany({ where: { userId } });
      // 2. 写入新绑定（去重）
      const uniqueShopIds = [...new Set(shopIds)];
      if (uniqueShopIds.length === 0) return;
      await tx.sysUserShop.createMany({
        data: uniqueShopIds.map((shopId: string) => ({ userId, shopId })),
      });
    });

    // 用户可见门店范围变了，其统计缓存的口径也随之变化，需要全量失效
    PaintStatsCache.invalidate().catch(() => undefined);
  }

  /**
   * 获取用户绑定的门店列表（含门店详细信息）
   */
  async getBoundShops(userId: string) {
    const rows = await this.prisma.sysUserShop.findMany({
      where: { userId },
      select: {
        shop: {
          select: {
            id: true,
            name: true,
            code: true,
            brand: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r: any) => r.shop);
  }

  /**
   * 校验用户是否有权访问指定门店，无权则抛出 ForbiddenException
   * 超管/财务自动通过
   */
  async assertShopAccess(userId: string, shopId: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const boundIds = await this.getBoundShopIds(userId);
    if (!boundIds.includes(shopId)) {
      throw new ForbiddenException('无权访问该门店数据');
    }
  }

  /**
   * 校验用户是否有权操作指定工单（按工单所属门店判断）
   * 超管/财务自动通过
   */
  async assertWorkOrderAccess(userId: string, orderId: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      select: { shopId: true },
    });
    if (!order) return; // 工单不存在时交给业务层抛 NotFoundException
    await this.assertShopAccess(userId, order.shopId);
  }

  /**
   * 批量校验用户是否有权操作多个工单（一次性查询，避免 N+1）
   * 超管/财务自动通过
   */
  async assertWorkOrdersAccess(userId: string, orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    if (await this.isBypassUser(userId)) return;
    // 一次性查询所有工单的 shopId
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, shopId: true },
    });
    if (orders.length === 0) return; // 工单不存在时交给业务层抛 NotFoundException
    // 一次性查询用户绑定的门店
    const boundIds = await this.getBoundShopIds(userId);
    const forbidden = orders.filter((o: any) => !boundIds.includes(o.shopId));
    if (forbidden.length > 0) {
      throw new ForbiddenException('无权操作该门店数据');
    }
  }
}
