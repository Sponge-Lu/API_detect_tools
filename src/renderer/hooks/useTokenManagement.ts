/**
 * 输入: SiteConfig (站点配置), IPC 调用, Toast 通知
 * 输出: Token 操作方法 (getToken, saveToken, deleteToken, refreshToken)
 * 定位: 业务逻辑层 - 管理 Token 生命周期和认证
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * 令牌管理 Hook
 * 从 App.tsx 抽离的 API Token 相关功能
 */

import Logger from '../utils/logger';
import { toast } from '../store/toastStore';
import type { SiteConfig, DetectionResult } from '../../shared/types/site';

// 额度换算系数（与后端保持一致：1 美元 = 500000 内部单位）
const QUOTA_CONVERSION_FACTOR = 500000;

export interface NewApiTokenForm {
  name: string;
  group: string;
  unlimitedQuota: boolean;
  quota: string;
  expiredTime: string;
}

export interface TokenOperationContext {
  cardKey?: string;
  accountId?: string;
  accessToken?: string;
  userId?: string;
}

interface UseTokenManagementOptions {
  results: DetectionResult[];
  setResults: (results: DetectionResult[]) => void;
  setApiKeys: (siteName: string, keys: any[]) => void;
  showDialog: (options: any) => Promise<boolean>;
  showAlert: (
    message: string,
    type: 'success' | 'error' | 'alert' | 'warning',
    title?: string
  ) => void;
}

