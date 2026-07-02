import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

/**
 * Prometheus 指标服务
 *
 * 提供应用级别的自定义指标：
 * - http_requests_total: HTTP 请求总数（按 method/route/status 分维度）
 * - http_request_duration_seconds: HTTP 请求耗时直方图
 * - paint_work_orders_total: 喷漆工单创建总数
 * - paint_ocr_recognition_total: OCR 识别调用总数
 * - active_db_connections: 活跃数据库连接数
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;
  private defaultMetrics?: ReturnType<typeof collectDefaultMetrics>;

  // HTTP 指标
  readonly httpRequestTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;

  // 业务指标
  readonly paintWorkOrdersTotal: Counter<string>;
  readonly paintOcrRecognitionTotal: Counter<string>;
  readonly paintExcelImportsTotal: Counter<string>;

  // 系统指标
  readonly activeDbConnections: Gauge<string>;

  constructor() {
    this.registry = new Registry();

    // HTTP 请求计数器
    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    // HTTP 请求耗时直方图（单位：秒）
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'] as const,
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    // 喷漆工单创建计数器
    this.paintWorkOrdersTotal = new Counter({
      name: 'paint_work_orders_total',
      help: 'Total number of paint work orders created',
      labelNames: ['shop_id', 'source'] as const, // source: manual/ocr/excel_import
      registers: [this.registry],
    });

    // OCR 识别调用计数器
    this.paintOcrRecognitionTotal = new Counter({
      name: 'paint_ocr_recognition_total',
      help: 'Total number of OCR recognition calls',
      labelNames: ['shop_id', 'status'] as const, // status: success/failure
      registers: [this.registry],
    });

    // Excel 导入计数器
    this.paintExcelImportsTotal = new Counter({
      name: 'paint_excel_imports_total',
      help: 'Total number of Excel imports',
      labelNames: ['shop_id', 'status'] as const,
      registers: [this.registry],
    });

    // 活跃数据库连接数
    this.activeDbConnections = new Gauge({
      name: 'active_db_connections',
      help: 'Number of active database connections',
      registers: [this.registry],
    });
  }

  onModuleInit() {
    // 收集 Node.js 默认指标（内存、CPU、事件循环等）
    this.defaultMetrics = collectDefaultMetrics({
      register: this.registry,
      prefix: 'node_',
    });
  }

  /** 获取 Prometheus 格式的指标数据 */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** 获取 Content-Type */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * 记录 HTTP 请求指标
   * 在 LoggerInterceptor 或专门的 MetricsInterceptor 中调用
   */
  recordHttpRequest(method: string, route: string, status: number, durationSeconds: number) {
    const labels = { method, route, status: String(status) };
    this.httpRequestTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  /** 记录工单创建 */
  recordWorkOrderCreation(shopId: string, source: 'manual' | 'ocr' | 'excel_import') {
    this.paintWorkOrdersTotal.inc({ shop_id: shopId, source });
  }

  /** 记录 OCR 识别 */
  recordOcrRecognition(shopId: string, success: boolean) {
    this.paintOcrRecognitionTotal.inc({
      shop_id: shopId,
      status: success ? 'success' : 'failure',
    });
  }

  /** 记录 Excel 导入 */
  recordExcelImport(shopId: string, success: boolean) {
    this.paintExcelImportsTotal.inc({
      shop_id: shopId,
      status: success ? 'success' : 'failure',
    });
  }

  /** 更新数据库连接数 */
  setActiveDbConnections(count: number) {
    this.activeDbConnections.set(count);
  }
}
