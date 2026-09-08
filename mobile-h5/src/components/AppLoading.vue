<script setup lang="ts">
/**
 * 通用加载中
 *
 * 替换各页面重复的 `<div class="loading-wrap"><van-loading size="24px">加载中...</van-loading></div>`
 * （原先散落在 vehicle(index/edit)、work-order(index) 等处，样式与文案各自维护）。
 * 注：部分页面的 `.loading-wrap` 内是骨架屏（骨架屏与加载中是不同语义），不在这里收敛。
 */
withDefaults(defineProps<{
  text?: string
  size?: string
}>(), {
  text: '加载中...',
  size: '24px',
})
</script>

<template>
  <div class="app-loading">
    <van-loading :size="size">
      {{ text }}
    </van-loading>
  </div>
</template>

<style scoped>
.app-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px 0;
}
</style>
