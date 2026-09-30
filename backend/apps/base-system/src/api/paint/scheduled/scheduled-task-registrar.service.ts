import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ScheduledTaskManager, ScheduledTaskDefinition } from './scheduled-task-manager.service';
import { PaintImageService } from '../service/paint-image.service';
import { PaintVehicleService } from '../service/paint-vehicle.service';
import { PrismaService } from '@lib/shared/prisma/prisma.service';

/** 日志保留天数，可通过环境变量 LOG_RETENTION_DAYS 覆盖 */
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 90;

/**
 * 定时任务注册中心
 * 所有定时任务在此统一注册，方便管理和控制
 *
 * 新增任务步骤：
 * 1. 在 TASK_DEFINITIONS 中添加任务定义
 * 2. 在 registerTasks 中实现 handler 逻辑
 * 3. 完成
 */
@Injectable()
export class ScheduledTaskRegistrar implements OnModuleInit {
  private readonly logger = new Logger(ScheduledTaskRegistrar.name);

  /** 所有定时任务定义，在此统一配置 */
  private readonly TASK_DEFINITIONS: Omit<ScheduledTaskDefinition, 'handler'>[] = [
    {
      name: 'cleanOrphanedImages',
      cron: '0 3 * * *',
      description: '清理冗余图片文件（每天凌晨3点）',
      enabled: true,
    },
    {
      name: 'reconcileVehicleStats',
      cron: '0 4 * * *',
      description: '车辆统计对账：以工单为事实来源重算车辆工单数/幅数，并归一化历史车牌（每天凌晨4点）',
      enabled: true,
    },
    {
      name: 'cleanExpiredLogs',
      cron: '0 2 * * *',
      description: `清理过期日志：删除 ${LOG_RETENTION_DAYS} 天前的操作日志与登录日志（每天凌晨2点）`,
      enabled: true,
    },
    // 新增任务在这里添加，例如：
    // {
    //   name: 'syncShopData',
    //   cron: '0 2 * * *',
    //   description: '同步门店数据（每天凌晨2点）',
    //   enabled: false,
    // },
  ];

  constructor(
    private readonly taskManager: ScheduledTaskManager,
    private readonly imageService: PaintImageService,
    private readonly vehicleService: PaintVehicleService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.registerTasks();
    this.logger.log(`已注册 ${this.TASK_DEFINITIONS.length} 个定时任务`);
  }

  private registerTasks() {
    for (const def of this.TASK_DEFINITIONS) {
      const handler = this.getHandler(def.name);
      if (!handler) {
        this.logger.error(`定时任务 "${def.name}" 未找到对应的 handler，跳过注册`);
        continue;
      }
      this.taskManager.register({
        ...def,
        handler,
      });
    }
  }

  /**
   * 根据任务名称获取执行函数
   * 新增任务时在此添加对应的 handler
   */
  private getHandler(name: string): (() => Promise<void>) | null {
    switch (name) {
      case 'cleanOrphanedImages':
        return async () => {
          const result = await this.imageService.cleanOrphanedFiles();
          if (result.deleted.length > 0) {
            this.logger.log(`清理完成：删除 ${result.deleted.length} 个冗余文件`);
          } else {
            this.logger.log('清理完成：无冗余文件');
          }
          if (result.errors.length > 0) {
            this.logger.warn(`${result.errors.length} 个文件删除失败`);
            result.errors.forEach(e => this.logger.warn(`  ${e}`));
          }
        };

      case 'reconcileVehicleStats':
        return async () => {
          const result = await this.vehicleService.reconcileStats();
          this.logger.log(
            `车辆统计对账完成：检查 ${result.checked} 台，修复 ${result.fixed} 台，归一化车牌 ${result.fixedPlates} 条`,
          );
        };

      case 'cleanExpiredLogs':
        return async () => {
          const cutoff = new Date(
            Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          );
          const [opResult, loginResult] = await Promise.all([
            this.prisma.sysOperationLog.deleteMany({
              where: { createdAt: { lt: cutoff } },
            }),
            this.prisma.sysLoginLog.deleteMany({
              where: { loginTime: { lt: cutoff } },
            }),
          ]);
          this.logger.log(
            `过期日志清理完成：操作日志 ${opResult.count} 条，登录日志 ${loginResult.count} 条（阈值 ${LOG_RETENTION_DAYS} 天）`,
          );
        };

      // 新增任务的 handler 在这里添加
      // case 'syncShopData':
      //   return async () => { ... };

      default:
        return null;
    }
  }
}
