import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

/**
 * Prometheus 指标拦截器
 *
 * 记录每个 HTTP 请求的指标：
 * - 请求计数（按 method/route/status）
 * - 请求耗时（直方图）
 *
 * 路由规范化：将 /paint/work-order/123 转换为 /paint/work-order/:id
 * 避免高基数标签导致 Prometheus 内存爆炸
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const start = process.hrtime();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = process.hrtime(start);
          const durationSeconds = duration[0] + duration[1] / 1e9;

          this.metricsService.recordHttpRequest(
            request.method,
            this.normalizeRoute(request.url),
            reply.statusCode,
            durationSeconds,
          );
        },
        error: (err: any) => {
          const duration = process.hrtime(start);
          const durationSeconds = duration[0] + duration[1] / 1e9;
          const status = err?.status || err?.statusCode || 500;

          this.metricsService.recordHttpRequest(
            request.method,
            this.normalizeRoute(request.url),
            status,
            durationSeconds,
          );
        },
      }),
    );
  }

  /**
   * 路由规范化：将路径中的 UUID/数字 ID 替换为 :id
   * 避免每个请求生成不同的标签值
   */
  private normalizeRoute(url: string): string {
    return url
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id') // UUID
      .replace(/\/\d+/g, '/:id') // 数字 ID
      .replace(/\?.*$/, '') // 移除查询参数
      .replace(/\/$/, '') || '/'; // 移除尾部斜杠
  }
}