export function useTokenManagement({
  results,
  setResults,
  setApiKeys,
  showDialog,
  showAlert,
}: UseTokenManagementOptions) {
  const getStoreKey = (site: SiteConfig, context?: TokenOperationContext) =>
    context?.cardKey || (context?.accountId ? `${site.name}::${context.accountId}` : site.name);

  const updateScopedResults = (
    site: SiteConfig,
    tokens: any[],
    context?: TokenOperationContext
  ) => {
    const nextResults = results.map(result => {
      if (result.name !== site.name) {
        return result;
      }

      if (context?.accountId) {
        return result.accountId === context.accountId ? { ...result, apiKeys: tokens } : result;
      }

      return result.accountId ? result : { ...result, apiKeys: tokens };
    });

    setResults(nextResults);
  };

  /**
   * 刷新指定站点的 API Key 列表
   */
  const refreshSiteApiKeys = async (
    site: SiteConfig,
    context?: TokenOperationContext
  ): Promise<any[]> => {
    const accessToken = context?.accessToken ?? site.system_token;
    const userId = context?.userId ?? site.user_id;
    if (!accessToken || !userId) {
      Logger.warn('⚠️ [useTokenManagement] 当前站点未配置系统 Token 或用户 ID');
      return [];
    }

    const userIdNum = parseInt(userId || '0', 10);
    if (!userIdNum) {
      Logger.warn('⚠️ [useTokenManagement] 当前站点用户 ID 无效');
      return [];
    }

    try {
      const resp = await window.electronAPI.token?.fetchApiTokens?.(
        site.url,
        userIdNum,
        accessToken,
        context?.accountId
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      const tokens: any[] = Array.isArray(resp.data) ? resp.data : [];
      const storeKey = getStoreKey(site, context);
      setApiKeys(storeKey, tokens);
      updateScopedResults(site, tokens, context);
      Logger.info(`✅ [useTokenManagement] 已刷新站点 ${site.name} 的 API Key 列表`);
      return tokens;
    } catch (error: any) {
      Logger.error('❌ [useTokenManagement] 刷新 API Key 列表失败:', error);
      return [];
    }
  };

  /**
   * 创建 API Key
   */
  const handleCreateTokenSubmit = async (
    site: SiteConfig,
    form: NewApiTokenForm,
    setCreatingToken: (v: boolean) => void,
    closeDialog: () => void,
    context?: TokenOperationContext
  ) => {
    const accessToken = context?.accessToken ?? site.system_token;
    const userId = context?.userId ?? site.user_id;
    if (!accessToken || !userId) {
      toast.warning('当前站点未配置系统 Token 或用户 ID');
      return;
    }

    const name = form.name.trim();
    if (!name) {
      toast.warning('请填写令牌名称');
      return;
    }

    let remainQuota = 0;
    if (form.unlimitedQuota) {
      remainQuota = 0;
    } else {
      const quotaNumber = parseFloat(form.quota);
      if (isNaN(quotaNumber) || quotaNumber <= 0) {
        toast.warning('请输入大于 0 的额度（单位：美元）');
        return;
      }
      remainQuota = Math.floor(quotaNumber * QUOTA_CONVERSION_FACTOR);
    }

    let expiredTime = -1;
    if (form.expiredTime) {
      const dt = new Date(form.expiredTime);
      if (isNaN(dt.getTime())) {
        toast.warning('请输入有效的过期时间');
        return;
      }
      if (dt.getTime() <= Date.now()) {
        toast.warning('过期时间必须晚于当前时间');
        return;
      }
      expiredTime = Math.floor(dt.getTime() / 1000);
    }

    const tokenPayload = {
      name,
      remain_quota: remainQuota,
      expired_time: expiredTime,
      unlimited_quota: form.unlimitedQuota,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: form.group || 'default',
    };

    try {
      setCreatingToken(true);
      const userIdNum = parseInt(userId || '0', 10);
      if (!userIdNum) {
        toast.error('当前站点用户 ID 无效');
        return;
      }

      const resp = await window.electronAPI.token?.createApiToken?.(
        site.url,
        userIdNum,
        accessToken,
        tokenPayload,
        context?.accountId
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      if (resp.data && Array.isArray(resp.data)) {
        const storeKey = getStoreKey(site, context);
        setApiKeys(storeKey, resp.data);
        updateScopedResults(site, resp.data, context);
      } else {
        await refreshSiteApiKeys(site, context);
      }

      toast.success('API Key 创建成功');
      closeDialog();
    } catch (error: any) {
      Logger.error('❌ [useTokenManagement] 创建 API Key 失败:', error);
      toast.error(`创建 API Key 失败: ${error.message || error}`);
    } finally {
      setCreatingToken(false);
    }
  };

  /**
   * 删除 API Key
   */
  const handleDeleteToken = async (
    site: SiteConfig,
    token: any,
    tokenIndex: number,
    setDeletingTokenKey: (key: string | null) => void,
    context?: TokenOperationContext
  ) => {
    const accessToken = context?.accessToken ?? site.system_token;
    const userId = context?.userId ?? site.user_id;
    if (!accessToken || !userId) {
      showAlert('当前站点未配置系统 Token 或用户 ID', 'error');
      return;
    }

    const displayName = token.name || `Key #${tokenIndex + 1}`;
    const confirmed = await showDialog({
      type: 'warning',
      title: '删除 API Key',
      message: `确认要删除 API Key「${displayName}」吗？\n此操作不可恢复，请谨慎操作。`,
      confirmText: '删除',
    });
    if (!confirmed) return;

    const userIdNum = parseInt(userId || '0', 10);
    if (!userIdNum) {
      showAlert('当前站点用户 ID 无效', 'error');
      return;
    }

    const storeKey = getStoreKey(site, context);
    const deletingKeyId = `${storeKey}_${token.id ?? token.key ?? tokenIndex}`;
    setDeletingTokenKey(deletingKeyId);

    try {
      const resp = await window.electronAPI.token?.deleteApiToken?.(
        site.url,
        userIdNum,
        accessToken,
        {
          id: token.id ?? token.token_id ?? undefined,
          key: token.key ?? token.token ?? undefined,
        },
        context?.accountId
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      if (resp.data && Array.isArray(resp.data)) {
        setApiKeys(storeKey, resp.data);
        updateScopedResults(site, resp.data, context);
      } else {
        await refreshSiteApiKeys(site, context);
      }
      showAlert(`API Key「${displayName}」已删除`, 'success');
    } catch (error: any) {
      Logger.error('❌ [useTokenManagement] 删除 API Key 失败:', error);
      showAlert(`删除 API Key 失败: ${error.message || error}`, 'error');
    } finally {
      setDeletingTokenKey(null);
    }
  };

  return {
    refreshSiteApiKeys,
    handleCreateTokenSubmit,
    handleDeleteToken,
  };
}
