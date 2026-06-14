<script setup lang="ts">
import { computed, reactive, watch, ref } from 'vue';
import {
  createStandardTemplate,
  updateStandardTemplate,
  fetchPaintCategoryList,
  fetchSpecialPaintList,
  createSpecialPaint
} from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';

defineOptions({
  name: 'TemplateOperateDrawer'
});

interface Props {
  operateType: NaiveUI.TableOperateType;
  rowData?: any | null;
}

const props = defineProps<Props>();

interface Emits {
  (e: 'submitted'): void;
}

const emit = defineEmits<Emits>();

const visible = defineModel<boolean>('visible', {
  default: false
});

const { formRef, validate, restoreValidation } = useNaiveForm();

const title = computed(() => {
  const titles: Record<NaiveUI.TableOperateType, string> = {
    add: '新增标准模板',
    edit: '编辑标准模板'
  };
  return titles[props.operateType];
});

// 标准项目行：支持多选部位
interface TemplateItem {
  categoryIds: string[];  // 多选部位
  coefficient: number;
  newPartAddition: number;
  alias: string;
}

interface SpecialPaintItem {
  id: string;
  name: string;
  multiplier: number;
  description: string;
  isActive: boolean;
  isNew?: boolean;
}

interface FormModel {
  name: string;
  version: string;
  description: string;
  isActive: boolean;
  items: TemplateItem[];
  specialPaints: SpecialPaintItem[];
}

const model: FormModel = reactive(createDefaultModel());

function createDefaultModel(): FormModel {
  return {
    name: '',
    version: '1.0',
    description: '',
    isActive: true,
    items: [],
    specialPaints: []
  };
}

const categories = ref<any[]>([]);

async function loadCategories() {
  const { data, error } = await fetchPaintCategoryList();
  if (!error && data) {
    categories.value = (data as any[]).filter((c: any) => !c.shopId);
  }
}
loadCategories();

async function loadSpecialPaints() {
  const { data, error } = await fetchSpecialPaintList(true);
  if (!error && data) {
    model.specialPaints = (data as any[]).map((sp: any) => ({
      id: sp.id,
      name: sp.name,
      multiplier: Number(sp.multiplier),
      description: sp.description || '',
      isActive: sp.isActive ?? true,
      isNew: false
    }));
  }
}
loadSpecialPaints();

// 部位多选选项
const categoryOptions = computed(() =>
  categories.value.map(c => ({ label: c.name, value: c.id }))
);

// 已被选中的部位ID集合（用于禁用已选项）
const allSelectedCategoryIds = computed(() => {
  const ids = new Set<string>();
  model.items.forEach(item => {
    item.categoryIds.forEach(id => ids.add(id));
  });
  return ids;
});

// 获取某行可用的部位选项（已选的不禁用，其他行已选的禁用）
function getCategoryOptions(currentCategoryIds: string[]) {
  return categories.value.map(c => {
    const isSelectedByOther = allSelectedCategoryIds.value.has(c.id) && !currentCategoryIds.includes(c.id);
    return {
      label: c.name,
      value: c.id,
      disabled: isSelectedByOther
    };
  });
}

// 显示部位名称，用/连接
function getCategoryDisplayLabel(categoryIds: string[]): string {
  return categoryIds
    .map(id => categories.value.find(c => c.id === id)?.name || id)
    .join(' / ');
}

function addItem() {
  model.items.push({ categoryIds: [], coefficient: 0, newPartAddition: 0, alias: '' });
}

function removeItem(index: number) {
  model.items.splice(index, 1);
}

function addSpecialPaint() {
  model.specialPaints.push({ id: '', name: '', multiplier: 1.0, description: '', isActive: true, isNew: true });
}

function removeSpecialPaint(index: number) {
  model.specialPaints.splice(index, 1);
}

