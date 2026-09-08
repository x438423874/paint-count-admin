<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NInputGroup,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NStep,
  NSteps,
  NText
} from 'naive-ui';
import {
  detectExcelTemplate,
  fetchCategoryAliasMap,
  fetchShopCategoriesWithStandard,
  getExcelTemplateConfig,
  saveExcelTemplateAndAliasMap
} from '@/service/api';

const props = defineProps<{
  show: boolean;
  shopId: string;
  shopName?: string;
}>();

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
}>();

const loading = ref(false);
const saving = ref(false);
const step = ref<1 | 2>(1);
const templateConfig = ref<any>(null);
const aliasMapData = ref<Record<string, string[]>>({});
const shopCategoryStandards = ref<
  { id: string; name: string; alias: string; paintCount: number; newPartAddition: number }[]
>([]);
const templateFileInputRef = ref<HTMLInputElement | null>(null);

const templateCategories = computed(() => templateConfig.value?.items || []);

function getCategoryOptions(templateName: string) {
  const templateStd = shopCategoryStandards.value.find(s => s.name === templateName || s.alias === templateName);
  const templateCoefficient = templateStd?.paintCount;
  const currentValues = aliasMapData.value[templateName] || [];

  // 记录每个系统部位被哪些模板列选中了（仅统计当前模板中仍存在的列，
  // 避免已删除/重命名列的残留映射占用系统部位，导致无法重新绑定）
  const validNames = new Set((templateConfig.value?.items || []).map((i: { categoryName: string }) => i.categoryName));
  const selectedByOther = new Map<string, string[]>();
  Object.entries(aliasMapData.value)
    .filter(([name, ids]) => name !== templateName && validNames.has(name) && Array.isArray(ids))
    .forEach(([name, ids]) => {
      for (const id of ids) {
        if (!selectedByOther.has(id)) selectedByOther.set(id, []);
        selectedByOther.get(id)!.push(name);
      }
    });

  const sameCoefficientCategories =
    templateCoefficient !== undefined
      ? shopCategoryStandards.value.filter(s => Math.abs(s.paintCount - templateCoefficient) < 0.001)
      : [];

  const availableOptions: { label: string; value: string }[] = [];
  const occupiedOptions: { label: string; value: string; disabled: boolean }[] = [];

  for (const c of shopCategoryStandards.value) {
    const isCurrent = currentValues.includes(c.id);
    const occupiedBy = selectedByOther.get(c.id) || [];
    const isOccupied = occupiedBy.length > 0 && !isCurrent;

    const label = `${c.name} (${(Number(c.paintCount) || 0).toFixed(1)}幅)`;
    const isSameCoeff = sameCoefficientCategories.some(s => s.id === c.id);
    const baseLabel = isSameCoeff ? `⭐ ${label}` : label;

    if (isOccupied) {
      occupiedOptions.push({
        label: `${baseLabel} [已映射: ${occupiedBy.join(', ')}]`,
        value: c.id,
        disabled: true
      });
    } else {
      availableOptions.push({
        label: baseLabel,
        value: c.id
      });
    }
  }

  // 当前列没有可用选项时（全部被其他列占用），显示已被占用的选项并禁用，避免空列表
  if (availableOptions.length === 0) {
    console.warn(`[excel-config-modal] "${templateName}" 没有可用选项，所有系统部位已被其他模板列映射`);
    return occupiedOptions;
  }

  const result = [...availableOptions, ...occupiedOptions];
  return result;
}

function autoFillAliasMap() {
  const items = templateConfig.value?.items || [];
  if (!items.length || !shopCategoryStandards.value.length) return;

  let filledCount = 0;
  for (const item of items) {
    const templateName = item.categoryName;
    if (!templateName) continue;

    // 如果该列已经有手动配置，不覆盖
    const existing = aliasMapData.value[templateName];
    if (Array.isArray(existing) && existing.length > 0) continue;

    // 按名称或别名精确匹配系统部位
    const matched = shopCategoryStandards.value.find(s => s.name === templateName || s.alias === templateName);

    if (matched?.id) {
      aliasMapData.value[templateName] = [matched.id];
      filledCount += 1;
    }
  }

  if (filledCount > 0) {
    window.$message?.success(`已自动匹配 ${filledCount} 个部位映射`);
  }
}

