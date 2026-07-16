<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  NModal, NSpace, NSteps, NStep, NSpin, NAlert, NButton, NInput, NInputGroup,
  NGrid, NGridItem, NText, NForm, NFormItem, NSelect, NEmpty
} from 'naive-ui';
import {
  getExcelTemplateConfig,
  fetchCategoryAliasMap,
  fetchShopCategoriesWithStandard,
  detectExcelTemplate,
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
const shopCategoryStandards = ref<{ id: string; name: string; alias: string; paintCount: number; newPartAddition: number }[]>([]);
const templateFileInputRef = ref<HTMLInputElement | null>(null);

const templateCategories = computed(() => templateConfig.value?.items || []);

function getCategoryOptions(templateName: string) {
  const templateStd = shopCategoryStandards.value.find(
    s => s.name === templateName || s.alias === templateName
  );
  const templateCoefficient = templateStd?.paintCount;
  const currentValues = aliasMapData.value[templateName] || [];

  const selectedOtherIds = Object.entries(aliasMapData.value)
    .filter(([name, ids]) => name !== templateName && Array.isArray(ids))
    .flatMap(([, ids]) => ids);

  const sameCoefficientCategories = templateCoefficient !== undefined
    ? shopCategoryStandards.value.filter(s => Math.abs(s.paintCount - templateCoefficient) < 0.001)
    : [];

  return shopCategoryStandards.value
    .filter(c => !selectedOtherIds.includes(c.id) || currentValues.includes(c.id))
    .map(c => {
      const label = `${c.name} (${(Number(c.paintCount) || 0).toFixed(1)}幅)`;
      const isSameCoeff = sameCoefficientCategories.some(s => s.id === c.id);
      return {
        label: isSameCoeff ? `⭐ ${label}` : label,
        value: c.id
      };
    });
}

async function loadConfig() {
  loading.value = true;
  try {
    const [configRes, aliasRes, standardsWithCatRes] = await Promise.all([
      getExcelTemplateConfig(props.shopId),
      fetchCategoryAliasMap(props.shopId),
      fetchShopCategoriesWithStandard(props.shopId)
    ]);
    templateConfig.value = configRes.data || null;
    const rawAliasMap = (aliasRes.data || {}) as Record<string, any>;
    aliasMapData.value = Object.entries(rawAliasMap).reduce((acc, [key, value]) => {
      if (Array.isArray(value)) acc[key] = value.filter((v): v is string => typeof v === 'string');
      else if (typeof value === 'string' && value) acc[key] = [value];
      return acc;
    }, {} as Record<string, string[]>);
    shopCategoryStandards.value = ((standardsWithCatRes.data || []) as any[]).map((s: any) => ({
      id: s.categoryId || s.category?.id || '',
      name: s.alias || s.category?.name || '',
      alias: s.alias || '',
      paintCount: Number(s.coefficient) || 0,
      newPartAddition: Number(s.newPartAddition) || 0
    }));
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
  }
}

function goToAliasMapStep() {
  if (!templateConfig.value) {
    window.$message?.warning('请先上传或配置Excel模板');
    return;
  }
  step.value = 2;
}

function goBackToTemplateStep() {
  step.value = 1;
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
    loadConfig();
  }
  emit('update:show', value);
}
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
              <NButton type="primary" :loading="loading" @click="triggerTemplateDetect">
                上传Excel自动识别
              </NButton>
              <input ref="templateFileInputRef" type="file" accept=".xlsx,.xls" style="display:none" @change="handleTemplateDetectFile" />
            </NSpace>

            <template v-if="templateConfig">
              <NText strong class="mb-8px" style="display:block">基本字段列映射</NText>
              <NGrid :cols="3" :x-gap="8" :y-gap="8" class="mb-12px">
                <NGridItem v-for="(label, key) in { date: '日期', carModel: '车型', plateNumber: '车牌', orderNo: '工单号', paintCount: '副数', remark: '备注' }" :key="key">
                  <NInput v-model:value="templateConfig.fields[key]" size="small">
                    <template #prefix><NText depth="3" style="font-size:12px">{{ label }}</NText></template>
                  </NInput>
                </NGridItem>
              </NGrid>

              <NText strong class="mb-8px" style="display:block">喷漆项目列映射 ({{ templateConfig.items?.length || 0 }}项)</NText>
              <NGrid :cols="4" :x-gap="8" :y-gap="8" class="mb-12px">
                <NGridItem v-for="(item, idx) in templateConfig.items" :key="idx">
                  <NInputGroup>
                    <NInput v-model:value="item.col" size="small" style="width:50px" placeholder="列" />
                    <NInput v-model:value="item.categoryName" size="small" placeholder="项目名" />
                  </NInputGroup>
                </NGridItem>
              </NGrid>

              <NText depth="3" style="font-size:12px">数据起始行: {{ templateConfig.dataStartRow }} | 表头行: {{ templateConfig.headerRow }}</NText>
            </template>
            <NEmpty v-else description="暂无配置，请上传Excel文件自动识别" />
          </template>

          <template v-if="step === 2">
            <NSpace vertical :size="16">
              <NAlert type="info" :bordered="false">
                当门店导出模板中的部位名称与系统实际部位不一致时，可在此处建立映射关系。同系数的部位会标 ⭐ 提示。
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
</style>
