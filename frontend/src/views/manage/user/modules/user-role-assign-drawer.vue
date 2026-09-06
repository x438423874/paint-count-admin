<script setup lang="ts">
import { ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NSpace,
  NTag,
  useMessage
} from 'naive-ui';
import {
  assignUserRoles,
  fetchGetAssignableRoles,
  fetchUserRoleIds
} from '@/service/api/system-manage';

interface Props {
  visible: boolean;
  userId: string | null;
  userName?: string;
}

interface Emits {
  (e: 'update:visible', v: boolean): void;
}

const props = defineProps<Props>();
const emits = defineEmits<Emits>();
const message = useMessage();

const allRoles = ref<Api.SystemManage.Role[]>([]);
/** 勾选 = 该用户最终拥有的角色集合 */
const checkedRoleIds = ref<string[]>([]);
const loading = ref(false);
const submitting = ref(false);

watch(
  () => props.visible,
  async v => {
    if (!v || !props.userId) return;
    await loadData();
  }
);

async function loadData() {
  loading.value = true;
  try {
    const [rolesRes, boundRes] = await Promise.all([
      fetchGetAssignableRoles(),
      fetchUserRoleIds(props.userId as string)
    ]);
    allRoles.value = rolesRes.data?.records || [];
    checkedRoleIds.value = boundRes.data || [];
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载失败');
  } finally {
    loading.value = false;
  }
}

function handleClose() {
  emits('update:visible', false);
}

async function handleSave() {
  submitting.value = true;
  try {
    const { error } = await assignUserRoles(
      props.userId as string,
      checkedRoleIds.value
    );
    if (error) {
      message.error('保存失败');
      return;
    }
    message.success(
      checkedRoleIds.value.length
        ? '分配成功，权限已立即生效'
        : '已清空该用户的角色'
    );
    handleClose();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    submitting.value = false;
  }
}

function handleSelectAll() {
  checkedRoleIds.value = allRoles.value.map(r => r.id);
}

function handleClearAll() {
  checkedRoleIds.value = [];
}
</script>

<template>
  <NDrawer
    :show="visible"
    :width="520"
    placement="right"
    @update:show="(v: boolean) => emits('update:visible', v)"
  >
    <NDrawerContent :title="`分配角色${userName ? ` - ${userName}` : ''}`" closable>
      <div class="mb-12px flex items-center justify-between">
        <span class="text-13px text-gray-500">
          已选 {{ checkedRoleIds.length }} / {{ allRoles.length }} 个角色；保存后全量覆盖，权限立即生效
        </span>
        <NSpace>
          <NButton size="small" @click="handleSelectAll">全选</NButton>
          <NButton size="small" @click="handleClearAll">清空</NButton>
        </NSpace>
      </div>

      <NEmpty v-if="!loading && allRoles.length === 0" description="暂无角色" />

      <NCheckboxGroup v-else v-model:value="checkedRoleIds" class="flex-col gap-8px">
        <div
          v-for="role in allRoles"
          :key="role.id"
          class="rounded-4px bg-[var(--neutral-100)] px-12px py-8px"
        >
          <div class="flex items-center justify-between">
            <NCheckbox :value="role.id">
              <span class="ml-4px font-500">{{ role.name }}</span>
              <span class="ml-8px text-12px text-gray-400">（{{ role.code }}）</span>
            </NCheckbox>
            <NTag
              size="small"
              :bordered="false"
              :type="role.status === 'ENABLED' ? 'success' : 'warning'"
            >
              {{ role.status === 'ENABLED' ? '启用' : '禁用' }}
            </NTag>
          </div>
          <div v-if="role.description" class="mt-4px pl-24px text-12px text-gray-400">
            {{ role.description }}
          </div>
        </div>
      </NCheckboxGroup>

      <template #footer>
        <NSpace>
          <NButton @click="handleClose">取消</NButton>
          <NButton type="primary" :loading="submitting" @click="handleSave">保存</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
