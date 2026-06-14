import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

export interface ScheduledTaskDefinition {
  /** 任务唯一标识 */
  name: string;
  /** cron 表达式 */
  cron: string;
  /** 任务描述 */
  description: string;
  /** 是否默认启用 */
  enabled: boolean;
  /** 任务执行函数 */
  handler: () => Promise<void>;
}

export interface ScheduledTaskInfo {
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: Date | null;
  lastError: string | null;
}

@Injectable()
export class ScheduledTaskManager {
  private readonly logger = new Logger(ScheduledTaskManager.name);
  private readonly tasks = new Map<string, {
    definition: ScheduledTaskDefinition;
    running: boolean;
    lastRunAt: Date | null;
    lastError: string | null;
  }>();

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  /**
   * 注册一个定时任务
   */
  register(definition: ScheduledTaskDefinition) {
    if (this.tasks.has(definition.name)) {
      this.logger.warn(`定时任务 "${definition.name}" 已注册，跳过重复注册`);
      return;
    }

    const entry = {
      definition,
      running: false,
      lastRunAt: null as Date | null,
      lastError: null as string | null,
    };

    this.tasks.set(definition.name, entry);

    if (definition.enabled) {
      this.addCronJob(definition);
    } else {
      this.logger.log(`定时任务 "${definition.name}" 已注册但未启用`);
    }
  }

  /**
   * 启动指定任务
   */
  start(name: string) {
    const entry = this.tasks.get(name);
    if (!entry) {
      throw new Error(`定时任务 "${name}" 不存在`);
    }
    this.addCronJob(entry.definition);
  }

  /**
   * 停止指定任务
   */
  stop(name: string) {
    const entry = this.tasks.get(name);
    if (!entry) {
      throw new Error(`定时任务 "${name}" 不存在`);
    }
    this.deleteCronJob(name);
  }

  /**
   * 获取所有任务信息
   */
  getAll(): ScheduledTaskInfo[] {
    const result: ScheduledTaskInfo[] = [];
    for (const [name, entry] of this.tasks) {
      const isActive = this.isCronJobActive(name);
      result.push({
        name,
        description: entry.definition.description,
        cron: entry.definition.cron,
        enabled: isActive,
        running: entry.running,
        lastRunAt: entry.lastRunAt,
        lastError: entry.lastError,
      });
    }
    return result;
  }

  /**
   * 获取单个任务信息
   */
  get(name: string): ScheduledTaskInfo | undefined {
    const entry = this.tasks.get(name);
    if (!entry) return undefined;
    return {
      name,
      description: entry.definition.description,
      cron: entry.definition.cron,
      enabled: this.isCronJobActive(name),
      running: entry.running,
      lastRunAt: entry.lastRunAt,
      lastError: entry.lastError,
    };
  }

  private addCronJob(definition: ScheduledTaskDefinition) {
    const entry = this.tasks.get(definition.name)!;

    // 如果已存在先删除
    try {
      this.schedulerRegistry.deleteCronJob(definition.name);
    } catch {
      // 不存在则忽略
    }

    // 使用动态 import 避免直接依赖 cron 包
    // @nestjs/schedule 内部已依赖 cron，运行时可用
    const { CronJob } = require('cron');

    const job = new CronJob(definition.cron, async () => {
      if (entry.running) {
        this.logger.warn(`定时任务 "${definition.name}" 上次执行尚未完成，跳过本次`);
        return;
      }
      entry.running = true;
      entry.lastRunAt = new Date();
      this.logger.log(`定时任务 "${definition.name}" 开始执行`);
      try {
        await definition.handler();
        entry.lastError = null;
        this.logger.log(`定时任务 "${definition.name}" 执行完成`);
      } catch (error: any) {
        entry.lastError = error.message || String(error);
        this.logger.error(`定时任务 "${definition.name}" 执行失败: ${entry.lastError}`);
      } finally {
        entry.running = false;
      }
    });

    this.schedulerRegistry.addCronJob(definition.name, job);
    job.start();
    this.logger.log(`定时任务 "${definition.name}" 已启动 [${definition.cron}]`);
  }

  private deleteCronJob(name: string) {
    try {
      const job = this.schedulerRegistry.getCronJob(name);
      job.stop();
      this.schedulerRegistry.deleteCronJob(name);
      this.logger.log(`定时任务 "${name}" 已停止`);
    } catch {
      this.logger.warn(`定时任务 "${name}" 未在运行中`);
    }
  }

  private isCronJobActive(name: string): boolean {
    try {
      this.schedulerRegistry.getCronJob(name);
      return true;
    } catch {
      return false;
    }
  }
}
