<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { TreeOption } from 'naive-ui';
import {
  fetchAssignPermission,
  fetchAssignRoutes,
  fetchGetApiEndpointTree,
  fetchGetMenuTree,
  fetchGetRoleApiEndpoints,
  fetchGetRoleMenuIds
} from '@/service/api';
import { $t } from '@/locales';

defineOptions({
  name: 'RolePermissionModal'
});

interface Props {
  /** the roleId */
  roleId: string;
  /** the roleCode */
  roleCode: string;
}

const props = defineProps<Props>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const title = computed(() => `${$t('common.edit')}权限配置`);

const activeTab = ref<'menu' | 'api'>('menu');

// ==================== 菜单权限 ====================
const menuTree = shallowRef<TreeOption[]>([]);
const menuChecks = shallowRef<number[]>([]);
const menuLoaded = ref(false);

async function initMenu() {
  const { error, data } = await fetchGetRoleMenuIds(props.roleId);
  if (!error) {
    menuChecks.value = data;
  }
  const res = await fetchGetMenuTree();
  if (!res.error) {
    menuTree.value = res.data.map(recursiveMenu);
    menuLoaded.value = true;
  }
}

function recursiveMenu(item: Api.SystemManage.Menu): TreeOption {
  const result: TreeOption = {
    key: item.id,
    label: $t(item.i18nKey as App.I18n.I18nKey)
  };
  if (item.children && item.children.length > 0) {
    result.children = item.children.map(recursiveMenu);
  }
  return result;
}

// ==================== API 权限 ====================
/** 资源中文名（未映射时回退英文原名） */
const RESOURCE_LABELS: Record<string, string> = {
  'paint:work-order': '喷漆工单',
  'paint:statistics': '喷漆统计',
  authorization: '授权管理',
  'api-endpoint': '接口管理',
  'login-log': '登录日志',
  'operation-log': '操作日志'
};

/** 操作中文名（未映射时回退英文原名） */
const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  'quick-create': '快速建单',
  'batch-create': '批量创建',
  'batch-ocr': '批量OCR',
  update: '更新',
  delete: '删除',
  import: 'Excel导入',
  audit: '审核',
  unaudit: '反审核',
  settle: '结算',
  unsettle: '取消结算',
  'batch-settle': '批量结算',
  'batch-unsettle': '批量取消结算',
  merge: '合并',
  reconcile: '对账',
  abnormal: '异常标注',
  void: '作废',
  unvoid: '恢复作废',
  items: '项目明细',
  export: '导出',
  read: '查看',
  'assign-users': '分配用户',
  'assign-routes': '分配菜单',
  'assign-permission': '分配API权限'
};

/** 端点按 resource → action 两级分组；勾选粒度与 Casbin 策略一致（resource:action） */
const apiTree = shallowRef<TreeOption[]>([]);
const apiChecks = shallowRef<string[]>([]);
/** resource:action → 端点 id 列表（提交时展开为端点 id） */
const endpointIdsByKey = shallowRef<Record<string, string[]>>({});

async function initApi() {
  const keys = await fetchGetRoleApiEndpoints(props.roleCode);
  apiChecks.value = keys || [];
  const { error, data } = await fetchGetApiEndpointTree();
  if (!error) {
    buildApiTree(data);
  }
}

/** 拍平端点树叶子，按 resource/action 聚合成两级树 */
function buildApiTree(nodes: Api.SystemManage.ApiEndpoint[]) {
  const idsByKey: Record<string, string[]> = {};
  const byResource = new Map<string, Set<string>>();

  const walk = (items: Api.SystemManage.ApiEndpoint[]) => {
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        walk(item.children);
        continue;
      }
      if (!item.resource?.trim() || !item.action?.trim()) continue;
      const key = `${item.resource}:${item.action}`;
      (idsByKey[key] ||= []).push(item.id);
      if (!byResource.has(item.resource)) {
        byResource.set(item.resource, new Set());
      }
      byResource.get(item.resource)!.add(item.action);
    }
  };
  walk(nodes);

  const tree: TreeOption[] = [...byResource.keys()]
    .sort()
    .map(resource => ({
      key: resource,
      label: `${RESOURCE_LABELS[resource] || resource}（${resource}）`,
      children: [...byResource.get(resource)!]
        .sort()
        .map(action => ({
          key: `${resource}:${action}`,
          label: `${ACTION_LABELS[action] || action}（${idsByKey[`${resource}:${action}`].length} 个接口）`
        }))
    }));

  apiTree.value = tree;
  endpointIdsByKey.value = idsByKey;
}

// ==================== 保存（一次提交菜单 + API 权限） ====================
const submitting = ref(false);

async function handleSubmit() {
  submitting.value = true;
  try {
    const routeRes = await fetchAssignRoutes({
      roleId: props.roleId,
      routeIds: menuChecks.value
    });
    if (routeRes.error) return;

    const permissions = apiChecks.value.flatMap(key => endpointIdsByKey.value[key] || []);
    const permRes = await fetchAssignPermission({
      roleId: props.roleId,
      permissions
    });
    if (permRes.error) return;

    window.$message?.success?.($t('common.modifySuccess'));
    visible.value = false;
  } finally {
    submitting.value = false;
  }
}

function closeModal() {
  visible.value = false;
}

watch(visible, val => {
  if (val) {
    activeTab.value = 'menu';
    initMenu();
    initApi();
  }
});
</script>

<template>
  <NModal v-model:show="visible" :title="title" preset="card" class="w-600px">
    <NTabs v-model:value="activeTab" type="line">
      <NTabPane name="menu" tab="菜单权限">
        <NTree
          v-model:checked-keys="menuChecks"
          :data="menuTree"
          block-line
          expand-on-click
          checkable
          cascade
          virtual-scroll
          class="h-460px"
        />
      </NTabPane>
      <NTabPane name="api" tab="API 权限">
        <div class="mb-8px text-12px text-gray-400">
          勾选接口组即授权对应 API；保存后该角色的 API 权限将与此勾选完全一致
        </div>
        <NTree
          v-model:checked-keys="apiChecks"
          :data="apiTree"
          block-line
          expand-on-click
          checkable
          cascade
          virtual-scroll
          class="h-440px"
        />
      </NTabPane>
    </NTabs>
    <template #footer>
      <NSpace justify="end">
        <NButton quaternary @click="closeModal">
          {{ $t('common.cancel') }}
        </NButton>
        <NButton type="primary" :loading="submitting" @click="handleSubmit">
          保存
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped></style>
