import * as casbin from 'casbin';
import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';

import { BootstrapModule } from '@lib/bootstrap/bootstrap.module';
import config, {
  ConfigKeyPaths,
  IThrottlerConfig,
  throttlerConfigToken,
} from '@lib/config';
import { ISecurityConfig, securityRegToken } from '@lib/config/security.config';
import { GlobalCqrsModule } from '@lib/global/global.module';
import { SharedModule } from '@lib/global/shared.module';
import { AuthZModule, AUTHZ_ENFORCER, PrismaAdapter } from '@lib/infra/casbin';
import { AllExceptionsFilter } from '@lib/infra/filters/all-exceptions.filter';
import { ApiKeyModule } from '@lib/infra/guard/api-key/api-key.module';
import { JwtAuthGuard } from '@lib/infra/guard/jwt.auth.guard';
import { JwtStrategy } from '@lib/infra/strategies/jwt.passport-strategy';
import { LoggerModule } from '@lib/logger';
import { IAuthentication } from '@lib/typings/global';
import { getConfigPath } from '@lib/utils/env';

import { ApiModule } from './api/api.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const strategies = [JwtStrategy];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          console: true,
          file: true,
          filename: 'logs/base-system-%DATE%.log',
          level:
            configService.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          maxSize: '50m',
          maxFiles: '14d',
        };
      },
    }),
    TerminusModule,
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: ['.env.local', `.env.${process.env.NODE_ENV}`, '.env'],
      load: [...Object.values(config)],
    }),
    AuthZModule.register({
      imports: [ConfigModule],
      enforcerProvider: {
        provide: AUTHZ_ENFORCER,
        useFactory: async (configService: ConfigService) => {
          const adapter = await PrismaAdapter.newAdapter();
          const { casbinModel } = configService.get<ISecurityConfig>(
            securityRegToken,
            {
              infer: true,
            },
          );
          const casbinModelPath = getConfigPath(casbinModel);
          return casbin.newEnforcer(casbinModelPath, adapter);
        },
        inject: [ConfigService],
      },
      userFromContext: (ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const user: IAuthentication = request.user;
        return user;
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<ConfigKeyPaths>) => {
        const { ttl, limit, errorMessage } =
          configService.get<IThrottlerConfig>(throttlerConfigToken, {
            infer: true,
          });

        return {
          errorMessage: errorMessage,
          throttlers: [{ ttl, limit }],
        };
      },
    }),

    GlobalCqrsModule,

    ApiModule,

    SharedModule,

    ApiKeyModule,
    BootstrapModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    ...strategies,

    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
