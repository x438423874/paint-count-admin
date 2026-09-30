import cluster from 'node:cluster';
import path from 'node:path';
import fs from 'node:fs';
// import { constants } from 'zlib';

import fastifyCompress from '@fastify/compress';
import fastifyCsrf from '@fastify/csrf-protection';
import {
  HttpStatus,
  Logger,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { useContainer } from 'class-validator';

import { initDocSwagger } from '@lib/bootstrap/swagger/init-doc.swagger';
import { ConfigKeyPaths, IAppConfig, ICorsConfig } from '@lib/config';
import { fastifyApp } from '@lib/infra/adapter/fastify.adapter';
import { registerHelmet } from '@lib/infra/adapter/security.adapter';
import { RedisUtility } from '@lib/shared/redis/redis.util';
import { isDevEnvironment, isMainProcess } from '@lib/utils/env';

import { AppModule } from './app.module';
import { UPLOAD_DIR } from './api/paint/service/upload-root';

interface ValidationErrors {
  [key: string]: string[] | ValidationErrors;
}

const validationPipeOptions: ValidationPipeOptions = {
  transform: true,
  whitelist: true,
  transformOptions: { enableImplicitConversion: true },
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: (errors: ValidationError[]) => {
    const formattedErrors = formatErrors(errors);
    return new UnprocessableEntityException({
      message: '参数校验失败',
      errors: formattedErrors,
    });
  },
};

/**
 * class-validator 约束消息转用户可读中文（按约束类型映射，未识别的保留原文）。
 * constraints 的 value 是英文默认消息，数字阈值从消息中提取。
 */
function translateConstraint(rule: string, rawMessage: string): string {
  const num = (): string => {
    const m = rawMessage.match(/(\d+(?:\.\d+)?)/)
    return m ? m[1] : '?'
  }
  const afterColon = (): string => {
    const idx = rawMessage.indexOf(':')
    return idx >= 0 ? rawMessage.slice(idx + 1).trim() : ''
  }
  switch (rule) {
    case 'isNotEmpty':
      return '不能为空'
    case 'isString':
      return '必须为字符串'
    case 'isNumber':
      return '必须为数字'
    case 'isInt':
      return '必须为整数'
    case 'isArray':
      return '必须为数组'
    case 'isBoolean':
      return '必须为布尔值'
    case 'isEnum':
    case 'isIn':
      return `必须是以下之一: ${afterColon()}`
    case 'isEmail':
      return '必须是合法的邮箱'
    case 'isDateString':
    case 'isISO8601':
      return '必须是合法的日期'
    case 'matches':
      return '格式不正确'
    case 'minLength':
      return `长度不能少于 ${num()} 个字符`
    case 'maxLength':
      return `长度不能超过 ${num()} 个字符`
    case 'min':
      return `不能小于 ${num()}`
    case 'max':
      return `不能大于 ${num()}`
    default:
      return rawMessage
  }
}

function formatErrors(
  errors: ValidationError[],
  parentPath: string = '',
): ValidationErrors {
  return errors.reduce((acc, error) => {
    const property = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      acc[property] = Object.entries(error.constraints).map(([rule, msg]) =>
        translateConstraint(rule, msg),
      );
    }

    if (error.children && error.children.length > 0) {
      const nestedErrors = formatErrors(error.children, property);
      // 合并嵌套错误
      acc[property] = { ...acc[property], ...nestedErrors };
    }

    return acc;
  }, {} as ValidationErrors);
}

async function bootstrap() {
  await RedisUtility.client();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyApp,
    { abortOnError: true },
  );

  const configService = app.get(ConfigService<ConfigKeyPaths>);
  const { port } = configService.get<IAppConfig>('app', { infer: true });
  const corsConfig = configService.get<ICorsConfig>('cors', { infer: true });

  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  if (corsConfig.enabled) {
    app.enableCors(corsConfig.corsOptions);
  }

  const GLOBAL_PREFIX = 'v1';
  // uploads 受控下载控制器排除全局前缀，保持与库中存储的 /uploads/... 路径一致
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: ['uploads/(.*)'] });

  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  initDocSwagger(app, configService);

  // @ts-ignore
  await app.register(fastifyCompress, { encodings: ['gzip', 'deflate'] });
  // await app.register(fastifyCompress, { brotliOptions: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } } });
  // TODO
  await app.register(fastifyCsrf as any);

  // 注册 Helmet 安全中间件
  // @description 提供基本的安全防护，包括 XSS、CSP、HSTS 等
  // @link https://github.com/helmetjs/helmet
  // @link https://github.com/fastify/fastify-helmet
  // 本地环境不开启,具体配置请参考官方文档
  await registerHelmet(fastifyApp.getInstance(), {
    contentSecurityPolicy: isDevEnvironment
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https:', 'wss:'],
          },
        },
  });

  // 静态文件服务已移除：/uploads 现由 UploadsController 受控提供
  // （登录 + 门店数据权限校验，见 api/paint/uploads/rest/uploads.controller.ts）
  const uploadsDir = UPLOAD_DIR;
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await app.listen(port, '0.0.0.0', async () => {
    const url = await app.getUrl();
    const { pid } = process;
    const env = cluster.isPrimary;
    const prefix = env ? 'P' : 'W';

    if (!isMainProcess) return;

    const logger = new Logger('NestApplication');
    logger.log(`[${prefix + pid}] Server running on ${url}`);
  });
}

bootstrap();
