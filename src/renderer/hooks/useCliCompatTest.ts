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
 * 从 Claude Code 配置文件中解析 API Key 和 Base URL
 */
function parseClaudeCodeConfig(
  editedFiles: Array<{ path: string; content: string }> | null | undefined
): {
  apiKey: string | null;
  baseUrl: string | null;
} {
  if (!editedFiles || editedFiles.length === 0) {
    return { apiKey: null, baseUrl: null };
  }

  // 查找 settings.json 文件
  const settingsFile = editedFiles.find(f => f.path.includes('settings.json'));
  if (!settingsFile) {
    return { apiKey: null, baseUrl: null };
  }

  try {
    const settings = JSON.parse(settingsFile.content);
    const apiKey = settings?.env?.ANTHROPIC_AUTH_TOKEN || null;
    const baseUrl = settings?.env?.ANTHROPIC_BASE_URL || null;
    return { apiKey, baseUrl };
  } catch {
    return { apiKey: null, baseUrl: null };
  }
}

/**
 * 从 Codex 配置文件中解析 API Key 和 Base URL
 */
function parseCodexConfig(
  editedFiles: Array<{ path: string; content: string }> | null | undefined
): {
  apiKey: string | null;
  baseUrl: string | null;
} {
  if (!editedFiles || editedFiles.length === 0) {
    return { apiKey: null, baseUrl: null };
  }

  let apiKey: string | null = null;
  let baseUrl: string | null = null;

  // 查找 auth.json 文件获取 API Key
  const authFile = editedFiles.find(f => f.path.includes('auth.json'));
  if (authFile) {
    try {
      const auth = JSON.parse(authFile.content);
      apiKey = auth?.OPENAI_API_KEY || null;
    } catch {
      // 忽略解析错误
    }
  }

  // 查找 config.toml 文件获取 Base URL
  const configFile = editedFiles.find(f => f.path.includes('config.toml'));
  if (configFile) {
    // 简单解析 TOML 中的 base_url
    const match = configFile.content.match(/base_url\s*=\s*"([^"]+)"/);
    if (match) {
      baseUrl = match[1].replace(/\/v1$/, ''); // 移除 /v1 后缀
    }
  }

  return { apiKey, baseUrl };
}

/**
 * 从 Gemini CLI 配置文件中解析 API Key 和 Base URL
 */
function parseGeminiCliConfig(
  editedFiles: Array<{ path: string; content: string }> | null | undefined
): {
  apiKey: string | null;
  baseUrl: string | null;
} {
  if (!editedFiles || editedFiles.length === 0) {
    return { apiKey: null, baseUrl: null };
  }

  // 查找 .env 文件
  const envFile = editedFiles.find(f => f.path.includes('.env'));
  if (!envFile) {
    return { apiKey: null, baseUrl: null };
  }

  let apiKey: string | null = null;
  let baseUrl: string | null = null;

  // 解析 .env 文件
  const lines = envFile.content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('GEMINI_API_KEY=')) {
      apiKey = trimmed.substring('GEMINI_API_KEY='.length);
    } else if (trimmed.startsWith('GOOGLE_GEMINI_BASE_URL=')) {
      baseUrl = trimmed.substring('GOOGLE_GEMINI_BASE_URL='.length);
    }
  }

  return { apiKey, baseUrl };
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
   * 测试单个站点的 CLI 兼容性（基于配置文件）
   */
  const testSite = useCallback(
    async (siteName: string, siteUrl: string, _apiKeys: any[]) => {
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

      // 检查是否有任何配置且启用
      const cc = cliConfig.claudeCode;
      const cx = cliConfig.codex;
      const gc = cliConfig.geminiCli;

      // 标记为测试中
      addCliTestingSite(siteName);

      try {
        // 构建测试配置
        const testConfigs: Array<{
          cliType: 'claudeCode' | 'codex' | 'geminiCli';
          apiKey: string;
          model: string;
          baseUrl?: string;
        }> = [];

        // Claude Code - 从配置文件中读取 API Key 和 Base URL
        if (cc?.enabled && cc?.testModel) {
          const { apiKey, baseUrl } = parseClaudeCodeConfig(cc.editedFiles);
          if (!apiKey || !baseUrl) {
            toast.warning('Claude Code 配置文件为空，请先生成或编辑配置文件');
          } else {
            testConfigs.push({
              cliType: 'claudeCode',
              apiKey,
              model: cc.testModel,
              baseUrl,
            });
          }
        }

        // Codex - 从配置文件中读取 API Key 和 Base URL
        if (cx?.enabled && cx?.testModel) {
          const { apiKey, baseUrl } = parseCodexConfig(cx.editedFiles);
          if (!apiKey || !baseUrl) {
            toast.warning('Codex 配置文件为空，请先生成或编辑配置文件');
          } else {
            testConfigs.push({
              cliType: 'codex',
              apiKey,
              model: cx.testModel,
              baseUrl,
            });
          }
        }

        // Gemini CLI - 从配置文件中读取 API Key 和 Base URL
        if (gc?.enabled && gc?.testModel) {
          const { apiKey, baseUrl } = parseGeminiCliConfig(gc.editedFiles);
          if (!apiKey || !baseUrl) {
            toast.warning('Gemini CLI 配置文件为空，请先生成或编辑配置文件');
          } else {
            testConfigs.push({
              cliType: 'geminiCli',
              apiKey,
              model: gc.testModel,
              baseUrl,
            });
          }
        }

        if (testConfigs.length === 0) {
          toast.error('没有有效的 CLI 配置，请确保已生成配置文件并选择测试模型');
          return;
        }

        // 调用后端测试，使用配置文件中的 baseUrl
        const response = await (window.electronAPI as any).cliCompat.testWithConfig({
          siteUrl, // 作为备用
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
