import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { BootstrapModule } from '@lib/bootstrap/bootstrap.module';
import config, {
  ConfigKeyPaths,
  IThrottlerConfig,
  throttlerConfigToken,
} from '@lib/config';
import { GlobalCqrsModule } from '@lib/global/global.module';
import { SharedModule } from '@lib/global/shared.module';
import { AuthZModule } from '@lib/infra/casbin';
import { PrismaModule } from '@lib/shared/prisma/prisma.module';
import { AllExceptionsFilter } from '@lib/infra/filters/all-exceptions.filter';
import { ApiKeyModule } from '@lib/infra/guard/api-key/api-key.module';
import { JwtAuthGuard } from '@lib/infra/guard/jwt.auth.guard';
import { LogInterceptor } from '@lib/infra/interceptors/log.interceptor';
import { JwtStrategy } from '@lib/infra/strategies/jwt.passport-strategy';
import { LoggerModule } from '@lib/logger';
import { IAuthentication } from '@lib/typings/global';

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
      // 守卫直查 sys_menu.permission（芋道式菜单权限串），需注入 Prisma
      imports: [ConfigModule, PrismaModule],
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

    // 限流守卫先于JWT执行，可在认证前拦截恶意请求
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // 全局操作日志：写操作自动记录，@Log 自定义模块名，@SkipLog 排除
    { provide: APP_INTERCEPTOR, useClass: LogInterceptor },
  ],
})
export class AppModule {}

