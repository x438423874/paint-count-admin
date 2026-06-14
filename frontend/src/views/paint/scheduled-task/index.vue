<script setup lang="tsx">
import { NButton, NTag, NSpace } from 'naive-ui';
import { ref, onMounted } from 'vue';
import { fetchScheduledTasks, toggleScheduledTask } from '@/service/api';

interface TaskInfo {
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
}

const tasks = ref<TaskInfo[]>([]);
const loading = ref(false);

async function loadTasks() {
  loading.value = true;
  try {
    const { data, error } = await fetchScheduledTasks();
    if (!error && data) {
      tasks.value = data;
    }
  } finally {
    loading.value = false;
  }
}

async function handleToggle(task: TaskInfo) {
  const action = task.enabled ? 'stop' : 'start';
  const { error } = await toggleScheduledTask(task.name, action);
  if (error) return;
  window.$message?.success(action === 'start' ? '任务已启动' : '任务已停止');
  await loadTasks();
}

function formatTime(time: string | null) {
  if (!time) return '-';
  return new Date(time).toLocaleString('zh-CN');
}

const columns = [
  {
    key: 'name',
    title: '任务标识',
    width: 180,
    ellipsis: { tooltip: true }
  },
  {
    key: 'description',
    title: '任务描述',
    minWidth: 200
  },
  {
    key: 'cron',
    title: 'Cron 表达式',
    width: 140,
    align: 'center' as const
  },
  {
    key: 'enabled',
    title: '状态',
    width: 100,
    align: 'center' as const,
    render: (row: TaskInfo) => (
      <NTag type={row.enabled ? 'success' : 'default'}>
        {row.enabled ? '运行中' : '已停止'}
      </NTag>
    )
  },
  {
    key: 'running',
    title: '执行中',
    width: 80,
    align: 'center' as const,
    render: (row: TaskInfo) => (
      <NTag type={row.running ? 'warning' : 'default'} size="small">
        {row.running ? '是' : '否'}
      </NTag>
    )
  },
  {
    key: 'lastRunAt',
    title: '上次执行时间',
    width: 180,
    render: (row: TaskInfo) => formatTime(row.lastRunAt)
  },
  {
    key: 'lastError',
    title: '最近错误',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row: TaskInfo) =>
      row.lastError ? (
        <NTag type="error" size="small">{row.lastError}</NTag>
      ) : (
        <span style="color: #999">-</span>
      )
  },
  {
    key: 'operate',
    title: '操作',
    width: 120,
    align: 'center' as const,
    render: (row: TaskInfo) => (
      <NButton
        type={row.enabled ? 'warning' : 'success'}
        ghost
        size="small"
        onClick={() => handleToggle(row)}
      >
        {row.enabled ? '停止' : '启动'}
      </NButton>
    )
  }
];

onMounted(() => {
  loadTasks();
});
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <NCard title="定时任务管理" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <NSpace>
          <NButton size="small" @click="loadTasks" :loading="loading">
            刷新
          </NButton>
        </NSpace>
      </template>

      <NAlert type="info" class="mb-12px">
        统一管理系统中所有定时任务，支持动态启停。修改后立即生效，无需重启服务。
      </NAlert>

      <NDataTable
        :columns="columns"
        :data="tasks"
        size="small"
        :flex-height="true"
        :scroll-x="1100"
        :loading="loading"
        :row-key="(row: TaskInfo) => row.name"
        class="sm:h-full"
      />
    </NCard>
  </div>
</template>

<style scoped></style>
