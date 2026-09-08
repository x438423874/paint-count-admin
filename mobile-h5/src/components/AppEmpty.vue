<script setup lang="ts">
/**
 * 通用空状态
 *
 * 统一各页面零散的 `<van-empty>`：集中默认文案与图片类型，
 * 后续要统一调整空状态样式/文案时只需改这一处。
 */
withDefaults(defineProps<{
  description?: string
  /** van-empty 内置图片类型 */
  image?: 'default' | 'error' | 'network' | 'search'
}>(), {
  description: '暂无数据',
  image: 'default',
})
</script>

<template>
  <van-empty :image="image" :description="description" />
</template>
