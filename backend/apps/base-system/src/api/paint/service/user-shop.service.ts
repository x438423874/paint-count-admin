import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@lib/shared/prisma/prisma.service';
import { PaintStatsCache } from './paint-stats-cache';
import { CacheConstant } from '@lib/constants/cache.constant';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import {
  OrderAccessScope,
  OrderTenure,
  tenureCoversMonth,
  tenureCoversOrder,
} from './paint-calculation';

/**
 * 用户-门店绑定服务
 * 实现"用户只能访问绑定门店的数据"的数据权限隔离
 *
 * 在岗期规则（门店负责人/员工只能看自己在岗时的数据）：
 *  - 绑定行带有 start_at（在岗开始）/ end_at（离岗时间，空 = 在岗中）
 *  - 工单归属口径：结算月份 settlementMonth 优先（工单日期可能录错），未结算按录入时间 createdAt 年月兜底
 *  - 列表/统计：工单归属月份必须落在任期内
 *  - 离岗（end_at 有值）后：保留只读查看任期数据，不能录单/改配置
 *
 * 角色绕过规则：
 *  - ROLE_SUPER（超级管理员）：不限制，可访问所有门店
 *  - ROLE_FINANCE（财务）：不限制，可查看所有门店数据（只读由按钮权限控制）
 *  - 其他角色：只能访问绑定门店任期内的工作单数据
 */
@Injectable()
export class UserShopService {
  /** 拥有全门店访问权限的角色代码 */
  private static readonly BYPASS_ROLE_CODES = ['ROLE_SUPER', 'ROLE_FINANCE'];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户绑定的门店任期列表（含离岗留痕行）
   */
  async getBoundShopRows(
    userId: string,
  ): Promise<{ shopId: string; startAt: Date; endAt: Date | null }[]> {
    const rows = await this.prisma.sysUserShop.findMany({
      where: { userId },
      select: { shopId: true, startAt: true, endAt: true },
    });
    return rows.map((r: any) => ({ shopId: r.shopId, startAt: r.startAt, endAt: r.endAt ?? null }));
  }

  /**
   * 获取用户绑定的门店ID列表（不含绕过判断，仅返回绑定关系，含离岗留痕）
   */
  async getBoundShopIds(userId: string): Promise<string[]> {
    const rows = await this.getBoundShopRows(userId);
    return rows.map(r => r.shopId);
  }

  /**
   * 获取工单数据访问范围（含在岗期）
   * - 超管/财务：{ kind: 'all' } 不限制
   * - 普通用户：按绑定门店的任期过滤；未绑定任何门店 → { kind: 'none' }
   */
  async getOrderAccessScope(userId: string): Promise<OrderAccessScope> {
    if (await this.isBypassUser(userId)) {
      return { kind: 'all' };
    }
    const rows = await this.getBoundShopRows(userId);
    if (rows.length === 0) return { kind: 'none' };
    const tenures: OrderTenure[] = rows.map(r => ({
      shopId: r.shopId,
      startAt: r.startAt,
      endAt: r.endAt,
    }));
    return { kind: 'tenure', tenures };
  }

  /**
   * 获取当前用户拥有的权限点集合（前端按钮显隐用）
   * 来源：Casbin 策略（casbin_rule），与 AuthZGuard 同一数据源；
   * 标识格式 `${resource}:${action}`（如 paint:work-order:audit）
   */
  async getMyPerms(userId: string): Promise<string[]> {
    const codes = await this.getUserRoleCodes(userId);
    if (codes.length === 0) return [];
    const rules = await this.prisma.casbinRule.findMany({
      where: { ptype: 'p', v0: { in: codes }, v1: { startsWith: 'paint:' } },
      select: { v1: true, v2: true },
    });
    return [
      ...new Set(
        rules
          .filter((r) => r.v1 && r.v2)
          .map((r) => `${r.v1}:${r.v2}`),
      ),
    ];
  }

