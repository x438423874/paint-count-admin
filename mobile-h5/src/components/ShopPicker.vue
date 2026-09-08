<script setup lang="ts">
import { useShopOptions } from '@/composables/useShopOptions'
/**
 * 门店选择弹窗
 *
 * 原先 index / statistics / work-order(index,create) / pending-image
 * 各自写一份 `van-popup + van-picker + shopColumns`，此处统一。
 * 门店数据走 dict store 共享缓存（见 useShopOptions）。
 */
const props = withDefaults(defineProps<{
  show: boolean
  modelValue: string
  /** 是否包含「全部门店」选项（value 为 ''），默认 true */
  includeAll?: boolean
  title?: string
}>(), {
  includeAll: true,
  title: '选择门店',
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'confirm', value: string): void
}>()

const { shopColumns } = useShopOptions({ includeAll: props.includeAll })

function onConfirm(value: string) {
  emit('confirm', value)
}
</script>

<template>
  <PopupPicker
    :show="show"
    :columns="shopColumns"
    :title="title"
    :model-value="modelValue"
    @update:show="emit('update:show', $event)"
    @confirm="onConfirm"
  />
</template>
