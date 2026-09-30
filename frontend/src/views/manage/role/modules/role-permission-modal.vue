<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { TreeOption } from 'naive-ui';
import { fetchAssignRoutes, fetchGetMenuTree, fetchGetRoleMenuIds } from '@/service/api';
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

// ==================== 权限树（芋道式：菜单 + 按钮权限叶子同一棵树、同一份存储） ====================
const permTree = shallowRef<TreeOption[]>([]);
const checkedKeys = shallowRef<Array<number | string>>([]);
const expandedKeys = shallowRef<Array<number | string>>([]);

async function initTree() {
  const [menuRes, roleMenuRes] = await Promise.all([
    fetchGetMenuTree(),
    fetchGetRoleMenuIds(props.roleId)
  ]);

  const buildNodes = (items: Api.SystemManage.Menu[]): TreeOption[] =>
    items.map(item => {
      const node: TreeOption = {
        key: item.id,
        label: nodeLabel(item)
      };
      if (item.children && item.children.length > 0) {
        node.children = buildNodes(item.children);
      }
      return node;
    });

  // 按钮叶子提示其权限标识
  function nodeLabel(item: Api.SystemManage.Menu) {
    if (item.menuType === 'button') {
      return item.permission ? `${item.menuName}（${item.permission}）` : item.menuName;
    }
    return item.i18nKey ? $t(item.i18nKey as App.I18n.I18nKey) : item.menuName;
  }

  permTree.value = menuRes.error ? [] : buildNodes(menuRes.data);
  expandedKeys.value = collectExpandableKeys(permTree.value);

  // 初始勾选 = 该角色已绑定的全部菜单/按钮行（auth-route 接口返回含按钮 id）
  checkedKeys.value = roleMenuRes.error ? [] : roleMenuRes.data;
}

function collectExpandableKeys(nodes: TreeOption[]): Array<number | string> {
  const keys: Array<number | string> = [];
  const walk = (list: TreeOption[]) => {
    for (const node of list) {
      if (node.children && node.children.length > 0) {
        keys.push(node.key as number);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return keys;
}

// ==================== 保存（一次调用：菜单 + 按钮同一份 sys_role_menu） ====================
const submitting = ref(false);

function handleSubmit() {
  // 全量覆盖式保存：二次确认防止误操作覆盖整棵权限树
  window.$dialog?.warning({
    title: '确认保存权限',
    content: '保存将全量覆盖该角色的菜单与按钮权限（未勾选的将被移除），是否继续？',
    positiveText: '确认保存',
    negativeText: '取消',
    onPositiveClick: () => {
      void doSave();
    }
  });
}

async function doSave() {
  submitting.value = true;
  try {
    const routeIds = checkedKeys.value.filter((k): k is number => typeof k === 'number');
    const res = await fetchAssignRoutes({
      roleId: props.roleId,
      routeIds
    });
    if (res.error) return;

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
    initTree();
  }
});
</script>

<template>
  <NModal v-model:show="visible" :title="title" preset="card" class="w-560px">
    <div class="mb-8px text-12px text-gray-400">
      与芋道一致：菜单与按钮权限同一棵树、同一份存储；勾选父节点自动包含子按钮。按钮叶子括号内为其权限标识
    </div>
    <NTree
      v-model:checked-keys="checkedKeys"
      v-model:expanded-keys="expandedKeys"
      :data="permTree"
      block-line
      checkable
      cascade
      virtual-scroll
      class="h-480px"
    />
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
