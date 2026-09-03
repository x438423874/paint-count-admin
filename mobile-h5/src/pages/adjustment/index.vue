<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showNotify } from 'vant'
import {
  getAdjustmentList,
  createAdjustment,
  deleteAdjustment,
  getShopList,
  getCategories,
} from '@/api/paint'
import type { PaintAdjustment, PaintShop, PaintCategory, CreateAdjustmentParams } from '@/api/types/paint'

const router = useRouter()

const shops = ref<PaintShop[]>([])
const categories = ref<PaintCategory[]>([])
const adjustments = ref<PaintAdjustment[]>([])
const loading = ref(false)
const refreshing = ref(false)

const selectedShopId = ref('')
const selectedApplyMonth = ref('')

const monthColumns = computed(() => {
  const list = [{ text: '全部月份', value: '' }]
  const now = new Date()
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    list.push({ text: value, value })
  }
  return list
})

const shopColumns = computed(() => {
  const cols = [{ text: '全部门店', value: '' }]
  shops.value.forEach(s => cols.push({ text: s.name, value: s.id }))
  return cols
})

const categoryColumns = computed(() => {
  const cols = [{ text: '整体调整（不指定部位）', value: '' }]
  categories.value.forEach(c => cols.push({ text: `${c.name}（${c.code}）`, value: c.id }))
  return cols
})

async function loadShops() {
  try {
    const res = await getShopList()
    shops.value = (res as any) as PaintShop[]
    if (shops.value.length === 1 && !selectedShopId.value)
      selectedShopId.value = shops.value[0].id
  }
  catch {
    shops.value = []
  }
}

async function loadCategories() {
  try {
    const res = await getCategories()
    categories.value = (res as any) || []
  }
  catch {
    categories.value = []
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getAdjustmentList({
      ...(selectedShopId.value ? { shopId: selectedShopId.value } : {}),
      ...(selectedApplyMonth.value ? { applyMonth: selectedApplyMonth.value } : {}),
    })
    adjustments.value = (res as any as PaintAdjustment[]) || []
  }
  catch {
    adjustments.value = []
  }
  finally {
    loading.value = false
    refreshing.value = false
  }
}

function onRefresh() {
  refreshing.value = true
  loadData()
}

function onShopConfirm({ selectedValues }: any) {
  selectedShopId.value = selectedValues[0]
  showShopPicker.value = false
  loadData()
}

function onMonthConfirm({ selectedValues }: any) {
  selectedApplyMonth.value = selectedValues[0]
  showMonthPicker.value = false
  loadData()
}

// ===== 新建调整单 =====
const showCreate = ref(false)
const creating = ref(false)
const form = reactive<CreateAdjustmentParams & { targetMonth: string; applyMonth: string; categoryId: string }>({
  shopId: '',
  targetMonth: '',
  applyMonth: '',
  categoryId: '',
  paintCount: 0,
  newPartQuantity: 0,
  reason: '',
})

const showCreateShopPicker = ref(false)
const showTargetPicker = ref(false)
const showApplyPicker = ref(false)
const showCategoryPicker = ref(false)

function openCreate() {
  form.shopId = selectedShopId.value
  form.targetMonth = ''
  form.applyMonth = ''
  form.categoryId = ''
  form.paintCount = 0
  form.newPartQuantity = 0
  form.reason = ''
  showCreate.value = true
}

function submitCreate() {
  if (!form.shopId) {
    showNotify({ type: 'warning', message: '请选择门店' })
    return
  }
  if (!form.targetMonth) {
    showNotify({ type: 'warning', message: '请选择被纠错月份' })
    return
  }
  if (form.paintCount === 0) {
    showNotify({ type: 'warning', message: '幅数调整量不能为 0（正数追加、负数扣减）' })
    return
  }
  if (!form.reason.trim()) {
    showNotify({ type: 'warning', message: '请填写调整原因' })
    return
  }
  creating.value = true
  const now = new Date()
  const defaultApply = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  createAdjustment({
    shopId: form.shopId,
    targetMonth: form.targetMonth,
    applyMonth: form.applyMonth || defaultApply,
    categoryId: form.categoryId || undefined,
    paintCount: form.paintCount,
    newPartQuantity: form.newPartQuantity || undefined,
    reason: form.reason,
  })
    .then(() => {
      showNotify({ type: 'success', message: '调整单已创建，统计已自动纠偏' })
      showCreate.value = false
      loadData()
    })
    .catch(() => {
      // 错误提示由拦截器处理
    })
    .finally(() => {
      creating.value = false
    })
}