  /**
   * 获取当前用户的数据可见范围摘要（H5 提示用）
   * - all：超管/财务不限制
   * - none：未绑定任何门店
   * - tenure：按绑定门店的在岗期可见（含离岗留痕门店）
   */
  async getMyScope(
    userId: string,
  ): Promise<{
    kind: 'all' | 'none' | 'tenure';
    shops: { shopId: string; shopName: string; startAt: Date; endAt: Date | null }[];
  }> {
    if (await this.isBypassUser(userId)) {
      return { kind: 'all', shops: [] };
    }
    const rows = await this.prisma.sysUserShop.findMany({
      where: { userId },
      select: {
        startAt: true,
        endAt: true,
        shop: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return { kind: 'none', shops: [] };
    return {
      kind: 'tenure',
      shops: rows.map((r: any) => ({
        shopId: r.shop.id,
        shopName: r.shop.name,
        startAt: r.startAt,
        endAt: r.endAt,
      })),
    };
  }

  /**
   * 获取用户可访问的门店ID列表（门店级，不含时间维度，用于门店列表/车辆/配置类接口）
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
   * 判断用户是否拥有指定角色之一
   */
  async hasAnyRole(userId: string, roleCodes: string[]): Promise<boolean> {
    const codes = await this.getUserRoleCodes(userId);
    return roleCodes.some((c) => codes.includes(c));
  }

  /**
   * 断言用户可执行管理类操作（审核/反审核/删除/合并/结算/作废/批量OCR等）
   * 与前端 canAudit/canDelete/canMerge/canSettle/canBatchOcr 的角色约定一致：
   * 仅超管（ROLE_SUPER/R_SUPER）与门店管理员（ROLE_SHOP_ADMIN）
   */
  async assertCanManage(userId: string): Promise<void> {
    const ok = await this.hasAnyRole(userId, ['ROLE_SUPER', 'R_SUPER', 'ROLE_SHOP_ADMIN']);
    if (!ok) {
      throw new ForbiddenException('仅门店管理员及以上角色可执行此操作');
    }
  }

  /**
   * 断言用户可录单/编辑工单
   * 与前端 canEdit 约定一致：只读用户（ROLE_VIEWER）与财务（ROLE_FINANCE）不可编辑
   */
  async assertCanEdit(userId: string): Promise<void> {
    const forbidden = await this.hasAnyRole(userId, ['ROLE_VIEWER', 'ROLE_FINANCE']);
    if (forbidden) {
      throw new ForbiddenException('当前角色为只读，无法编辑工单');
    }
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
   * 在岗期日期统一截断到本地当天 00:00（日期精度，不含时分秒）
   */
  private startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * 设置用户绑定的门店（全量覆盖，语义为"当前在岗门店集合"）
   * - 移除的门店 → 离岗（保留行并设置 end_at，仍可只读查看任期内数据）
   * - 保留的门店 → 若曾离岗则视为重新上岗（清除 end_at）
   * - 新增的门店 → 在岗开始时间取 startAtMap（可回填历史日期），默认为今天
   */
  async bindShops(
    userId: string,
    shopIds: string[],
    startAtMap?: Record<string, string | Date>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.sysUserShop.findMany({
        where: { userId },
        select: { shopId: true, endAt: true },
      });
      const existingIds = existing.map((r: any) => r.shopId as string);
      const existingEndAt = new Map(existing.map((r: any) => [r.shopId as string, r.endAt as Date | null]));
      const targetIds = [...new Set(shopIds)];
      const now = this.startOfDay(new Date());

      // 1. 移除的门店 → 离岗留痕
      const removedIds = existingIds.filter((id: string) => !targetIds.includes(id));
      if (removedIds.length > 0) {
        await tx.sysUserShop.updateMany({
          where: { userId, shopId: { in: removedIds } },
          data: { endAt: now },
        });
      }

      // 2. 保留的门店 → 曾离岗的重新上岗：新一轮在岗期从重新上岗时间（或指定时间）起算，
      //    不能沿用旧 startAt，否则离岗期间的工单会被误纳入任期
      const rehiredIds = existingIds.filter(
        (id: string) => targetIds.includes(id) && existingEndAt.get(id) != null,
      );
      for (const shopId of rehiredIds) {
        const custom = startAtMap?.[shopId];
        const startAt = custom ? this.startOfDay(new Date(custom)) : now;
        await tx.sysUserShop.update({
          where: { userId_shopId: { userId, shopId } },
          data: { endAt: null, startAt },
        });
      }

      // 3. 新增的门店 → 建立在岗记录（开始时间可指定）
      const addedIds = targetIds.filter((id) => !existingIds.includes(id));
      if (addedIds.length === 0) return;
      await tx.sysUserShop.createMany({
        data: addedIds.map((shopId: string) => {
          const custom = startAtMap?.[shopId];
          const startAt = custom ? this.startOfDay(new Date(custom)) : now;
          return { userId, shopId, startAt };
        }),
      });
    });

    // 用户可见门店范围变了，其统计缓存的口径也随之变化，需要全量失效
    PaintStatsCache.invalidate().catch(() => undefined);
  }

  /**
   * 调整指定门店绑定的在岗期（超管用：回填历史开始时间 / 修正离岗时间）
   */
  async updateTenure(
    userId: string,
    shopId: string,
    startAt: Date,
    endAt: Date | null,
  ): Promise<void> {
    // 在岗期仅日期精度，统一截断到当天 00:00
    const normalizedStart = this.startOfDay(new Date(startAt));
    const normalizedEnd = endAt ? this.startOfDay(new Date(endAt)) : null;
    const row = await this.prisma.sysUserShop.findUnique({
      where: { userId_shopId: { userId, shopId } },
    });
    if (!row) throw new BadRequestException('该用户未绑定该门店');
    if (normalizedEnd && normalizedEnd < normalizedStart) {
      throw new BadRequestException('离岗时间不能早于在岗开始时间');
    }
    await this.prisma.sysUserShop.update({
      where: { userId_shopId: { userId, shopId } },
      data: { startAt: normalizedStart, endAt: normalizedEnd },
    });
    PaintStatsCache.invalidate().catch(() => undefined);
  }

  /**
   * 获取用户绑定的门店列表（含门店详细信息与在岗期）
   */
  async getBoundShops(userId: string) {
    const rows = await this.prisma.sysUserShop.findMany({
      where: { userId },
      select: {
        startAt: true,
        endAt: true,
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
    return rows.map((r: any) => ({
      ...r.shop,
      startAt: r.startAt,
      endAt: r.endAt,
    }));
  }

  /**
   * 校验用户是否有权访问指定门店（门店级，读/配置类操作）
   * 无权则抛出 ForbiddenException；超管/财务自动通过
   */
  async assertShopAccess(userId: string, shopId: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const boundIds = await this.getBoundShopIds(userId);
    if (!boundIds.includes(shopId)) {
      throw new ForbiddenException('无权访问该门店数据');
    }
  }

  /**
   * 校验用户在指定门店是否在岗（录单/导入/改配置等写操作要求在岗中）
   * 超管/财务自动通过
   */
  async assertShopOnDuty(userId: string, shopId: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const rows = await this.getBoundShopRows(userId);
    const onDuty = rows.some((r) => r.shopId === shopId && !r.endAt);
    if (!onDuty) {
      throw new ForbiddenException('您已离岗或未绑定该门店，无法执行此操作');
    }
  }

  /**
   * 校验用户是否有权操作指定工单（按工单所属门店 + 归属月份是否在任期内判断）
   * 归属月份：结算月份优先，未结算按录入时间年月
   * 超管/财务自动通过
   */
  async assertWorkOrderAccess(userId: string, orderId: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const order = await this.prisma.paintWorkOrder.findUnique({
      where: { id: orderId },
      select: { shopId: true, settlementMonth: true, createdAt: true },
    });
    if (!order) return; // 工单不存在时交给业务层抛 NotFoundException
    const tenures = (await this.getBoundShopRows(userId)).filter(
      (r) => r.shopId === order.shopId,
    );
    if (tenures.length === 0) {
      throw new ForbiddenException('无权访问该门店数据');
    }
    const covered = tenures.some((t) => tenureCoversOrder(t, order));
    if (!covered) {
      throw new ForbiddenException('该工单不在您的在岗期间内，无权操作');
    }
  }

  /**
   * 批量校验用户是否有权操作多个工单（一次性查询，避免 N+1）
   * 超管/财务自动通过
   */
  async assertWorkOrdersAccess(userId: string, orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) return;
    if (await this.isBypassUser(userId)) return;
    // 一次性查询所有工单的门店与归属月份
    const orders = await this.prisma.paintWorkOrder.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, shopId: true, settlementMonth: true, createdAt: true },
    });
    if (orders.length === 0) return; // 工单不存在时交给业务层抛 NotFoundException
    const tenures = await this.getBoundShopRows(userId);
    const forbidden = orders.filter((o: any) => {
      const list = tenures.filter((t) => t.shopId === o.shopId);
      if (list.length === 0) return true;
      return !list.some((t) => tenureCoversOrder(t, o));
    });
    if (forbidden.length > 0) {
      throw new ForbiddenException('存在无权操作的工单（门店未绑定或不在您的在岗期间内）');
    }
  }

  /**
   * 校验用户的任一期是否覆盖指定结算月（yyyy-MM，用于导出/对账等整月操作）
   * 超管/财务自动通过
   */
  async assertShopMonthAccess(userId: string, shopId: string, month: string): Promise<void> {
    if (await this.isBypassUser(userId)) return;
    const tenures = (await this.getBoundShopRows(userId)).filter(
      (r) => r.shopId === shopId,
    );
    if (tenures.length === 0) {
      throw new ForbiddenException('无权访问该门店数据');
    }
    const covered = tenures.some((t) => tenureCoversMonth(t, month));
    if (!covered) {
      throw new ForbiddenException('该结算月份不在您的在岗期间内，无权操作');
    }
  }
}