async function loadConfig() {
  loading.value = true;
  try {
    const [configRes, aliasRes, standardsWithCatRes] = await Promise.all([
      getExcelTemplateConfig(props.shopId),
      fetchCategoryAliasMap(props.shopId),
      fetchShopCategoriesWithStandard(props.shopId)
    ]);

    // 检查各接口是否有错误（createFlatRequest 不会 throw，错误在 error 字段中）
    if (configRes.error) {
      window.$message?.error(`加载模板配置失败: ${configRes.error.message || '未知错误'}`);
    }
    if (aliasRes.error) {
      window.$message?.error(`加载部位别名映射失败: ${aliasRes.error.message || '未知错误'}`);
    }
    if (standardsWithCatRes.error) {
      window.$message?.error(`加载门店部位标准失败: ${standardsWithCatRes.error.message || '未知错误'}`);
    }

    templateConfig.value = configRes.data || null;
    const rawAliasMap = (aliasRes.data || {}) as Record<string, any>;
    aliasMapData.value = Object.entries(rawAliasMap).reduce(
      (acc, [key, value]) => {
        if (Array.isArray(value)) acc[key] = value.filter((v): v is string => typeof v === 'string');
        else if (typeof value === 'string' && value) acc[key] = [value];
        return acc;
      },
      {} as Record<string, string[]>
    );
    const rawStandards = (standardsWithCatRes.data || []) as any[];
    if (!standardsWithCatRes.error && rawStandards.length === 0) {
      window.$message?.warning('该门店未配置标准模板或模板下没有部位，请先配置门店标准模板');
    }
    shopCategoryStandards.value = rawStandards.map((s: any) => ({
      id: s.categoryId || s.category?.id || '',
      name: s.alias || s.category?.name || '',
      alias: s.alias || '',
      paintCount: Number(s.coefficient) || 0,
      newPartAddition: Number(s.newPartAddition) || 0
    }));

    // 自动按名称匹配填充部位映射（仅在用户没有手动配置过时）
    autoFillAliasMap();
  } catch (e: any) {
    window.$message?.error(e.message || '加载配置失败');
  } finally {
    loading.value = false;
  }
}

function triggerTemplateDetect() {
  templateFileInputRef.value?.click();
}

async function handleTemplateDetectFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  loading.value = true;
  const { data, error } = await detectExcelTemplate(file, props.shopId);
  loading.value = false;
  if (error) return;
  if (data) {
    templateConfig.value = data;
    window.$message?.success(`自动识别成功，检测到 ${data.items?.length || 0} 个项目列`);

    // 应用后端返回的建议别名映射（如 前头盖 -> 机盖）
    if (data.suggestedAliasMap) {
      for (const [key, ids] of Object.entries(data.suggestedAliasMap)) {
        if (Array.isArray(ids) && ids.length > 0) {
          aliasMapData.value[key] = ids.filter((id): id is string => typeof id === 'string');
        }
      }
    }

    // 如果当前已在映射步骤，继续按名称精确匹配兜底
    if (step.value === 2) {
      autoFillAliasMap();
    }
  }
}

function goToAliasMapStep() {
  if (!templateConfig.value) {
    window.$message?.warning('请先上传或配置Excel模板');
    return;
  }
  // 进入第二步时再次触发自动匹配（兼容先上传/修改模板后再进入映射步骤）
  autoFillAliasMap();
  step.value = 2;
}

function goBackToTemplateStep() {
  step.value = 1;
}

function addItem() {
  if (!templateConfig.value) return;
  if (!Array.isArray(templateConfig.value.items)) templateConfig.value.items = [];
  templateConfig.value.items.push({ col: '', categoryName: '' });
}

