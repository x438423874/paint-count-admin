<script setup lang="ts">
import { ref, watch } from 'vue';
import { NDrawer, NDrawerContent, NCheckbox, NCheckboxGroup, NSpace, NButton, NEmpty, NTag, useMessage } from 'naive-ui';
import { fetchPaintShopList, fetchUserBoundShops, bindUserShops } from '@/service/api/paint';

interface Props {
  visible: boolean;
  userId: string | null;
}

interface Emits {
  (e: 'update:visible', v: boolean): void;
}

const props = defineProps<Props>();
const emits = defineEmits<Emits>();
const message = useMessage();

const allShops = ref<any[]>([]);
const checkedShopIds = ref<string[]>([]);
const loading = ref(false);
const submitting = ref(false);

watch(
  () => props.visible,
  async (v) => {
    if (!v || !props.userId) return;
    await loadData();
  },
);

async function loadData() {
  loading.value = true;
  try {
    const [shopsRes, boundRes] = await Promise.all([
      fetchPaintShopList(),
      fetchUserBoundShops(props.userId as string),
    ]);
    allShops.value = shopsRes.data || [];
    checkedShopIds.value = (boundRes.data || []).map((s: any) => s.id);
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
    const { error } = await bindUserShops(props.userId as string, checkedShopIds.value);
    if (error) {
      message.error('保存失败');
      return;
    }
    message.success('绑定成功');
    handleClose();
  } finally {
    submitting.value = false;
  }
}

function handleSelectAll() {
  checkedShopIds.value = allShops.value.map((s: any) => s.id);
}

function handleClearAll() {
  checkedShopIds.value = [];
}
</script>

<template>
  <NDrawer
    :show="visible"
    :width="500"
    placement="right"
    @update:show="(v: boolean) => emits('update:visible', v)"
  >
    <NDrawerContent title="绑定门店（数据权限）" closable>
      <div class="mb-12px flex items-center justify-between">
        <NSpace align="center">
          <span class="text-14px">已选 {{ checkedShopIds.length }} / {{ allShops.length }} 个门店</span>
        </NSpace>
        <NSpace>
          <NButton size="small" @click="handleSelectAll">全选</NButton>
          <NButton size="small" @click="handleClearAll">清空</NButton>
        </NSpace>
      </div>

      <NEmpty v-if="!loading && allShops.length === 0" description="暂无门店" />

      <NCheckboxGroup v-else v-model:value="checkedShopIds" class="flex-col gap-8px">
        <div
          v-for="shop in allShops"
          :key="shop.id"
          class="flex items-center justify-between rounded-4px bg-[var(--neutral-100)] px-12px py-8px"
        >
          <NCheckbox :value="shop.id">
            <span class="ml-4px font-500">{{ shop.name }}</span>
            <span class="ml-8px text-12px text-gray-400">（{{ shop.code }}）</span>
          </NCheckbox>
          <NTag size="small" :type="shop.status === 'ENABLED' ? 'success' : 'warning'">
            {{ shop.brand }}
          </NTag>
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
