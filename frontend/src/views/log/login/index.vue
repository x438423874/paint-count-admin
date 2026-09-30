<script setup lang="tsx">
import dayjs from 'dayjs';
import { fetchGetLoginLogList } from '@/service/api';
import { useAppStore } from '@/store/modules/app';
import { useTable } from '@/hooks/common/table';
import { $t } from '@/locales';
import EmptyState from '@/components/common/EmptyState.vue';
import LoginLogSearch from './modules/login-log-search.vue';

const appStore = useAppStore();

const { columns, data, getData, getDataByPage, loading, mobilePagination, searchParams, resetSearchParams } = useTable({
  apiFn: fetchGetLoginLogList,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 20,
    // if you want to use the searchParams in Form, you need to define the following properties, and the value is null
    // the value can not be undefined, otherwise the property in Form will not be reactive
    username: null,
    domain: null,
    address: null,
    type: null
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
      title: '用户名',
      align: 'center',
      minWidth: 100
    },
    {
      key: 'domain',
      title: '域',
      align: 'center',
      width: 80
    },
    {
      key: 'loginTime',
      title: '登录时间',
      align: 'center',
      minWidth: 140,
      render(row) {
        return dayjs(row.loginTime).format('YYYY-MM-DD HH:mm:ss');
      }
    },
    {
      key: 'ip',
      title: 'IP',
      align: 'center',
      width: 110
    },
    {
      key: 'port',
      title: '端口',
      align: 'center',
      width: 80
    },
    {
      key: 'address',
      title: '登录地点',
      align: 'center',
      minWidth: 100
    },
    {
      key: 'userAgent',
      title: '浏览器标识',
      align: 'center',
      minWidth: 150,
      ellipsis: {
        tooltip: true
      }
    },
    {
      key: 'type',
      title: '登录方式',
      align: 'center',
      width: 80
    }
  ]
});
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <LoginLogSearch v-model:model="searchParams" @reset="resetSearchParams" @search="getDataByPage" />
    <NCard title="登录日志" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <TableHeaderOperation :loading="loading" @refresh="getData" />
      </template>
      <NDataTable
        striped
        :columns="columns"
        :data="data"
        size="small"
        :flex-height="!appStore.isMobile"
        :scroll-x="962"
        :loading="loading"
        remote
        :row-key="row => row.id"
        :pagination="mobilePagination"
        class="sm:h-full"
      >
        <template #empty>
          <EmptyState description="暂无登录日志" />
        </template>
      </NDataTable>
    </NCard>
  </div>
</template>

<style scoped></style>
