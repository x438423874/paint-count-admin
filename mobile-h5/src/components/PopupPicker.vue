<script setup lang="ts">
import { nextTick, watch } from 'vue'

/**
 * 通用底部弹层单选（van-popup + van-picker 壳）
 *
 * 原先各页面重复写 popup(bottom/round) + picker + confirm/cancel 关闭样板，
 * 此处统一；列数据与确认后的业务逻辑仍由调用方提供。
 * 门店（ShopPicker）、在岗期月份（TenureMonthPicker）即基于此组件封装。
 */
const props = withDefaults(defineProps<{
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

// 部分 webview（页面后台加载/被系统冻结后恢复）会停止触发 requestAnimationFrame，
// Vue 过渡的 enter-from/enter-active 类因此永不移除，弹层被卡在屏幕外的入场位置
// （数据统计页月份选择器实测复现：弹层 top=视口高度，选项完全不可见）。
// setTimeout 不受 rAF 冻结影响：打开后延迟清理卡住的过渡类，弹层立即就位。
watch(() => props.show, (v) => {
  if (!v) return
  void nextTick(() => {
    setTimeout(() => {
      document
        .querySelectorAll('.van-popup-slide-bottom-enter-active, .van-popup-slide-bottom-enter-from')
        .forEach(el => el.classList.remove('van-popup-slide-bottom-enter-active', 'van-popup-slide-bottom-enter-from'))
    }, 60)
  })
})
</script>

<template>
  <!-- duration=0：部分 webview（微信 XWEB 等）会把滑入动画冻结在半途，
       弹层沉到屏幕外导致无法选择（数据统计月份选择器实测复现）。
       去掉动画让弹层瞬间出现在正确位置，可靠性优先于过渡效果。 -->
  <van-popup :show="show" position="bottom" round :duration="0" @update:show="emit('update:show', $event)">
    <van-picker
      :title="title"
      :columns="columns"
      :model-value="[modelValue]"
      @confirm="onConfirm"
      @cancel="onCancel"
    />
  </van-popup>
</template>
