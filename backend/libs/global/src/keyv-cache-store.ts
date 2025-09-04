// import { CacheStore } from '@nestjs/cache-manager';
// import { Injectable } from '@nestjs/common';
// import Redis, { Cluster } from 'ioredis';

// import { IRedisConfig } from '@lib/config/redis.config';

// @Injectable()
// export class KeyvCacheStore implements CacheStore {
//   private readonly redis: Redis | Cluster;

//   constructor(redisConfig: IRedisConfig) {
//     if (redisConfig.mode === 'cluster') {
//       this.redis = new Redis.Cluster(
//         redisConfig.cluster.map((node) => ({
//           host: node.host,
//           port: node.port,
//           password: node.password,
//         })),
//         {
//           redisOptions: {
//             password: redisConfig.cluster[0].password,
//           },
//         },
//       );
//     } else {
//       this.redis = new Redis({
//         host: redisConfig.standalone.host,
//         port: redisConfig.standalone.port,
//         password: redisConfig.standalone.password,
//         db: redisConfig.standalone.db,
//       });
//     }
//   }

//   async get<T>(key: string): Promise<T | undefined> {
//     const value = await this.redis.get(key);
//     if (!value) return undefined;
//     return JSON.parse(value) as T;
//   }

//   async set<T>(key: string, value: T, ttl?: number): Promise<void> {
//     if (ttl) {
//       await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
//     } else {
//       await this.redis.set(key, JSON.stringify(value));
//     }
//   }

//   async del(key: string): Promise<void> {
//     await this.redis.del(key);
//   }

//   async reset(): Promise<void> {
//     await this.redis.flushdb();
//   }
// }
