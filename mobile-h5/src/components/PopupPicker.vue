<script setup lang="ts">
/**
 * 通用底部弹层单选（van-popup + van-picker 壳）
 *
 * 原先各页面重复写 popup(bottom/round) + picker + confirm/cancel 关闭样板，
 * 此处统一；列数据与确认后的业务逻辑仍由调用方提供。
 * 门店（ShopPicker）、在岗期月份（TenureMonthPicker）即基于此组件封装。
 */
withDefaults(defineProps<{
  show: boolean
  columns: { text: string, value: string }[]
  title?: string
  /** 当前选中值（value），用于回显 */
  modelValue?: string | number
}>(), {
  title: '请选择',
  modelValue: '',
})

const emit = defineEmits<{
  (e: 'update:show', v: boolean): void
  (e: 'confirm', value: string): void
}>()

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
