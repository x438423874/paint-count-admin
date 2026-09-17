import { Redis, Cluster } from 'ioredis';

import { RedisConfig } from '@lib/config/redis.config';

export class RedisUtility {
  static get instance(): Redis | Cluster {
    return this._instance;
  }
  private static _instance: Redis | Cluster;
  private static initializing: Promise<Redis | Cluster> | null = null;

  private static async createInstance(): Promise<Redis | Cluster> {
    const [config] = await Promise.all([RedisConfig()]);
    if (config.mode === 'cluster') {
      this._instance = new Redis.Cluster(
        config.cluster.map((node) => ({
          host: node.host,
          port: node.port,
          password: node.password,
        })),
        {
          redisOptions: {
            password: config.cluster[0].password,
            db: config.standalone.db,
          },
        },
      );
    } else {
      this._instance = new Redis({
        host: config.standalone.host,
        port: config.standalone.port,
        password: config.standalone.password,
        db: config.standalone.db,
      });
    }
    // ioredis 的 error 事件若无监听器会直接把进程打崩（Redis 瞬断 = 全站宕机）。
    // 各业务已有降级/兜底逻辑，这里只记录日志保持进程存活。
    this._instance.on('error', (err) => {
      console.error('[Redis] 连接错误:', err.message);
    });
    return this._instance;
  }

  public static async client(): Promise<Redis | Cluster> {
    if (!this._instance) {
      if (!this.initializing) {
        this.initializing = this.createInstance();
      }
      this._instance = await this.initializing;
      this.initializing = null;
    }
    return this._instance;
  }
}
