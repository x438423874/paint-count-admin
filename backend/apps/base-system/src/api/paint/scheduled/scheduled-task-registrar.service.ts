import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ScheduledTaskManager, ScheduledTaskDefinition } from './scheduled-task-manager.service';
import { PaintImageService } from '../service/paint-image.service';

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

      // 新增任务的 handler 在这里添加
      // case 'syncShopData':
      //   return async () => { ... };

      default:
        return null;
    }
  }
}
