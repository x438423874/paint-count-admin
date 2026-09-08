<script setup lang="ts">
import { computed } from 'vue'
import { orderStatusColor, orderStatusLabel, orderStatusTagType } from '@/constants/order-status'

/**
 * 工单状态标签
 *
 * 统一消费 constants/order-status 的映射，替代各页面内联的 statusText/statusType 等重复实现。
 *
 * - variant="tag"：vant 标签（列表页、首页）
 * - variant="text"：纯文字 + 色值描边（车辆历史卡片等），可通过 class 透传自定义样式
 */
const props = withDefaults(defineProps<{
  status?: string
  /** tag=vant 标签（默认）；text=纯文字带颜色 */
  variant?: 'tag' | 'text'
  /** 使用短文案（待审/已审/已结） */
  short?: boolean
  /** vant tag 尺寸，仅 variant=tag 生效 */
  size?: 'medium' | 'large'
  /** vant tag 圆角，仅 variant=tag 生效 */
  round?: boolean
}>(), {
  variant: 'tag',
  short: false,
  size: 'medium',
  round: false,
})

const label = computed(() => orderStatusLabel(props.status, props.short))
const color = computed(() => orderStatusColor(props.status))
const type = computed(() => orderStatusTagType(props.status) as any)
</script>

<template>
  <van-tag v-if="variant === 'tag'" :type="type" :size="size" :round="round">
    {{ label }}
  </van-tag>
  <span v-else :style="{ color, borderColor: color }">
    {{ label }}
  </span>
</template>
