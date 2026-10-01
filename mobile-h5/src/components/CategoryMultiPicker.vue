<script setup lang="ts">
import { ref, watch } from 'vue'

export interface CategoryMultiOption {
  id: string
  label: string
}

export interface CategoryMultiSelection {
  id: string
  quantity: number
}

withDefaults(defineProps<{
  options: CategoryMultiOption[]
  title?: string
}>(), {
  title: '选择部位（可多选）',
})

const emit = defineEmits<{
  (e: 'confirm', selections: CategoryMultiSelection[]): void
}>()

/**
 * 部位多选弹层（添加部位）
 *
 * 勾选行内直接显示数量步进器，选部位的同时定数量，省去逐行二次调整。
 * 每次打开重置勾选，确认时返回勾选的 id 与数量列表。
 */
const show = defineModel<boolean>('show', { default: false })

const checked = ref<string[]>([])
const quantities = ref<Record<string, number>>({})

// 每次打开重置勾选
watch(show, (v) => {
  if (v) {
    checked.value = []
    quantities.value = {}
  }
})

function isChecked(id: string) {
  return checked.value.includes(id)
}

function toggle(id: string) {
  const idx = checked.value.indexOf(id)
  if (idx >= 0) {
    checked.value.splice(idx, 1)
    delete quantities.value[id]
  }
  else {
    checked.value.push(id)
    quantities.value[id] = 1
  }
}

function setQuantity(id: string, value: string | number) {
  quantities.value[id] = Math.max(1, Number(value) || 1)
}

function onConfirm() {
  if (checked.value.length === 0)
    return
  emit('confirm', checked.value.map(id => ({ id, quantity: quantities.value[id] || 1 })))
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
              <template #value>
                <div v-if="isChecked(opt.id)" class="qty-box" @click.stop>
                  <van-stepper
                    :model-value="quantities[opt.id]"
                    min="1"
                    input-width="34px"
                    button-size="22px"
                    @change="(v: string | number) => setQuantity(opt.id, v)"
                  />
                </div>
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

    .qty-box {
      display: flex;
      justify-content: flex-end;
    }
  }

  .category-multi-footer {
    display: flex;
    gap: 12px;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  }
}
</style>
