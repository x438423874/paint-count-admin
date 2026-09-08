<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDatePicker,
  NDrawer,
  NDrawerContent,
  NEmpty,
  NForm,
  NFormItem,
  NModal,
  NSpace,
  NTag,
  useMessage
} from 'naive-ui';
import { bindUserShops, fetchUserBoundShops, updateUserShopTenure } from '@/service/api/paint';
import type { UserBoundShop } from '@/service/api/paint';
import { useShopOptions } from '@/hooks/business/use-shop-options';

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

// 门店走 paint store 共享缓存，全应用只请求一次（原为每次打开抽屉各自请求）
const { shops: allShops, ensureShops } = useShopOptions();
/** 已有绑定记录（含离岗留痕） */
const boundShops = ref<UserBoundShop[]>([]);
/** 勾选 = 当前在岗门店集合 */
const checkedShopIds = ref<string[]>([]);
/** 非在岗门店被勾选时的自定义上岗开始时间（shopId -> 时间戳），用于回填历史日期 */
const startAtMap = ref<Record<string, number | null>>({});
const loading = ref(false);
const submitting = ref(false);

const boundMap = computed(() => new Map(boundShops.value.map(s => [s.id, s])));
/** 勾选了但当前不在岗（重新上岗或首次绑定）的门店，需要可选上岗时间 */
const needStartAtIds = computed(() => checkedShopIds.value.filter(id => boundMap.value.get(id)?.endAt));

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
    const [, boundRes] = await Promise.all([
      ensureShops(), // 顺带填充共享门店缓存（allShops 由 store 响应式驱动）
      fetchUserBoundShops(props.userId as string)
    ]);
    boundShops.value = boundRes.data || [];
    checkedShopIds.value = boundShops.value.filter(s => !s.endAt).map(s => s.id);
    startAtMap.value = {};
  } finally {
    loading.value = false;
  }
}

