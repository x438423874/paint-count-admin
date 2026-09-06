<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { MyScope } from '@/api/paint'
import { monthInTenure, getMyScopeCached } from '@/utils/tenure'

/**
 * 在岗期月份选择弹窗（统一口径，供数据统计/幅数管理等页面复用）
 * - 月份选项 = 最近 N 个月 ∩ 任期覆盖月份（与后端 tenureCoversMonth 口径一致）
 * - 超管/财务（scope=all）不受限；scope 加载失败时宽松降级显示全部
 */
const props = withDefaults(defineProps<{
  show: boolean
  modelValue: string
  /** 是否包含"全部月份"选项（value 为 ''） */
  includeAll?: boolean
  title?: string
  /** 向前回溯的月数，默认 12 */
  months?: number
}>(), {
  includeAll: false,
  title: '选择月份',
  months: 12,
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'confirm', month: string): void
}>()

const scope = ref<MyScope | null>(null)

onMounted(async () => {
  // 会话级共享缓存：与数据统计等页面共用同一次 my-scope 请求结果，保证月份口径一致
  scope.value = await getMyScopeCached()
})

const columns = computed(() => {
  const list: { text: string, value: string }[] = []
  if (props.includeAll)
    list.push({ text: '全部月份', value: '' })
  const now = new Date()
  for (let i = 0; i < props.months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthInTenure(value, scope.value))
      list.push({ text: value, value })
  }
  return list
})

function onConfirm({ selectedValues }: any) {
  emit('update:show', false)
  emit('confirm', selectedValues[0] ?? '')
}
function onCancel() {
  emit('update:show', false)
}
</script>

<template>
  <van-popup :show="show" position="bottom" round @update:show="emit('update:show', $event)">
    <van-picker
      :title="title"
      :columns="columns"
      :model-value="[modelValue]"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </van-popup>
</template>
