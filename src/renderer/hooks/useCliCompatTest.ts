/**
 * CLI 兼容性测试 Hook
 * 封装 CLI 兼容性测试相关的业务逻辑
 */

import { useCallback, useMemo } from 'react';
import {
  useDetectionStore,
  type CliCompatibilityResult,
  type CliConfig,
} from '../store/detectionStore';
import { toast } from '../store/toastStore';

/** Hook 返回类型 */
export interface UseCliCompatTestReturn {
  /** 测试单个站点的 CLI 兼容性（基于配置） */
  testSite: (siteName: string, siteUrl: string, apiKeys: any[]) => Promise<void>;
  /** 检查指定站点是否正在测试中 */
  isTestingSite: (siteName: string) => boolean;
  /** 是否有任何站点正在测试中 */
  isTesting: boolean;
  /** 获取站点的 CLI 兼容性结果 */
  getCompatibility: (siteName: string) => CliCompatibilityResult | undefined;
  /** 获取站点的 CLI 配置 */
  getCliConfig: (siteName: string) => CliConfig | null;
  /** 设置站点的 CLI 配置 */
  setCliConfig: (siteName: string, config: CliConfig) => void;
}

/**
 * CLI 兼容性测试 Hook
 */
export function useCliCompatTest(): UseCliCompatTestReturn {
  const {
    cliCompatibility,
    cliConfigs,
    cliTestingSites,
    setCliCompatibility,
    setCliConfig,
    getCliConfig,
    addCliTestingSite,
    removeCliTestingSite,
    isCliTestingSite,
  } = useDetectionStore();

  // 是否有任何站点正在测试
  const isTesting = useMemo(() => cliTestingSites.size > 0, [cliTestingSites]);

  /**
   * 从 API Keys 中获取指定 ID 的 key
   */
  const findApiKey = (apiKeys: any[], apiKeyId: number): any | null => {
    return apiKeys.find(k => (k.id ?? k.token_id) === apiKeyId) ?? null;
  };

  /**
   * 测试单个站点的 CLI 兼容性（基于配置）
   */
  const testSite = useCallback(
    async (siteName: string, siteUrl: string, apiKeys: any[]) => {
      // 检查是否已在测试中
      if (isCliTestingSite(siteName)) {
        return;
      }

      // 获取 CLI 配置
      const cliConfig = getCliConfig(siteName);
      if (!cliConfig) {
        toast.error(`请先配置 ${siteName} 的 CLI 设置`);
        return;
      }

      // 检查是否有任何配置
      const hasAnyConfig =
        (cliConfig.claudeCode?.apiKeyId && cliConfig.claudeCode?.model) ||
        (cliConfig.codex?.apiKeyId && cliConfig.codex?.model) ||
        (cliConfig.geminiCli?.apiKeyId && cliConfig.geminiCli?.model) ||
        (cliConfig.chat?.apiKeyId && cliConfig.chat?.model);

      if (!hasAnyConfig) {
        toast.error(`请先配置 ${siteName} 的 CLI 设置`);
        return;
      }

      // 标记为测试中
      addCliTestingSite(siteName);

      try {
        // 构建测试配置
        const testConfigs: Array<{
          cliType: 'claudeCode' | 'codex' | 'geminiCli' | 'chat';
          apiKey: string;
          model: string;
        }> = [];

        // Claude Code
        if (cliConfig.claudeCode?.apiKeyId && cliConfig.claudeCode?.model) {
          const apiKey = findApiKey(apiKeys, cliConfig.claudeCode.apiKeyId);
          if (apiKey) {
            testConfigs.push({
              cliType: 'claudeCode',
              apiKey: apiKey.key || apiKey.token || '',
              model: cliConfig.claudeCode.model,
            });
          }
        }

        // Codex
        if (cliConfig.codex?.apiKeyId && cliConfig.codex?.model) {
          const apiKey = findApiKey(apiKeys, cliConfig.codex.apiKeyId);
          if (apiKey) {
            testConfigs.push({
              cliType: 'codex',
              apiKey: apiKey.key || apiKey.token || '',
              model: cliConfig.codex.model,
            });
          }
        }

        // Gemini CLI
        if (cliConfig.geminiCli?.apiKeyId && cliConfig.geminiCli?.model) {
          const apiKey = findApiKey(apiKeys, cliConfig.geminiCli.apiKeyId);
          if (apiKey) {
            testConfigs.push({
              cliType: 'geminiCli',
              apiKey: apiKey.key || apiKey.token || '',
              model: cliConfig.geminiCli.model,
            });
          }
        }

        // Chat
        if (cliConfig.chat?.apiKeyId && cliConfig.chat?.model) {
          const apiKey = findApiKey(apiKeys, cliConfig.chat.apiKeyId);
          if (apiKey) {
            testConfigs.push({
              cliType: 'chat',
              apiKey: apiKey.key || apiKey.token || '',
              model: cliConfig.chat.model,
            });
          }
        }

        if (testConfigs.length === 0) {
          toast.error('没有有效的 CLI 配置');
          return;
        }

        // 调用后端测试
        const response = await (window.electronAPI as any).cliCompat.testWithConfig({
          siteUrl,
          configs: testConfigs,
        });

        // 处理 IPC 返回格式
        if (!response.success) {
          throw new Error(response.error || '测试失败');
        }

        const result: CliCompatibilityResult = {
          claudeCode: response.data.claudeCode ?? null,
          codex: response.data.codex ?? null,
          geminiCli: response.data.geminiCli ?? null,
          chat: response.data.chat ?? null,
          testedAt: Date.now(),
        };

        setCliCompatibility(siteName, result);

        // 保存结果到缓存
        try {
          await (window.electronAPI as any).cliCompat.saveResult(siteUrl, result);
        } catch {
          // 忽略保存错误
        }

        toast.success(`${siteName} CLI 兼容性测试完成`);
      } catch (error: any) {
        toast.error(`${siteName} CLI 兼容性测试失败: ${error.message}`);

        // 设置错误结果
        setCliCompatibility(siteName, {
          claudeCode: null,
          codex: null,
          geminiCli: null,
          chat: null,
          testedAt: Date.now(),
          error: error.message,
        });
      } finally {
        removeCliTestingSite(siteName);
      }
    },
    [isCliTestingSite, getCliConfig, addCliTestingSite, removeCliTestingSite, setCliCompatibility]
  );

  /**
   * 获取站点的 CLI 兼容性结果
   */
  const getCompatibility = useCallback(
    (siteName: string) => cliCompatibility[siteName],
    [cliCompatibility]
  );

  /**
   * 获取站点的 CLI 配置
   */
  const getCliConfigCallback = useCallback(
    (siteName: string) => cliConfigs[siteName] ?? null,
    [cliConfigs]
  );

  return {
    testSite,
    isTestingSite: isCliTestingSite,
    isTesting,
    getCompatibility,
    getCliConfig: getCliConfigCallback,
    setCliConfig,
  };
}
