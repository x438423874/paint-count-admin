import { request } from '../../request';
import type { ScheduledTask } from './types';

// ==================== 定时任务管理 ====================

export function fetchScheduledTasks() {
  return request<ScheduledTask[]>({
    url: '/scheduled-tasks',
    method: 'get'
  });
}

export function toggleScheduledTask(name: string, action: 'start' | 'stop') {
  return request({
    url: `/scheduled-tasks/${name}/${action}`,
    method: 'post'
  });
}