function handleInitModel() {
  Object.assign(model, createDefaultModel());

  if (props.operateType === 'edit' && props.rowData) {
    // 后端返回的items是扁平的（每个item一个categoryId），需要按系数+新件加幅+别名合并
    const rawItems: any[] = props.rowData.items || [];
    const groupMap = new Map<string, any[]>();

    for (const it of rawItems) {
      const key = `${Number(it.coefficient)}_${Number(it.newPartAddition || 0)}_${it.alias || ''}`;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(it);
    }

    const mergedItems: TemplateItem[] = [];
    for (const [, group] of groupMap) {
      mergedItems.push({
        categoryIds: group.map(it => it.categoryId || it.category?.id || ''),
        coefficient: Number(group[0].coefficient) || 0,
        newPartAddition: Number(group[0].newPartAddition) || 0,
        alias: group[0].alias || ''
      });
    }

    Object.assign(model, {
      name: props.rowData.name || '',
      version: props.rowData.version || '',
      description: props.rowData.description || '',
      isActive: props.rowData.isActive ?? true,
      items: mergedItems
    });
  }
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();

  // 先保存新增的特殊车漆
  const newPaints = model.specialPaints.filter(sp => sp.isNew && sp.name.trim());
  for (const sp of newPaints) {
    const { data, error } = await createSpecialPaint({
      name: sp.name.trim(),
      multiplier: sp.multiplier,
      description: sp.description || undefined,
      isActive: sp.isActive
    });
    if (!error && data) {
      sp.id = (data as any).id;
      sp.isNew = false;
    }
  }

  // 将多选部位展开为扁平的items数组
  const flatItems = model.items
    .filter(it => it.categoryIds.length > 0 && (it.coefficient ?? 0) > 0)
    .flatMap(it =>
      it.categoryIds.map(cid => ({
        categoryId: cid,
        coefficient: it.coefficient ?? 0,
        newPartAddition: it.newPartAddition ?? 0,
        alias: it.alias || undefined
      }))
    );

  const submitData = {
    name: model.name,
    version: model.version || undefined,
    description: model.description || undefined,
    isActive: model.isActive,
    items: flatItems
  };

  if (props.operateType === 'add') {
    const { error } = await createStandardTemplate(submitData);
    if (error) return;
    window.$message?.success('创建成功');
  } else {
    const { error } = await updateStandardTemplate({ id: props.rowData.id, ...submitData });
    if (error) return;
    window.$message?.success('更新成功');
  }
  closeDrawer();
  emit('submitted');
}

watch(visible, () => {
  if (visible.value) {
    handleInitModel();
    restoreValidation();
  }
});
</script>

