import { createHash } from 'node:crypto';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { getCurrentSettlementMonth } from './paint-calculation';

/**
 * 统计查询缓存
 *
 * 统计接口是典型的读多写少场景：一个历史月份的数据在封单后基本不再变化。
 * 这里按「缓存键 + 月份版本号」实现：
 * - 读：读一次版本号 → 拼出当前生效的 key
 * - 写：工单变更时只需 `invalidate(months)` 递增版本号，
 *      旧 key 自然不可达，无需扫描整个缓存 key 空间（对 Redis Cluster 友好）
 *
 * Redis 不可用时全部降级为「不缓存」，不影响主流程正确性。
 */

const PREFIX = 'paint:stats:';
const VERSION_PREFIX = `${PREFIX}ver:`;
/** 记录所有已产生过缓存的月份版本 key，用于 invalidateAll */
const VERSION_INDEX = `${VERSION_PREFIX}__index__`;
const VERSION_TTL_SECONDS = 30 * 24 * 3600;

/** 当月数据变化频繁，缓存时间短 */
export const STATS_TTL_CURRENT_MONTH = 60;
/** 历史月份变化少（封单后基本不变），缓存时间可放长 */
export const STATS_TTL_HISTORY_MONTH = 10 * 60;

/** 统计缓存的类别（拼进 key，避免不同接口互相覆盖） */
export type StatsCacheKind = 'monthly' | 'category' | 'year';

/**
 * 根据月份决定缓存时长
 * @param month 结算月 yyyy-MM，或年度键 y{yyyy}；传 null/当月视为易变数据
 */
export function statsTtlForMonth(month?: string | null): number {
  if (!month) return STATS_TTL_CURRENT_MONTH;
  return month === getCurrentSettlementMonth() ? STATS_TTL_CURRENT_MONTH : STATS_TTL_HISTORY_MONTH;
}

/**
 * 把数据权限范围压成定长摘要
 * 门店 ID 列表直接进 key 会导致 key 过长，这里做 sha1 摘要
 */
export function hashScope(...parts: (string | string[] | null | undefined)[]): string {
  const normalized = parts
    .map(p => {
      if (Array.isArray(p)) return `arr(${[...p].sort().join(',')})`;
      if (p === null) return 'null';
      if (p === undefined) return 'undef';
      return String(p);
    })
    .join('|');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

export class PaintStatsCache {
  private static async client() {
    try {
      return await RedisUtility.client();
    } catch {
      return null; // Redis 未配置/不可用 → 降级为不缓存
    }
  }

  private static versionKey(month?: string | null): string {
    return `${VERSION_PREFIX}${month || 'all'}`;
  }

  /** 拼出当前生效的缓存 key（内含月份版本号） */
  static async buildKey(kind: StatsCacheKind, month: string | null | undefined, scopeHash: string): Promise<string> {
    const redis = await this.client();
    let version = 0;
    if (redis) {
      try {
        version = Number((await redis.get(this.versionKey(month))) ?? 0) || 0;
      } catch {
        version = 0;
      }
    }
    return `${PREFIX}${kind}:${month || 'all'}:${scopeHash}:v${version}`;
  }

  static async get<T>(key: string): Promise<T | null> {
    const redis = await this.client();
    if (!redis) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  static async set(key: string, value: unknown, ttl: number, month?: string | null): Promise<void> {
    const redis = await this.client();
    if (!redis) return;
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
      // 登记该月份已产生缓存，供 invalidateAll 精确定位
      await redis.sadd(VERSION_INDEX, this.versionKey(month));
    } catch {
      // 缓存写入失败不影响主流程
    }
  }

  /**
   * 使统计缓存失效
   * @param months 受影响的结算月（yyyy-MM）或年度键（y{yyyy}）；
   *               传空数组/不传表示全量失效（如批量导入、封解单等影响范围不确定的场景）
   */
  static async invalidate(months?: (string | null | undefined)[] | null): Promise<void> {
    const redis = await this.client();
    if (!redis) return;

    const targets = new Set<string>();
    if (!months || months.length === 0) {
      try {
        const known = await redis.smembers(VERSION_INDEX);
        known.forEach((k: string) => targets.add(k));
      } catch {
        // 索引读取失败时退化为仅失效全局版本
      }
      targets.add(this.versionKey(null));
    } else {
      for (const m of months) targets.add(this.versionKey(m));
    }

    for (const key of targets) {
      try {
        await redis.incr(key);
        await redis.expire(key, VERSION_TTL_SECONDS);
      } catch {
        // 单个 key 失效失败不阻塞其余 key
      }
    }
  }
}