function formatDate(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function tenureText(shopId: string) {
  const bound = boundMap.value.get(shopId);
  if (!bound) return '';
  const start = formatDate(bound.startAt);
  if (bound.endAt) return `离岗：${start} ~ ${formatDate(bound.endAt)}`;
  return `在岗：${start} 至今`;
}

function handleClose() {
  emits('update:visible', false);
}

async function handleSave() {
  submitting.value = true;
  try {
    // 仅对重新上岗/首次绑定的门店传自定义开始时间
    const map: Record<string, string> = {};
    for (const shopId of needStartAtIds.value) {
      const ts = startAtMap.value[shopId];
      if (typeof ts === 'number' && Number.isFinite(ts)) {
        map[shopId] = new Date(ts).toISOString();
      }
    }
    const { error } = await bindUserShops(props.userId as string, checkedShopIds.value, map);
    if (error) {
      message.error('保存失败');
      return;
    }
    message.success('保存成功（取消勾选的门店已离岗留痕）');
    handleClose();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败');
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

// ==================== 在岗期调整 ====================

const adjustVisible = ref(false);
const adjustSubmitting = ref(false);
const adjustForm = reactive({
  shopId: '',
  shopName: '',
  startAt: null as number | null,
  endAt: null as number | null
});

function openAdjust(shop: UserBoundShop) {
  adjustForm.shopId = shop.id;
  adjustForm.shopName = shop.name;
  // 后端可能未返回在岗期（历史数据/接口异常），此时必须回退为 null，
  // 否则 DatePicker 收到 NaN 会在内部格式化时抛 RangeError: Invalid time value
  const startTs = shop.startAt ? new Date(shop.startAt).getTime() : Number.NaN;
  const endTs = shop.endAt ? new Date(shop.endAt).getTime() : Number.NaN;
  adjustForm.startAt = Number.isFinite(startTs) ? startTs : null;
  adjustForm.endAt = Number.isFinite(endTs) ? endTs : null;
  adjustVisible.value = true;
}

async function handleAdjustSubmit() {
  if (!adjustForm.startAt) {
    message.error('请选择在岗开始时间');
    return;
  }
  if (adjustForm.endAt && adjustForm.endAt < adjustForm.startAt) {
    message.error('离岗时间不能早于在岗开始时间');
    return;
  }
  adjustSubmitting.value = true;
  try {
    const { error } = await updateUserShopTenure(
      props.userId as string,
      adjustForm.shopId,
      new Date(adjustForm.startAt).toISOString(),
      adjustForm.endAt ? new Date(adjustForm.endAt).toISOString() : null
    );
    if (error) {
      message.error('调整失败');
      return;
    }
    message.success(adjustForm.endAt ? '已离岗留痕' : '在岗期已更新');
    adjustVisible.value = false;
    await loadData();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '调整失败');
  } finally {
    adjustSubmitting.value = false;
  }
}
</script>

<template>
  <NDrawer :show="visible" :width="520" placement="right" @update:show="(v: boolean) => emits('update:visible', v)">
    <NDrawerContent title="绑定门店（按在岗期授权数据）" closable>
      <div class="mb-12px flex items-center justify-between">
        <span class="text-13px text-gray-500">
          在岗 {{ checkedShopIds.length }} /
          {{ allShops.length }} 个门店；取消勾选保存后自动离岗留痕（仍可只读查看任期内数据）
        </span>
        <NSpace>
          <NButton size="small" @click="handleSelectAll">全选</NButton>
          <NButton size="small" @click="handleClearAll">清空</NButton>
        </NSpace>
      </div>

      <NEmpty v-if="!loading && allShops.length === 0" description="暂无门店" />

      <NCheckboxGroup v-else v-model:value="checkedShopIds" class="flex-col gap-8px">
        <div v-for="shop in allShops" :key="shop.id" class="rounded-4px bg-[var(--neutral-100)] px-12px py-8px">
          <div class="flex items-center justify-between">
            <NCheckbox :value="shop.id">
              <span class="ml-4px font-500">{{ shop.name }}</span>
              <span class="ml-8px text-12px text-gray-400">（{{ shop.code }}）</span>
            </NCheckbox>
            <NSpace align="center" :size="6">
              <NTag size="small" :type="shop.status === 'ENABLED' ? 'success' : 'warning'">
                {{ shop.brand }}
              </NTag>
              <template v-if="boundMap.get(shop.id)">
                <NButton size="tiny" quaternary type="primary" @click="openAdjust(boundMap.get(shop.id)!)">
                  调整
                </NButton>
                <NButton
                  v-if="!boundMap.get(shop.id)!.endAt"
                  size="tiny"
                  quaternary
                  type="warning"
                  @click="openAdjust(boundMap.get(shop.id)!)"
                >
                  离岗
                </NButton>
              </template>
            </NSpace>
          </div>
          <div v-if="boundMap.get(shop.id) || startAtMap[shop.id]" class="mt-4px pl-24px">
            <NTag
              v-if="boundMap.get(shop.id)"
              size="small"
              :type="boundMap.get(shop.id)!.endAt ? 'default' : 'success'"
              :bordered="false"
            >
              {{ tenureText(shop.id) }}
            </NTag>
            <span v-if="needStartAtIds.includes(shop.id)" class="ml-8px text-12px text-gray-500">
              上岗时间
              <NDatePicker
                v-model:value="startAtMap[shop.id]"
                type="date"
                size="small"
                clearable
                class="ml-4px w-170px align-middle"
                placeholder="默认为今天（可回填）"
              />
            </span>
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

    <NModal v-model:show="adjustVisible" preset="card" :title="`调整在岗期 - ${adjustForm.shopName}`" class="w-420px">
      <NForm label-placement="left" :label-width="90">
        <NFormItem label="在岗开始">
          <NDatePicker v-model:value="adjustForm.startAt" type="date" class="w-full" clearable />
        </NFormItem>
        <NFormItem label="离岗时间">
          <NDatePicker
            v-model:value="adjustForm.endAt"
            type="date"
            class="w-full"
            clearable
            placeholder="留空表示在岗中"
          />
        </NFormItem>
        <p class="text-12px text-gray-400">
          调整后该用户的数据可见范围按新在岗期生效（按结算月份归属，工单录入月份与结算月份需都在任期内）。
        </p>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="adjustVisible = false">取消</NButton>
          <NButton type="primary" :loading="adjustSubmitting" @click="handleAdjustSubmit">确认</NButton>
        </NSpace>
      </template>
    </NModal>
  </NDrawer>
</template>
