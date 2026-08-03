<script setup lang="ts">
defineOptions({ name: 'DarkModeContainer' });

interface Props {
  inverted?: boolean;
}

defineProps<Props>();
</script>

<template>
  <div class="bg-container text-base-text transition-300" :class="{ 'bg-inverted c-[var(--text-invert)]': inverted }">
    <slot></slot>
  </div>
</template>

<style scoped></style>