function onShopCreateConfirm({ selectedValues }: any) {
  form.shopId = selectedValues[0]
  showCreateShopPicker.value = false
}

function onTargetConfirm({ selectedValues }: any) {
  form.targetMonth = selectedValues[0]
  showTargetPicker.value = false
}

function onApplyConfirm({ selectedValues }: any) {
  form.applyMonth = selectedValues[0]
  showApplyPicker.value = false
}

function onCategoryConfirm({ selectedValues }: any) {
  form.categoryId = selectedValues[0]
  showCategoryPicker.value = false
}

function shopName(id: string) {
  return shops.value.find(s => s.id === id)?.name || id || '全部'
}

function categoryName(id: string | null) {
  if (!id) return '整体调整'
  return categories.value.find(c => c.id === id)?.name || id
}

async function onDelete(item: PaintAdjustment) {
  try {
    await showConfirmDialog({
      title: '删除调整单',
      message: `确定删除该调整单（撤销本次纠错）吗？\n${shopName(item.shopId)} · 被纠错 ${item.targetMonth} · ${item.paintCount} 幅`,
    })
    await deleteAdjustment(item.id)
    showNotify({ type: 'success', message: '已删除' })
    loadData()
  }
  catch {
    // 取消
  }
}

function formatTime(t?: string) {
  if (!t) return ''
  return t.slice(0, 16).replace('T', ' ')
}

onMounted(async () => {
  await loadShops()
  await loadCategories()
  loadData()
})
</script>

