import { createKeyv } from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { ConfigKeyPaths, IRedisConfig, redisRegToken } from '@lib/config';

@Module({
  imports: [
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService<ConfigKeyPaths>) => {
        const redisConfig: IRedisConfig = configService.get<IRedisConfig>(
          redisRegToken,
          { infer: true },
        );

        let redisUrl = '';
        if (redisConfig.mode === 'cluster') {
          const nodes = redisConfig.cluster
            .map((node) => `${node.host}:${node.port}`)
            .join(',');
          const password = encodeURIComponent(redisConfig.cluster[0].password);
          redisUrl = `redis://:%${password}@${nodes}`;
        } else {
          const { host, port, password, db } = redisConfig.standalone;
          const encodedPassword = encodeURIComponent(password);
          redisUrl = `redis://:${encodedPassword}@${host}:${port}/${db}`;
        }

        const keyvCacheStore = createKeyv(redisUrl);

        return {
          stores: [keyvCacheStore],
          ttl: 24 * 60 * 60 * 1000,
        };
      },
    }),
  ],
  exports: [CacheModule],
})
export class CacheManagerModule {}
