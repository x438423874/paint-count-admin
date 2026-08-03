<script setup lang="ts">
import { NEmpty, NSpace, NButton } from 'naive-ui'

withDefaults(
  defineProps<{
    /** 空状态描述文案 */
    description?: string
    /** 操作按钮文案；为空则不显示按钮 */
    actionText?: string
    /** 是否显示默认操作按钮（点击触发 action 事件） */
    showAction?: boolean
  }>(),
  {
    description: '暂无数据',
    actionText: '',
    showAction: false,
  },
)

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <NSpace vertical align="center" :size="8" class="py-32px">
    <NEmpty :description="description" />
    <NButton v-if="showAction && actionText" text type="primary" size="small" @click="emit('action')">
      {{ actionText }}
    </NButton>
    <!-- 自定义操作区（如带权限判断的按钮） -->
    <slot name="action" />
  </NSpace>
</template>