<template>
  <NDrawer v-model:show="visible" display-directive="show" :width="780">
    <NDrawerContent :title="title" :native-scrollbar="false" closable>
      <NForm ref="formRef" :model="model" label-placement="left" :label-width="80">
        <NFormItem label="标准名称" path="name" :rule="{ required: true, message: '请输入标准名称' }">
          <NInput v-model:value="model.name" placeholder="如：喷涂板件工时计价表" />
        </NFormItem>

        <NGrid :cols="2" :x-gap="16">
          <NGridItem>
            <NFormItem label="版本号">
              <NInput v-model:value="model.version" placeholder="如：1.0" />
            </NFormItem>
          </NGridItem>
          <NGridItem>
            <NFormItem label="状态">
              <NSwitch v-model:value="model.isActive" />
            </NFormItem>
          </NGridItem>
        </NGrid>

        <NFormItem label="描述">
          <NInput v-model:value="model.description" type="textarea" placeholder="标准模板描述" :rows="2" />
        </NFormItem>

        <!-- ==================== 标准项目 ==================== -->
        <NDivider title-placement="left">
          标准项目
          <NTag type="info" size="small" round style="margin-left: 8px;">{{ model.items.filter(i => i.categoryIds.length > 0 && i.coefficient > 0).length }} 组</NTag>
        </NDivider>

        <NButton type="primary" dashed block class="mb-12px" @click="addItem">
          <template #icon><icon-ic-round-plus /></template>
          添加标准项目
        </NButton>

        <NCard v-for="(item, index) in model.items" :key="index" size="small" :bordered="true" class="mb-8px">
          <NGrid :cols="2" :x-gap="16" :y-gap="8">
            <NGridItem :span="2">
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">部位名称（可多选，自动用 / 连接）</div>
              <NSelect
                v-model:value="item.categoryIds"
                :options="getCategoryOptions(item.categoryIds)"
                placeholder="选择部位，可多选"
                multiple
                size="small"
              />
            </NGridItem>
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">幅数系数</div>
              <NInputNumber v-model:value="item.coefficient" :min="0" :max="99.99" :step="0.1" size="small" placeholder="如：1.0" style="width: 100%;" />
            </NGridItem>
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">新件加幅</div>
              <NInputNumber v-model:value="item.newPartAddition" :min="0" :max="9.99" :step="0.1" size="small" placeholder="如：0.5" style="width: 100%;" />
            </NGridItem>
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">别名</div>
              <NInput v-model:value="item.alias" size="small" placeholder="可选，门店特有名称" clearable />
            </NGridItem>
            <NGridItem>
              <div class="flex items-center justify-end" style="height: 100%; padding-top: 18px;">
                <NButton type="error" quaternary size="small" @click="removeItem(index)">
                  <template #icon><icon-ic-round-delete /></template>
                  删除
                </NButton>
              </div>
            </NGridItem>
          </NGrid>
        </NCard>

        <NEmpty v-if="model.items.length === 0" description="暂未添加标准项目" />

        <!-- ==================== 特殊车漆 ==================== -->
        <NDivider title-placement="left">
          特殊车漆
          <NTag type="warning" size="small" round style="margin-left: 8px;">{{ model.specialPaints.length }} 种</NTag>
        </NDivider>

        <NAlert type="info" :bordered="false" class="mb-8px">
          特殊车漆作为倍数应用到工单明细，计算幅数时会乘以对应倍数。例如：水晶珍珠漆 x1.3，则该项目的幅数 = 基础幅数 x 1.3。
        </NAlert>

        <NButton type="warning" dashed block class="mb-12px" @click="addSpecialPaint">
          <template #icon><icon-ic-round-plus /></template>
          添加特殊车漆
        </NButton>

        <NCard v-for="(sp, spIndex) in model.specialPaints" :key="spIndex" size="small" :bordered="true" class="mb-8px">
          <NGrid :cols="2" :x-gap="16" :y-gap="8">
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">车漆名称</div>
              <NInput v-model:value="sp.name" size="small" placeholder="如：水晶珍珠漆" />
            </NGridItem>
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">倍数</div>
              <NInputNumber v-model:value="sp.multiplier" :min="1" :max="9.99" :step="0.1" :precision="2" size="small" style="width: 100%;">
                <template #prefix>x</template>
              </NInputNumber>
            </NGridItem>
            <NGridItem>
              <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">描述</div>
              <NInput v-model:value="sp.description" size="small" placeholder="如：水晶珍珠漆，幅数乘以1.3倍" />
            </NGridItem>
            <NGridItem>
              <div class="flex items-center justify-between">
                <div style="flex: 1;">
                  <div class="text-12px mb-4px" style="color: var(--n-text-color-3);">状态</div>
                  <NSwitch v-model:value="sp.isActive">
                    <template #checked>启用</template>
                    <template #unchecked>禁用</template>
                  </NSwitch>
                </div>
                <NButton type="error" quaternary size="small" class="ml-8px" style="margin-top: 18px;" @click="removeSpecialPaint(spIndex)">
                  <template #icon><icon-ic-round-delete /></template>
                </NButton>
              </div>
            </NGridItem>
          </NGrid>
        </NCard>

        <NEmpty v-if="model.specialPaints.length === 0" description="暂未添加特殊车漆" />
      </NForm>

      <template #footer>
        <NSpace :size="16">
          <NButton @click="closeDrawer">取消</NButton>
          <NButton type="primary" @click="handleSubmit">确认</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