<template>
  <div class="adj-page">
    <van-nav-bar title="幅数调整单" fixed placeholder right-text="新建" @click-right="openCreate" />

    <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
      <!-- 筛选栏 -->
      <div class="filter-bar">
        <div class="filter-pill" @click="showShopPicker = true">
          <span>{{ shopName(selectedShopId) }}</span>
          <van-icon name="arrow-down" size="12" />
        </div>
        <div class="filter-pill" @click="showMonthPicker = true">
          <span>计入：{{ selectedApplyMonth || '全部' }}</span>
          <van-icon name="arrow-down" size="12" />
        </div>
      </div>

      <van-empty v-if="!loading && adjustments.length === 0" description="暂无调整单" />
      <van-cell-group v-else inset class="adj-list">
        <van-swipe-cell v-for="item in adjustments" :key="item.id">
          <van-cell :title="shopName(item.shopId)" :label="`被纠错 ${item.targetMonth} · 计入 ${item.applyMonth}`">
            <template #value>
              <div class="adj-value" :class="Number(item.paintCount) < 0 ? 'neg' : 'pos'">
                {{ Number(item.paintCount) > 0 ? '+' : '' }}{{ Number(item.paintCount).toFixed(1) }} 幅
              </div>
              <div v-if="item.newPartQuantity" class="adj-sub">
                新件 {{ item.newPartQuantity }}
              </div>
              <div class="adj-tag">
                {{ categoryName(item.categoryId) }}
              </div>
            </template>
          </van-cell>
          <template #label>
            <div class="adj-reason">
              {{ item.reason || '无原因' }}
            </div>
            <div class="adj-meta">
              {{ item.operatorName || '未知' }} · {{ formatTime(item.createdAt) }}
            </div>
          </template>
          <template #right>
            <van-button square type="danger" text="删除" class="del-btn" @click="onDelete(item)" />
          </template>
        </van-swipe-cell>
      </van-cell-group>

      <div style="height: 60px" />
    </van-pull-refresh>

    <!-- 门店筛选 -->
    <van-popup v-model:show="showShopPicker" position="bottom" round>
      <van-picker :columns="shopColumns" :model-value="[selectedShopId]" @confirm="onShopConfirm" @cancel="showShopPicker = false" />
    </van-popup>
    <!-- 计入月份筛选 -->
    <van-popup v-model:show="showMonthPicker" position="bottom" round>
      <van-picker :columns="monthColumns" :model-value="[selectedApplyMonth]" @confirm="onMonthConfirm" @cancel="showMonthPicker = false" />
    </van-popup>

    <!-- 新建调整单 -->
    <van-popup v-model:show="showCreate" position="bottom" round :style="{ height: '80%' }">
      <div class="create-panel">
        <van-nav-bar title="新建幅数调整单" left-text="取消" right-text="保存" @click-left="showCreate = false" @click-right="submitCreate" />

        <div class="form-area">
          <van-cell title="门店" is-link :value="shopName(form.shopId)" @click="showCreateShopPicker = true" />
          <van-cell title="被纠错月份" is-link :value="form.targetMonth || '请选择'" @click="showTargetPicker = true" />
          <van-cell title="计入月份" is-link :value="form.applyMonth || '默认本月'" @click="showApplyPicker = true" />
          <van-cell title="部位" is-link :value="categoryName(form.categoryId)" @click="showCategoryPicker = true" />

          <van-cell title="幅数调整（正追加/负扣减）">
            <template #value>
              <van-stepper v-model="form.paintCount" :min="-9999" :max="9999" :step="0.5" :decimal-length="1" />
            </template>
          </van-cell>
          <van-cell title="新件调整">
            <template #value>
              <van-stepper v-model="form.newPartQuantity" :min="-9999" :max="9999" :step="1" integer />
            </template>
          </van-cell>

          <van-field v-model="form.reason" label="原因" type="textarea" rows="2" autosize placeholder="请说明纠错原因，便于审计追溯" />
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="showCreateShopPicker" position="bottom" round>
      <van-picker :columns="shopColumns" :model-value="[form.shopId]" @confirm="onShopCreateConfirm" @cancel="showCreateShopPicker = false" />
    </van-popup>
    <van-popup v-model:show="showTargetPicker" position="bottom" round>
      <van-picker :columns="monthColumns" :model-value="[form.targetMonth]" @confirm="onTargetConfirm" @cancel="showTargetPicker = false" />
    </van-popup>
    <van-popup v-model:show="showApplyPicker" position="bottom" round>
      <van-picker :columns="monthColumns" :model-value="[form.applyMonth]" @confirm="onApplyConfirm" @cancel="showApplyPicker = false" />
    </van-popup>
    <van-popup v-model:show="showCategoryPicker" position="bottom" round>
      <van-picker :columns="categoryColumns" :model-value="[form.categoryId]" @confirm="onCategoryConfirm" @cancel="showCategoryPicker = false" />
    </van-popup>
  </div>
</template>

<route lang="json5">
{
  name: 'Adjustment'
}
</route>

<style lang="less" scoped>
.adj-page {
  min-height: 100vh;
  background: var(--color-bg);
  padding-bottom: 20px;
}

.filter-bar {
  display: flex;
  gap: 10px;
  padding: 12px 16px;
}

.filter-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-surface);
  border-radius: 16px;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--color-text);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
}

.adj-list {
  margin: 0 12px;
}

.adj-value {
  font-size: 16px;
  font-weight: 700;
}

.adj-value.pos {
  color: var(--color-success);
}

.adj-value.neg {
  color: var(--color-danger);
}

.adj-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.adj-tag {
  display: inline-block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-radius: 6px;
  padding: 1px 6px;
}

.adj-reason {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.adj-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.del-btn {
  height: 100%;
}

.create-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.form-area {
  flex: 1;
  overflow-y: auto;
  padding-top: 8px;
}
</style>
