<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { loginModuleRecord } from '@/constants/app';
import { useAuthStore } from '@/store/modules/auth';
import { useRouterPush } from '@/hooks/common/router';
import { useFormRules, useNaiveForm } from '@/hooks/common/form';
import { $t } from '@/locales';

defineOptions({
  name: 'PwdLogin'
});

const authStore = useAuthStore();
const { toggleLoginModule } = useRouterPush();
const { formRef, validate } = useNaiveForm();

interface FormModel {
  identifier: string;
  password: string;
}

const model: FormModel = reactive({
  identifier: 'Soybean',
  password: '123456'
});

// 记住密码：勾选后在本地保存账号与密码，下次进入自动回填
const rememberPwd = ref(false);
const CREDENTIAL_KEY = 'paint-admin-login-credential';

// 轻量可逆加密：XOR 混淆后再 base64，避免密码以明文存于 localStorage
const PWD_SECRET = 'paint-count-admin@2026';

function encryptPwd(pwd: string): string {
  if (!pwd) return '';
  let out = '';
  for (let i = 0; i < pwd.length; i++) {
    out += String.fromCharCode(pwd.charCodeAt(i) ^ PWD_SECRET.charCodeAt(i % PWD_SECRET.length));
  }
  const bytes = new TextEncoder().encode(out);
  let bin = '';
  bytes.forEach(b => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function decryptPwd(cipher: string): string {
  const bin = atob(cipher);
  const out = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  let text = '';
  for (let i = 0; i < out.length; i++) {
    text += String.fromCharCode(out.charCodeAt(i) ^ PWD_SECRET.charCodeAt(i % PWD_SECRET.length));
  }
  return text;
}

function safeDecrypt(cipher: string): string {
  try {
    return decryptPwd(cipher);
  } catch {
    return cipher; // 兼容未加密的旧数据
  }
}

function loadCredential() {
  try {
    const raw = localStorage.getItem(CREDENTIAL_KEY);
    if (raw) {
      const cred = JSON.parse(raw) as Record<string, string>;
      model.identifier = cred.identifier ?? model.identifier;
      if (cred.password) {
        model.password = safeDecrypt(cred.password);
      }
      rememberPwd.value = true;
    }
  } catch {}
}

function saveCredential() {
  if (rememberPwd.value) {
    localStorage.setItem(
      CREDENTIAL_KEY,
      JSON.stringify({ identifier: model.identifier, password: encryptPwd(model.password) })
    );
  } else {
    localStorage.removeItem(CREDENTIAL_KEY);
  }
}

onMounted(loadCredential);

const rules = computed<Record<keyof FormModel, App.Global.FormRule[]>>(() => {
  // inside computed to make locale reactive, if not apply i18n, you can define it without computed
  const { formRules } = useFormRules();

  return {
    identifier: formRules.userName,
    password: formRules.pwd
  };
});

async function handleSubmit() {
  await validate();
  await authStore.login(model.identifier, model.password);
  saveCredential();
}

type AccountKey = 'super' | 'admin' | 'user';

interface Account {
  key: AccountKey;
  label: string;
  identifier: string;
  password: string;
}

const accounts = computed<Account[]>(() => [
  {
    key: 'super',
    label: $t('page.login.pwdLogin.superAdmin'),
    identifier: 'Soybean',
    password: '123456'
  },
  {
    key: 'admin',
    label: $t('page.login.pwdLogin.admin'),
    identifier: 'Administrator',
    password: '123456'
  },
  {
    key: 'user',
    label: $t('page.login.pwdLogin.user'),
    identifier: 'GeneralUser',
    password: '123456'
  }
]);

async function handleAccountLogin(account: Account) {
  await authStore.login(account.identifier, account.password);
}
</script>

<template>
  <NForm ref="formRef" :model="model" :rules="rules" size="large" :show-label="false" @keyup.enter="handleSubmit">
    <NFormItem path="identifier">
      <NInput v-model:value="model.identifier" :placeholder="$t('page.login.common.userNamePlaceholder')" />
    </NFormItem>
    <NFormItem path="password">
      <NInput
        v-model:value="model.password"
        type="password"
        show-password-on="click"
        :placeholder="$t('page.login.common.passwordPlaceholder')"
      />
    </NFormItem>
    <NSpace vertical :size="24">
      <div class="flex-y-center justify-between">
        <NCheckbox v-model:checked="rememberPwd">{{ $t('page.login.pwdLogin.rememberMe') }}</NCheckbox>
        <NButton quaternary @click="toggleLoginModule('reset-pwd')">
          {{ $t('page.login.pwdLogin.forgetPassword') }}
        </NButton>
      </div>
      <NButton type="primary" size="large" round block :loading="authStore.loginLoading" @click="handleSubmit">
        {{ $t('common.confirm') }}
      </NButton>
      <div class="flex-y-center justify-between gap-12px">
        <NButton class="flex-1" block @click="toggleLoginModule('code-login')">
          {{ $t(loginModuleRecord['code-login']) }}
        </NButton>
        <NButton class="flex-1" block @click="toggleLoginModule('register')">
          {{ $t(loginModuleRecord.register) }}
        </NButton>
      </div>
      <NDivider class="text-14px text-#666 !m-0">{{ $t('page.login.pwdLogin.otherAccountLogin') }}</NDivider>
      <div class="flex-center gap-12px">
        <NButton v-for="item in accounts" :key="item.key" type="primary" @click="handleAccountLogin(item)">
          {{ item.label }}
        </NButton>
      </div>
    </NSpace>
  </NForm>
</template>

<style scoped></style>
