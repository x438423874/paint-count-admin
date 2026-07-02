<script setup lang="tsx">
import { ref } from 'vue';
import { NAvatar, NButton, NPopconfirm, NTag } from 'naive-ui';
import { enableStatusRecord } from '@/constants/business';
import { deleteUser, fetchGetUserList } from '@/service/api';
import { useAppStore } from '@/store/modules/app';
import { useTable, useTableOperate } from '@/hooks/common/table';
import { $t } from '@/locales';
import { isSuperAdmin as checkIsSuperAdmin } from '@/utils/permission';
import UserOperateDrawer from './modules/user-operate-drawer.vue';
import UserSearch from './modules/user-search.vue';
import UserShopBindDrawer from './modules/user-shop-bind-drawer.vue';

const appStore = useAppStore();

// 是否为超级管理员（用于显示"绑定门店"按钮）
const isSuperAdmin = ref(checkIsSuperAdmin());

// 用户-门店绑定抽屉
const bindDrawerVisible = ref(false);
const bindUserId = ref<string | null>(null);

function handleBindShop(userId: string) {
  bindUserId.value = userId;
  bindDrawerVisible.value = true;
}

const {
  columns,
  columnChecks,
  data,
  getData,
  getDataByPage,
  loading,
  mobilePagination,
  searchParams,
  resetSearchParams
} = useTable({
  apiFn: fetchGetUserList,
  showTotal: true,
  apiParams: {
    current: 1,
    size: 10,
    // if you want to use the searchParams in Form, you need to define the following properties, and the value is null
    // the value can not be undefined, otherwise the property in Form will not be reactive
    status: null,
    username: null,
    nickName: null,
    phoneNumber: null,
    email: null
  },
  columns: () => [
    {
      type: 'selection',
      align: 'center',
      width: 48
    },
    {
      key: 'index',
      title: $t('common.index'),
      align: 'center',
      width: 64
    },
    {
      key: 'username',
      title: $t('page.manage.user.userName'),
      align: 'center',
      minWidth: 100
    },
    {
      key: 'domain',
      title: 'domain',
      align: 'center',
      minWidth: 100
    },
    {
      key: 'avatar',
      title: 'avatar',
      align: 'center',
      minWidth: 80,
      render: row => {
        return <NAvatar size="small" src={row.avatar} />;
      }
    },
    {
      key: 'nickName',
      title: $t('page.manage.user.nickName'),
      align: 'center',
      minWidth: 100
    },
    {
      key: 'phoneNumber',
      title: $t('page.manage.user.userPhone'),
      align: 'center',
      width: 120
    },
    {
      key: 'email',
      title: $t('page.manage.user.userEmail'),
      align: 'center',
      minWidth: 200
    },
    {
      key: 'status',
      title: $t('page.manage.user.userStatus'),
      align: 'center',
      width: 100,
      render: row => {
        if (row.status === null) {
          return null;
        }

        const tagMap: Record<Api.Common.EnableStatus, NaiveUI.ThemeColor> = {
          ENABLED: 'success',
          DISABLED: 'warning'
        };

        const label = $t(enableStatusRecord[row.status]);

        return <NTag type={tagMap[row.status]}>{label}</NTag>;
      }
    },
    {
      key: 'operate',
      title: $t('common.operate'),
      align: 'center',
      width: isSuperAdmin.value ? 240 : 130,
      render: row => (
        <div class="flex-center gap-8px">
          <NButton type="primary" ghost size="small" onClick={() => edit(row.id)}>
            {$t('common.edit')}
          </NButton>
          {isSuperAdmin.value && (
            <NButton type="info" ghost size="small" onClick={() => handleBindShop(row.id)}>
              绑定门店
            </NButton>
          )}
          <NPopconfirm onPositiveClick={() => handleDelete(row.id)}>
            {{
              default: () => $t('common.confirmDelete'),
              trigger: () => (
                <NButton type="error" ghost size="small">
                  {$t('common.delete')}
                </NButton>
              )
            }}
          </NPopconfirm>
        </div>
      )
    }
  ]
});

const {
  drawerVisible,
  operateType,
  editingData,
  handleAdd,
  handleEdit,
  checkedRowKeys,
  onBatchDeleted,
  onDeleted
  // closeDrawer
} = useTableOperate(data, getData);

async function handleBatchDelete() {
  // request
  console.log(checkedRowKeys.value);

  onBatchDeleted();
}

async function handleDelete(id: string) {
  // request
  const { error } = await deleteUser(id);
  if (error) return;
  await onDeleted();
}

function edit(id: string) {
  handleEdit(id);
}
</script>

<template>
  <div class="min-h-500px flex-col-stretch gap-16px overflow-hidden lt-sm:overflow-auto">
    <UserSearch v-model:model="searchParams" @reset="resetSearchParams" @search="getDataByPage" />
    <NCard :title="$t('page.manage.user.title')" :bordered="false" size="small" class="sm:flex-1-hidden card-wrapper">
      <template #header-extra>
        <TableHeaderOperation
          v-model:columns="columnChecks"
          :disabled-delete="checkedRowKeys.length === 0"
          :loading="loading"
          @add="handleAdd"
          @delete="handleBatchDelete"
          @refresh="getData"
        />
      </template>
      <NDataTable
        v-model:checked-row-keys="checkedRowKeys"
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
      />
      <UserOperateDrawer
        v-model:visible="drawerVisible"
        :operate-type="operateType"
        :row-data="editingData"
        @submitted="getDataByPage"
      />
      <UserShopBindDrawer v-model:visible="bindDrawerVisible" :user-id="bindUserId" />
    </NCard>
  </div>
</template>

<style scoped></style>
