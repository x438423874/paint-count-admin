<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { MyScope } from '@/api/paint'
import { getMyScopeCached } from '@/utils/tenure'
import { recentMonthOptions } from '@/utils/month-options'

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

const columns = computed(() =>
  recentMonthOptions({
    months: props.months,
    includeAll: props.includeAll,
    allText: '全部月份',
    scope: scope.value,
  }),
)

function onConfirm(month: string) {
  emit('confirm', month)
}
</script>

<template>
  <PopupPicker
    :show="show"
    :columns="columns"
    :title="title"
    :model-value="modelValue"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
  />
</template>
