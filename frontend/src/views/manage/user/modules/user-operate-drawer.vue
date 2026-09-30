<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { enableStatusOptions } from '@/constants/business';
import type { UserModel } from '@/service/api';
import { createUser, updateUser } from '@/service/api';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';

defineOptions({
  name: 'UserOperateDrawer'
});

interface Props {
  /** the type of operation */
  operateType: NaiveUI.TableOperateType;
  /** the edit row data */
  rowData?: Api.SystemManage.User | null;
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
const { defaultRequiredRule } = useFormRules();

const title = computed(() => {
  const titles: Record<NaiveUI.TableOperateType, string> = {
    add: $t('page.manage.user.addUser'),
    edit: $t('page.manage.user.editUser')
  };
  return titles[props.operateType];
});

const model: UserModel = reactive(createDefaultModel());

function createDefaultModel(): UserModel {
  return {
    username: '',
    password: '',
    domain: '',
    realName: '',
    phoneNumber: '',
    email: '',
    status: 'ENABLED'
  };
}

type RuleKey = Extract<keyof UserModel, 'username' | 'password' | 'status'>;

const rules: Record<RuleKey, App.Global.FormRule | App.Global.FormRule[]> = {
  username: [
    { required: true, message: '请输入用户名' },
    { min: 4, message: '用户名长度不能少于 4 个字符' }
  ],
  password: [
    {
      trigger: ['input', 'blur'],
      validator: (_rule, value) => {
        if (props.operateType === 'add' && !value) {
          return new Error('请输入密码');
        }
        if (value && value.length < 6) {
          return new Error('密码长度不能少于 6 个字符');
        }
        return true;
      }
    }
  ],
  status: defaultRequiredRule
};

/** the enabled role options */
// const roleOptions = ref<CommonType.Option<string>[]>([]);
//
// async function getRoleOptions() {
//   const { error, data } = await fetchGetAllRoles();
//
//   if (!error) {
//     const options = data.map(item => ({
//       label: item.roleName,
//       value: item.roleCode
//     }));
//
//     // the mock data does not have the roleCode, so fill it
//     // if the real request, remove the following code
//     const userRoleOptions = model.userRoles.map(item => ({
//       label: item,
//       value: item
//     }));
//     // end
//
//     roleOptions.value = [...userRoleOptions, ...options];
//   }
// }

function handleInitModel() {
  Object.assign(model, createDefaultModel());

  if (props.operateType === 'edit' && props.rowData) {
    const { id, username, realName, domain, phoneNumber, email, status } = props.rowData;
    Object.assign(model, {
      id,
      username,
      realName: realName ?? '',
      domain: domain ?? '',
      phoneNumber: phoneNumber ?? '',
      email: email ?? '',
      status
    });
  }
}

function closeDrawer() {
  visible.value = false;
}

async function handleSubmit() {
  await validate();
  // 空字符串转 null：email/phone 有唯一索引，写空串会与其他空串用户冲突（NULL 不参与唯一比较）
  const payload: UserModel = {
    ...model,
    realName: model.realName?.trim() || null,
    phoneNumber: model.phoneNumber?.trim() || null,
    email: model.email?.trim() || null
  };
  // request
  if (props.operateType === 'add') {
    const { error } = await createUser(payload);
    if (error) return;
    window.$message?.success($t('common.addSuccess'));
  } else {
    const { error } = await updateUser(payload);
    if (error) return;
    window.$message?.success($t('common.updateSuccess'));
  }
  closeDrawer();
  emit('submitted');
}

watch(visible, () => {
  if (visible.value) {
    handleInitModel();
    restoreValidation();
    // getRoleOptions();
  }
});
</script>

<template>
  <NDrawer v-model:show="visible" display-directive="show" :width="360">
    <NDrawerContent :title="title" :native-scrollbar="false" closable>
      <NForm ref="formRef" :model="model" :rules="rules">
        <NFormItem :label="$t('page.manage.user.userName')" path="username">
          <NInput v-model:value="model.username" :placeholder="$t('page.manage.user.form.userName')" />
        </NFormItem>
        <NFormItem
          :label="$t('page.manage.user.password')"
          path="password"
          :rule="rules.password"
        >
          <NInput
            v-model:value="model.password"
            type="password"
            show-password-on="click"
            :placeholder="props.operateType === 'add' ? $t('page.manage.user.form.password') : '留空则不修改密码'"
          />
        </NFormItem>
        <NFormItem v-if="props.operateType === 'add'" :label="$t('page.manage.user.domain')" path="domain">
          <NInput v-model:value="model.domain" :placeholder="$t('page.manage.user.form.domain')" />
        </NFormItem>
        <NFormItem :label="$t('page.manage.user.realName')" path="realName">
          <NInput v-model:value="model.realName" :placeholder="$t('page.manage.user.form.realName')" />
        </NFormItem>
        <NFormItem :label="$t('page.manage.user.userPhone')" path="phoneNumber">
          <NInput v-model:value="model.phoneNumber" :placeholder="$t('page.manage.user.form.userPhone')" />
        </NFormItem>
        <NFormItem :label="$t('page.manage.user.userEmail')" path="email">
          <NInput v-model:value="model.email" :placeholder="$t('page.manage.user.form.userEmail')" />
        </NFormItem>
        <NFormItem :label="$t('page.manage.user.userStatus')" path="status">
          <NRadioGroup v-model:value="model.status">
            <NRadio v-for="item in enableStatusOptions" :key="item.value" :value="item.value" :label="$t(item.label)" />
          </NRadioGroup>
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace :size="16">
          <NButton @click="closeDrawer">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" @click="handleSubmit">{{ $t('common.confirm') }}</NButton>
        </NSpace>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<style scoped></style>
