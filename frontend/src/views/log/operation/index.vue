<script setup lang="tsx">
import dayjs from 'dayjs';
import { fetchGetOperationLogList } from '@/service/api';
import { useAppStore } from '@/store/modules/app';
import { useTable } from '@/hooks/common/table';
import { $t } from '@/locales';
import EmptyState from '@/components/common/EmptyState.vue';
import OperationSearch from './modules/operation-log-search.vue';

const appStore = useAppStore();

const { columns, data, getData, getDataByPage, loading, mobilePagination, searchParams, resetSearchParams } = useTable({
  apiFn: fetchGetOperationLogList,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 20,
    // if you want to use the searchParams in Form, you need to define the following properties, and the value is null
    // the value can not be undefined, otherwise the property in Form will not be reactive
    username: null,
    domain: null,
    moduleName: null,
    method: null
  },
  columns: () => [
    {
      key: 'index',
      title: $t('common.index'),
      align: 'center',
      width: 64
    },
    {
      key: 'username',
      title: '操作人',
      align: 'center',
      width: 100
    },
    {
      key: 'moduleName',
      title: '模块',
      align: 'center',
      width: 110
    },
    {
      key: 'description',
      title: '操作',
      align: 'center',
      minWidth: 170,
      ellipsis: {
        tooltip: true
      }
    },
    {
      key: 'method',
      title: '方法',
      align: 'center',
      width: 80
    },
    {
      key: 'url',
      title: 'URL',
      align: 'center',
      minWidth: 160,
      ellipsis: {
        tooltip: true
      }
    },
    {
      key: 'ip',
      title: 'IP',
      align: 'center',
      width: 110
    },
    {
      key: 'params',
      title: '请求参数',
      align: 'center',
      minWidth: 150,
      ellipsis: {
        tooltip: true
      },
      render(row) {
        return row.params === null || row.params === undefined ? '-' : JSON.stringify(row.params);
      }
    },
    {
      key: 'body',
      title: '请求体',
      align: 'center',
      minWidth: 150,
      ellipsis: {
        tooltip: true
      },
      render(row) {
        return row.body === null || row.body === undefined ? '-' : JSON.stringify(row.body);
      }
    },
    {
      key: 'duration',
      title: '耗时(ms)',
      align: 'center',
      width: 90
    },
    {
      key: 'startTime',
      title: '操作时间',
      align: 'center',
      minWidth: 140,
      render(row) {
        return dayjs(row.startTime).format('YYYY-MM-DD HH:mm:ss');
      }
    }
  ]
});
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <OperationSearch v-model:model="searchParams" @reset="resetSearchParams" @search="getDataByPage" />
    <NCard title="操作日志" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <TableHeaderOperation :loading="loading" @refresh="getData" />
      </template>
      <NDataTable
        striped
        :columns="columns"
        :data="data"
        size="small"
        :flex-height="!appStore.isMobile"
        :scroll-x="1280"
        :loading="loading"
        remote
        :row-key="row => row.id"
        :pagination="mobilePagination"
        class="sm:h-full"
      >
        <template #empty>
          <EmptyState description="暂无操作日志" />
        </template>
      </NDataTable>
    </NCard>
  </div>
</template>

<style scoped></style>
