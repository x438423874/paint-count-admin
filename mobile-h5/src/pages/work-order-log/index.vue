<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchWorkOrderLogPage, type WorkOrderLogRow } from '@/api/paint'
import { useShopOptions } from '@/composables/useShopOptions'

const router = useRouter()
const { shops } = useShopOptions({ includeAll: true })

// ==================== 筛选 ====================
const showShopPicker = ref(false)
const selectedShopId = ref('')
const selectedAction = ref('')

const ACTION_TABS = [
  { label: '全部', value: '' },
  { label: '删除', value: 'DELETE' },
  { label: '审核', value: 'AUDIT' },
  { label: '结算', value: 'SETTLE' },
  { label: '编辑', value: 'UPDATE' },
  { label: '创建', value: 'CREATE' },
  { label: '图片', value: 'IMAGE_ADD' },
]

const ACTION_LABEL: Record<string, string> = {
  CREATE: '创建',
  IMPORT: 'Excel 导入',
  UPDATE: '编辑',
  DELETE: '删除',
  AUDIT: '审核',
  UNAUDIT: '取消审核',
  SETTLE: '结算',
  UNSETTLE: '取消结算',
  VOID: '作废',
  UNVOID: '恢复作废',
  ABNORMAL: '标记异常',
  UNABNORMAL: '取消异常',
  REWORK: '返工标记',
  MERGE: '合并',
  ITEM_ADD: '添加部位',
  ITEM_DEL: '删除部位',
  IMAGE_ADD: '上传图片',
  IMAGE_DEL: '删除图片',
  MATCH: '图片归类',
  OCR_CORRECT: 'OCR 修正',
}

const ACTION_DANGER = new Set(['DELETE', 'VOID'])

function formatTime(createdAt: string) {
  const d = new Date(createdAt)
  if (Number.isNaN(d.getTime()))
    return createdAt
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ==================== 列表 ====================
const records = ref<WorkOrderLogRow[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const finished = ref(false)
const error = ref(false)

async function loadPage(reset = false) {
  // 注意：van-list 触发 onLoad 时 loading 已为 true，此处不能再用 loading 早退（会死锁）
  if (!reset && finished.value)
    return
  if (reset) {
    page.value = 1
    records.value = []
    finished.value = false
  }
  loading.value = true
  try {
    const res: any = await fetchWorkOrderLogPage({
      shopId: selectedShopId.value || undefined,
      action: selectedAction.value || undefined,
      current: page.value,
      size: 20,
    })
    const list = res?.records || []
    records.value = reset ? list : [...records.value, ...list]
    total.value = res?.total || 0
    if (list.length < 20)
      finished.value = true
    else
      page.value++
  }
  catch {
    error.value = true
  }
  finally {
    loading.value = false
  }
}

function onLoad() {
  loadPage(false)
}

function onActionTab(value: string) {
  selectedAction.value = value
  loadPage(true)
}

function onShopConfirm(value: string) {
  selectedShopId.value = value
  loadPage(true)
}

function goOrder(orderId: string) {
  router.push({ name: 'WorkOrderDetail', query: { id: orderId } })
}
</script>

<template>
  <div class="log-page">
    <!-- 门店筛选 -->
    <div class="filter-bar">
      <div class="shop-pill" @click="showShopPicker = true">
        <van-icon name="shop-o" size="13" />
        <span>{{ selectedShopId ? shops.find(s => s.id === selectedShopId)?.name || '该门店' : '全部门店' }}</span>
        <van-icon name="arrow-down" size="10" />
      </div>
      <span class="filter-total">共 {{ total }} 条</span>
    </div>

    <!-- 动作类型标签 -->
    <van-tabs v-model:active="selectedAction" swipeable @change="onActionTab">
      <van-tab v-for="tab in ACTION_TABS" :key="tab.value" :title="tab.label" :name="tab.value" />
    </van-tabs>

    <!-- 列表 -->
    <van-list
      v-model:loading="loading"
      v-model:error="error"
      :finished="finished"
      finished-text="没有更多了"
      error-text="加载失败，点击重试"
      @load="onLoad"
    >
      <div v-for="row in records" :key="row.id" class="log-row">
        <span
          class="action-dot"
          :class="{ danger: ACTION_DANGER.has(row.action) }"
        />
        <div class="log-main">
          <div class="log-line1">
            <span class="action-tag" :class="{ danger: ACTION_DANGER.has(row.action) }">
              {{ ACTION_LABEL[row.action] || row.action }}
            </span>
            <span
              class="order-no"
              :class="{ disabled: row.action === 'DELETE' }"
              @click="row.action !== 'DELETE' && goOrder(row.orderId)"
            >
              {{ row.orderNo }}
            </span>
            <span v-if="row.action === 'DELETE'" class="deleted-tag">已删除</span>
          </div>
          <div v-if="row.detail" class="log-detail">
            {{ row.detail }}
          </div>
          <div class="log-meta">
            {{ formatTime(row.createdAt) }} · {{ row.username }}
          </div>
        </div>
      </div>
      <AppEmpty v-if="!loading && records.length === 0" description="暂无操作记录" />
    </van-list>

    <ShopPicker v-model:show="showShopPicker" :model-value="selectedShopId" @confirm="onShopConfirm" />
  </div>
</template>

<route lang="json5">
{
  name: 'WorkOrderLog'
}
</route>

<style lang="less" scoped>
.log-page {
  min-height: 100vh;
  background: var(--color-bg, #f7f8fa);
  padding-bottom: 24px;
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;

  .shop-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 14px;
    background: #fff;
    font-size: 13px;
    color: var(--text-regular, #333);
  }

  .filter-total {
    font-size: 12px;
    color: var(--text-secondary, #999);
  }
}

.log-row {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid var(--color-border-light, #f0f0f0);

  .action-dot {
    width: 8px;
    height: 8px;
    margin-top: 7px;
    border-radius: 50%;
    background: var(--color-success, #34c77b);
    flex-shrink: 0;

    &.danger {
      background: var(--color-danger, #ee4d4d);
    }
  }

  .log-main {
    flex: 1;
    min-width: 0;
  }

  .log-line1 {
    display: flex;
    align-items: center;
    gap: 8px;

    .action-tag {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-regular, #333);

      &.danger {
        color: var(--color-danger, #ee4d4d);
      }
    }

    .order-no {
      font-size: 13px;
      color: var(--color-primary, #1989fa);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.disabled {
        color: var(--text-secondary, #999);
        text-decoration: line-through;
      }
    }

    .deleted-tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: #f0f0f0;
      color: #999;
      flex-shrink: 0;
    }
  }

  .log-detail {
    font-size: 12px;
    color: var(--text-regular, #666);
    margin-top: 3px;
    word-break: break-all;
  }

  .log-meta {
    font-size: 11px;
    color: var(--text-secondary, #999);
    margin-top: 3px;
  }
}
</style>