function removeItem(idx: number) {
  const items = templateConfig.value?.items;
  if (!items || idx < 0 || idx >= items.length) return;
  const removed = items[idx];
  items.splice(idx, 1);
  // 同步清理该列在部位映射中的残留配置
  if (removed?.categoryName && aliasMapData.value[removed.categoryName]) {
    delete aliasMapData.value[removed.categoryName];
  }
}

function moveItem(idx: number, dir: -1 | 1) {
  const items = templateConfig.value?.items;
  if (!items) return;
  const target = idx + dir;
  if (target < 0 || target >= items.length) return;
  const tmp = items[idx];
  items[idx] = items[target];
  items[target] = tmp;
}

async function handleSave() {
  if (!templateConfig.value) return;
  saving.value = true;
  try {
    await saveExcelTemplateAndAliasMap(props.shopId, templateConfig.value, aliasMapData.value);
    window.$message?.success('门店Excel配置保存成功');
    emit('update:show', false);
  } catch (e: any) {
    window.$message?.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function handleUpdateShow(value: boolean) {
  if (value) {
    step.value = 1;
    // 确保 props.shopId 已经由父组件同步更新后再发起请求
    nextTick(() => loadConfig());
  }
  emit('update:show', value);
}

// 父组件在不关闭弹窗的情况下切换门店时，主动重新加载配置
watch(
  () => props.shopId,
  (newId, oldId) => {
    if (props.show && newId && newId !== oldId) {
      step.value = 1;
      loadConfig();
    }
  }
);
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="`${shopName || '门店'} · Excel配置`"
    style="width: 760px; max-height: 90vh"
    :mask-closable="false"
    :content-style="{ padding: 0 }"
    @update:show="handleUpdateShow"
  >
    <div class="excel-config-body">
      <NSteps :current="step" size="small" class="mb-16px">
        <NStep title="模板结构" description="识别/调整Excel列" />
        <NStep title="部位映射" description="映射到系统部位" />
      </NSteps>

      <NSpin :show="loading" class="excel-config-spin">
        <div class="excel-config-scroll">
          <template v-if="step === 1">
            <NAlert type="info" :bordered="false" class="mb-12px">
              每家门店的台账格式可能不同。上传该门店的Excel文件，系统会自动识别列映射关系。也可以手动调整后进入下一步。
            </NAlert>
            <NSpace class="mb-12px">
              <NButton type="primary" :loading="loading" @click="triggerTemplateDetect">上传Excel自动识别</NButton>
              <input
                ref="templateFileInputRef"
                type="file"
                accept=".xlsx,.xls"
                style="display: none"
                @change="handleTemplateDetectFile"
              />
            </NSpace>

            <template v-if="templateConfig">
              <NText strong class="mb-8px" style="display: block">基本字段列映射</NText>
              <NGrid :cols="3" :x-gap="8" :y-gap="8" class="mb-12px">
                <NGridItem
                  v-for="(label, key) in {
                    date: '日期',
                    carModel: '车型',
                    plateNumber: '车牌',
                    orderNo: '工单号',
                    paintCount: '副数',
                    remark: '备注'
                  }"
                  :key="key"
                >
                  <NInput v-model:value="templateConfig.fields[key]" size="small">
                    <template #prefix>
                      <NText depth="3" style="font-size: 12px">{{ label }}</NText>
                    </template>
                  </NInput>
                </NGridItem>
              </NGrid>

              <div class="mb-8px flex items-center justify-between">
                <NText strong>喷漆项目列映射 ({{ templateConfig.items?.length || 0 }}项)</NText>
                <NButton size="tiny" type="primary" secondary @click="addItem">+ 添加项目列</NButton>
              </div>
              <NSpace vertical :size="6" class="excel-item-list mb-12px">
                <div v-for="(item, idx) in templateConfig.items" :key="idx" class="excel-item-row">
                  <NInputGroup>
                    <NInput v-model:value="item.col" size="small" style="width: 54px" placeholder="列" />
                    <NInput v-model:value="item.categoryName" size="small" placeholder="项目名（系统部位名或别名）" />
                  </NInputGroup>
                  <NSpace :size="4" class="excel-item-actions">
                    <NButton size="tiny" tertiary :disabled="idx === 0" title="上移" @click="moveItem(idx, -1)">
                      ↑
                    </NButton>
                    <NButton
                      size="tiny"
                      tertiary
                      :disabled="idx === templateConfig.items.length - 1"
                      title="下移"
                      @click="moveItem(idx, 1)"
                    >
                      ↓
                    </NButton>
                    <NButton size="tiny" tertiary type="error" title="删除" @click="removeItem(idx)">删</NButton>
                  </NSpace>
                </div>
                <NEmpty
                  v-if="!templateConfig.items || templateConfig.items.length === 0"
                  description="暂无项目列，点击上方按钮添加"
                />
              </NSpace>

              <NText depth="3" style="font-size: 12px">
                数据起始行: {{ templateConfig.dataStartRow }} | 表头行: {{ templateConfig.headerRow }}
              </NText>
            </template>
            <NEmpty v-else description="暂无配置，请上传Excel文件自动识别" />
          </template>

          <template v-if="step === 2">
            <NSpace vertical :size="16">
              <NAlert type="info" :bordered="false">
                当门店导出模板中的部位名称与系统实际部位不一致时，可在此处建立映射关系。同系数的部位会标 ⭐ 提示。
              </NAlert>
              <NAlert
                v-if="!loading && shopCategoryStandards.length === 0"
                type="warning"
                :bordered="false"
                title="未获取到门店系统部位"
              >
                该门店尚未关联标准模板或模板下没有配置部位，请先到【门店管理】为门店选择标准模板并配置部位标准。
              </NAlert>
              <NForm label-placement="left" label-width="140px" class="alias-map-form">
                <NFormItem v-for="(item, idx) in templateCategories" :key="idx" :label="item.categoryName">
                  <NSelect
                    v-model:value="aliasMapData[item.categoryName]"
                    :options="getCategoryOptions(item.categoryName)"
                    multiple
                    clearable
                    placeholder="请选择对应的系统部位"
                    style="width: 100%"
                  />
                  <NText
                    v-if="
                      !loading && shopCategoryStandards.length > 0 && getCategoryOptions(item.categoryName).length === 0
                    "
                    depth="3"
                    style="font-size: 12px; color: #f0a020"
                  >
                    所有系统部位已被其他列映射
                  </NText>
                </NFormItem>
                <NEmpty v-if="templateCategories.length === 0" description="暂无模板部位配置" />
              </NForm>
            </NSpace>
          </template>
        </div>
      </NSpin>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="handleUpdateShow(false)">取消</NButton>
        <NButton v-if="step === 2" @click="goBackToTemplateStep">上一步</NButton>
        <NButton v-if="step === 1" type="primary" :disabled="!templateConfig" @click="goToAliasMapStep">下一步</NButton>
        <NButton v-if="step === 2" type="primary" :loading="saving" @click="handleSave">保存配置</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.excel-config-body {
  display: flex;
  flex-direction: column;
  max-height: calc(90vh - 130px);
  padding: 16px 20px 0;
}

.excel-config-spin {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.excel-config-spin :deep(.n-spin-content) {
  height: 100%;
}

.excel-config-scroll {
  max-height: calc(90vh - 220px);
  overflow-y: auto;
  padding-right: 4px;
  padding-bottom: 16px;
}

.alias-map-form :deep(.n-form-item-label) {
  word-break: break-all;
  white-space: normal;
  line-height: 1.4;
}

.alias-map-form :deep(.n-form-item-label__text) {
  overflow-wrap: break-word;
}

.excel-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.excel-item-row .n-input-group {
  flex: 1;
  min-width: 0;
}

.excel-item-actions {
  flex-shrink: 0;
}
</style>
