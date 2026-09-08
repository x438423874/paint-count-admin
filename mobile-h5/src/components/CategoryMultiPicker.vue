<script setup lang="ts">
import { ref, watch } from 'vue'

export interface CategoryMultiOption {
  id: string
  label: string
}

withDefaults(defineProps<{
  options: CategoryMultiOption[]
  title?: string
}>(), {
  title: '选择部位（可多选）',
})

const emit = defineEmits<{
  (e: 'confirm', ids: string[]): void
}>()

/**
 * 部位多选弹层（添加部位）
 *
 * 原先内联在工单详情页，抽出供工单类页面复用。
 * 每次打开重置勾选，确认时返回勾选的 id 列表。
 */
const show = defineModel<boolean>('show', { default: false })

const checked = ref<string[]>([])

// 每次打开重置勾选
watch(show, (v) => {
  if (v)
    checked.value = []
})

function toggle(id: string) {
  const idx = checked.value.indexOf(id)
  if (idx >= 0)
    checked.value.splice(idx, 1)
  else checked.value.push(id)
}

function onConfirm() {
  if (checked.value.length === 0)
    return
  emit('confirm', [...checked.value])
  show.value = false
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round>
    <div class="category-multi-picker">
      <div class="category-multi-header">
        <span class="category-multi-title">{{ title }}</span>
        <span class="category-multi-count">已选 {{ checked.length }}</span>
      </div>
      <div class="category-multi-list">
        <van-checkbox-group v-model="checked">
          <van-cell-group inset>
            <van-cell
              v-for="opt in options"
              :key="opt.id"
              clickable
              @click="toggle(opt.id)"
            >
              <template #title>
                <van-checkbox :name="opt.id" shape="square" @click.stop>
                  {{ opt.label }}
                </van-checkbox>
              </template>
            </van-cell>
          </van-cell-group>
        </van-checkbox-group>
      </div>
      <div class="category-multi-footer">
        <van-button plain block type="primary" @click="show = false">
          取消
        </van-button>
        <van-button block type="primary" :disabled="checked.length === 0" @click="onConfirm">
          确定
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<style lang="less" scoped>
.category-multi-picker {
  .category-multi-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;

    .category-multi-title {
      font-size: 16px;
      font-weight: 600;
    }

    .category-multi-count {
      font-size: 12px;
      color: var(--color-text-tertiary, #999);
    }
  }

  .category-multi-list {
    max-height: 45vh;
    overflow-y: auto;
  }

  .category-multi-footer {
    display: flex;
    gap: 12px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  }
}
</style>
