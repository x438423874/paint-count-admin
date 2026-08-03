import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { useLoading } from '@sa/hooks';
import { fetchGetUserInfo, fetchLogin, fetchLogout } from '@/service/api';
import { useRouterPush } from '@/hooks/common/router';
import { localStg } from '@/utils/storage';
import { SetupStoreId } from '@/enum';
import { $t } from '@/locales';
import { useRouteStore } from '../route';
import { useTabStore } from '../tab';
import { clearAuthStorage, getToken } from './shared';

/** Module-level flag to prevent concurrent logout calls */
let isLoggingOut = false;

/** 标记当前是否处于路由守卫初始化流程（首屏 initUserInfo 失败）中。
 *  该场景下由守卫的 !isLogin 分支统一重定向登录页，避免 resetStore 在守卫内
 *  再发起一次 router.push 造成嵌套导航 / "No match" 未捕获异常。 */
let inGuardInit = false;

export function setInGuardInit(value: boolean) {
  inGuardInit = value;
}

export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const routeStore = useRouteStore();
  const tabStore = useTabStore();
  const { toLogin, redirectFromLogin } = useRouterPush(false);
  const { loading: loginLoading, startLoading, endLoading } = useLoading();

  const token = ref(getToken());

  const userInfo: Api.Auth.UserInfo = reactive({
    userId: '',
    userName: '',
    roles: [],
    buttons: []
  });

  /** is super role in static route */
  const isStaticSuper = computed(() => {
    const { VITE_AUTH_ROUTE_MODE, VITE_STATIC_SUPER_ROLE } = import.meta.env;

    return VITE_AUTH_ROUTE_MODE === 'static' && userInfo.roles.includes(VITE_STATIC_SUPER_ROLE);
  });

  /** Is login */
  const isLogin = computed(() => Boolean(token.value));

  /** Reset auth store */
  async function resetStore() {
    const authStore = useAuthStore();

    // 调用后端登出接口吊销 refresh token（仅在仍有 token 时、且避免并发重复调用）
    if (token.value && !isLoggingOut) {
      isLoggingOut = true;
      try {
        await fetchLogout(localStg.get('refreshToken') || '');
      } catch {
        // 后端退出失败不影响前端本地清理
      } finally {
        isLoggingOut = false;
      }
    }

    clearAuthStorage();

    authStore.$reset();

    // 仅在非路由守卫初始化流程中自行跳转登录页；首屏 initUserInfo 失败由守卫的
    // !isLogin 分支统一重定向（避免守卫内嵌套 router.push 造成 "No match" 异常）。
    if (!inGuardInit) {
      toLogin();
    }

    tabStore.cacheTabs();
    routeStore.resetStore();
  }

  /**
   * Login
   *
   * @param identifier User name
   * @param password Password
   * @param [redirect=true] Whether to redirect after login. Default is `true`
   */
  async function login(identifier: string, password: string, redirect = true) {
    startLoading();

    const { data: loginToken, error } = await fetchLogin(identifier, password);

    if (!error) {
      const pass = await loginByToken(loginToken);

      if (pass) {
        await redirectFromLogin(redirect);

        window.$notification?.success({
          title: $t('page.login.common.loginSuccess'),
          content: $t('page.login.common.welcomeBack', { userName: userInfo.userName }),
          duration: 4500
        });
      }
    } else {
      resetStore();
    }

    endLoading();
  }

  async function loginByToken(loginToken: Api.Auth.LoginToken) {
    // 1. stored in the localStorage, the later requests need it in headers
    localStg.set('token', loginToken.token);
    localStg.set('refreshToken', loginToken.refreshToken);

    // 2. get user info
    const pass = await getUserInfo();

    if (pass) {
      token.value = loginToken.token;

      return true;
    }

    return false;
  }

  async function getUserInfo() {
    const { data: info, error } = await fetchGetUserInfo();

    if (!error) {
      // update store
      Object.assign(userInfo, info);

      return true;
    }

    return false;
  }

  async function initUserInfo() {
    const hasToken = getToken();

    if (hasToken) {
      const pass = await getUserInfo();

      if (!pass) {
        resetStore();
      }
    }
  }

  return {
    token,
    userInfo,
    isStaticSuper,
    isLogin,
    loginLoading,
    resetStore,
    login,
    initUserInfo
  };
});
