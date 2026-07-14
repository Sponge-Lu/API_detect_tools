/**
 * 输入: DetectionStore (检测状态), IPC 调用, Toast 通知
 * 输出: 测试方法 (testSite), 兼容性结果, 自动更新配置和 Toast 提示
 * 定位: 业务逻辑层 - CLI 兼容性测试 Hook，封装测试逻辑、持久化回写与探测视图同步
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * CLI 兼容性测试 Hook
 * 封装 CLI 兼容性测试相关的业务逻辑
 * 测试完成后自动更新 Codex 配置文件中的 wire_api 值（固定为 responses）
 */

import { useCallback, useMemo } from 'react';
import {
  useDetectionStore,
  type CliCompatibilityResult,
  type CliConfig,
} from '../store/detectionStore';
import { toast } from '../store/toastStore';
import { sessionEventLog } from '../services/sessionEventLog';
import {
  normalizeCliTargetProtocol,
  normalizeCliTestModels,
  type CliTargetProtocol,
} from '../../shared/types/cli-config';
import { persistCliCompatibilityResult } from '../services/cli-compat-sync';

/** Hook 返回类型 */
export interface UseCliCompatTestReturn {
  /** 测试单个站点的 CLI 兼容性（基于配置） */
  testSite: (
    storeKey: string,
    siteLabel: string,
    siteUrl: string,
    apiKeys: any[],
    accountId?: string
  ) => Promise<void>;
  /** 检查指定卡片是否正在测试中 */
  isTestingSite: (storeKey: string) => boolean;
  /** 是否有任何站点正在测试中 */
  isTesting: boolean;
  /** 获取卡片的 CLI 兼容性结果 */
  getCompatibility: (storeKey: string) => CliCompatibilityResult | undefined;
  /** 获取卡片的 CLI 配置 */
  getCliConfig: (storeKey: string) => CliConfig | null;
  /** 设置卡片的 CLI 配置 */
  setCliConfig: (storeKey: string, config: CliConfig) => void;
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

function stripJsonCommentsAndTrailingCommas(content: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < content.length && content[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output.replace(/,\s*([}\]])/g, '$1');
}

function parseJsonLikeObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    try {
      const parsed = JSON.parse(stripJsonCommentsAndTrailingCommas(content));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimBaseUrlVersionSuffix(baseUrl: string | null): string | null {
  return baseUrl?.replace(/\/v1\/?$/, '').replace(/\/+$/, '') || null;
}

/**
 * 从 OpenCode 官方 opencode.json/auth.json 中解析 API Key 和 Base URL
 */
function parseOpenCodeConfig(
  editedFiles: Array<{ path: string; content: string }> | null | undefined
): {
  apiKey: string | null;
  baseUrl: string | null;
} {
  if (!editedFiles || editedFiles.length === 0) {
    return { apiKey: null, baseUrl: null };
  }

  const configFile = editedFiles.find(f => f.path.includes('opencode.json'));
  const authFile = editedFiles.find(
    f => f.path.includes('auth.json') && f.path.toLowerCase().includes('opencode')
  );
  const config = configFile ? parseJsonLikeObject(configFile.content) : null;
  const auth = authFile ? parseJsonLikeObject(authFile.content) : null;
  const model = typeof config?.model === 'string' ? config.model : '';
  const provider = asRecord(config?.provider);
  const providerId =
    model.includes('/') && model.split('/')[0]
      ? model.split('/')[0]
      : Object.keys(provider || {})[0] || null;
  const providerConfig = providerId ? asRecord(provider?.[providerId]) : null;
  const providerOptions = asRecord(providerConfig?.options);
  const authProvider = providerId ? asRecord(auth?.[providerId]) : null;
  const fallbackAuthProvider = Object.values(auth || {})
    .map(asRecord)
    .find(item => item?.type === 'api' && typeof item.key === 'string');
  const baseUrl =
    typeof providerOptions?.baseURL === 'string'
      ? trimBaseUrlVersionSuffix(providerOptions.baseURL)
      : null;
  const apiKey =
    typeof authProvider?.key === 'string'
      ? authProvider.key
      : typeof fallbackAuthProvider?.key === 'string'
        ? fallbackAuthProvider.key
        : typeof providerOptions?.apiKey === 'string'
          ? providerOptions.apiKey
          : null;

  return { apiKey, baseUrl };
}

function normalizeComparableUrl(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/:80(\/|$)/, '$1')
    .replace(/:443(\/|$)/, '$1')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

function maybeWarnPreviewBaseUrlMismatch(
  cliLabel: string,
  previewBaseUrl: string | null,
  siteUrl: string,
  warnedKeys: Set<string>
): void {
  const normalizedPreviewUrl = normalizeComparableUrl(previewBaseUrl);
  const normalizedSiteUrl = normalizeComparableUrl(siteUrl);
  if (!normalizedPreviewUrl || !normalizedSiteUrl || normalizedPreviewUrl === normalizedSiteUrl) {
    return;
  }

  const warningKey = `${cliLabel}:${normalizedPreviewUrl}->${normalizedSiteUrl}`;
  if (warnedKeys.has(warningKey)) {
    return;
  }

  warnedKeys.add(warningKey);
  const displayPreviewBaseUrl = (previewBaseUrl ?? '').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  toast.warning(
    `${cliLabel} 预览配置中的站点域名（${displayPreviewBaseUrl}）与当前站点（${siteUrl.replace(/\/+$/, '')}）不一致，站点页测试将优先使用当前站点 URL`
  );
}

/**
 * 从 editedFiles 解析凭据，若为空则从 apiKeyId + siteUrl 回退生成
 */
function resolveCliCredentials(
  editedFiles: Array<{ path: string; content: string }> | null | undefined,
  parseFn: (files: Array<{ path: string; content: string }> | null | undefined) => {
    apiKey: string | null;
    baseUrl: string | null;
  },
  apiKeyId: number | null,
  apiKeys: any[],
  siteUrl: string
): {
  apiKey: string | null;
  baseUrl: string | null;
  source: 'file' | 'selectedApiKey' | 'none';
} {
  // 1. Try parsing from editedFiles
  if (editedFiles && editedFiles.length > 0) {
    const parsed = parseFn(editedFiles);
    if (parsed.apiKey && parsed.baseUrl) {
      if (apiKeyId != null && parsed.apiKey.includes('*')) {
        return { ...parsed, source: 'selectedApiKey' };
      }
      return { ...parsed, source: 'file' };
    }
  }

  // 2. Fallback: derive from apiKeyId + siteUrl
  if (apiKeyId != null) {
    const found = apiKeys.find((k: any) => (k.id ?? k.token_id ?? 0) === apiKeyId);
    if (found) {
      const keyValue = found.key || found.token || '';
      if (keyValue) {
        return {
          apiKey: keyValue,
          baseUrl: siteUrl.replace(/\/+$/, ''),
          source: 'selectedApiKey',
        };
      }
    }
  }

  return { apiKey: null, baseUrl: null, source: 'none' };
}

/**
 * 更新 Codex 配置文件中的 wire_api 值
 * @param editedFiles - 当前配置文件列表
 * @param wireApi - 新的 wire_api 值（固定为 "responses"）
 * @param codexDetail - 测试结果详情（用于生成注释）
 * @returns 更新后的配置文件列表，如果无法更新则返回 null
 */
function updateCodexWireApi(
  editedFiles: Array<{ path: string; content: string }>,
  wireApi: string,
  codexDetail: { responses: boolean | null }
): Array<{ path: string; content: string }> | null {
  const configFile = editedFiles.find(f => f.path.includes('config.toml'));
  if (!configFile) {
    return null;
  }

  // 生成测试结果注释
  const responsesStatus =
    codexDetail.responses === true ? '✓' : codexDetail.responses === false ? '✗' : '?';
  const testComment = `# wire_api 测试结果: responses=${responsesStatus}`;

  let content = configFile.content;

  // 更新或添加测试结果注释
  const commentPattern = /# wire_api 测试结果:.*\n/;
  if (commentPattern.test(content)) {
    content = content.replace(commentPattern, testComment + '\n');
  } else {
    // 在 wire_api 行前添加注释
    content = content.replace(/(wire_api\s*=)/, testComment + '\n$1');
  }

  // 更新 wire_api 值
  const wireApiPattern = /wire_api\s*=\s*"[^"]*"/;
  if (wireApiPattern.test(content)) {
    content = content.replace(wireApiPattern, `wire_api = "${wireApi}"`);
  }

  return editedFiles.map(f => (f.path.includes('config.toml') ? { ...f, content } : f));
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
    async (
      storeKey: string,
      siteLabel: string,
      siteUrl: string,
      availableApiKeys: any[],
      accountId?: string
    ) => {
      // 检查是否已在测试中
      if (isCliTestingSite(storeKey)) {
        return;
      }

      // 获取 CLI 配置
      const cliConfig = getCliConfig(storeKey);
      if (!cliConfig) {
        toast.error(`请先配置 ${siteLabel} 的 CLI 设置`);
        return;
      }

      const normalizedSiteUrl = siteUrl.replace(/\/+$/, '');

      // 检查是否有任何配置且启用
      const cc = cliConfig.claudeCode;
      const cx = cliConfig.codex;
      const oc = cliConfig.openCode;
      const ccTestModels = normalizeCliTestModels(cc);
      const cxTestModels = normalizeCliTestModels(cx);
      const ocTestModels = normalizeCliTestModels(oc);

      // 标记为测试中
      addCliTestingSite(storeKey);

      try {
        // 构建测试配置
        const mismatchWarnings = new Set<string>();
        const testConfigs: Array<{
          cliType: 'claudeCode' | 'codex' | 'openCode';
          apiKey: string;
          model: string;
          baseUrl?: string;
          targetProtocol?: CliTargetProtocol;
        }> = [];

        // Claude Code - 从配置文件中读取 API Key 和 Base URL
        if (cc?.enabled && ccTestModels.length > 0) {
          const credential = resolveCliCredentials(
            cc.editedFiles,
            parseClaudeCodeConfig,
            cc.apiKeyId,
            availableApiKeys,
            siteUrl
          );
          let apiKey = credential.apiKey;
          let baseUrl = credential.baseUrl;

          if (cc.apiKeyId != null) {
            maybeWarnPreviewBaseUrlMismatch(
              'Claude Code',
              credential.baseUrl,
              normalizedSiteUrl,
              mismatchWarnings
            );
            const resolved = await window.electronAPI.token?.resolveApiKeyValue?.(
              siteUrl,
              cc.apiKeyId,
              accountId
            );
            if (!resolved || resolved.success !== true || !resolved.data) {
              toast.warning('Claude Code 所选 API Key 无法解析明文，请先刷新站点或重新选择');
              apiKey = null;
            } else {
              apiKey = resolved.data;
              // Site-page testing should probe the current managed site URL even if a stale
              // preview file still contains an older base URL snapshot.
              baseUrl = normalizedSiteUrl;
            }
          }

          if (!apiKey || !baseUrl) {
            toast.warning('Claude Code 配置不完整，请先选择 API Key 和测试模型');
          } else {
            ccTestModels.forEach(model => {
              testConfigs.push({
                cliType: 'claudeCode',
                apiKey,
                model,
                baseUrl,
              });
            });
          }
        }

        // Codex - 从配置文件中读取 API Key 和 Base URL
        if (cx?.enabled && cxTestModels.length > 0) {
          const credential = resolveCliCredentials(
            cx.editedFiles,
            parseCodexConfig,
            cx.apiKeyId,
            availableApiKeys,
            siteUrl
          );
          let apiKey = credential.apiKey;
          let baseUrl = credential.baseUrl;

          if (cx.apiKeyId != null) {
            maybeWarnPreviewBaseUrlMismatch(
              'Codex',
              credential.baseUrl,
              normalizedSiteUrl,
              mismatchWarnings
            );
            const resolved = await window.electronAPI.token?.resolveApiKeyValue?.(
              siteUrl,
              cx.apiKeyId,
              accountId
            );
            if (!resolved || resolved.success !== true || !resolved.data) {
              toast.warning('Codex 所选 API Key 无法解析明文，请先刷新站点或重新选择');
              apiKey = null;
            } else {
              apiKey = resolved.data;
              baseUrl = normalizedSiteUrl;
            }
          }

          if (!apiKey || !baseUrl) {
            toast.warning('Codex 配置不完整，请先选择 API Key 和测试模型');
          } else {
            cxTestModels.forEach(model => {
              testConfigs.push({
                cliType: 'codex',
                apiKey,
                model,
                baseUrl,
              });
            });
          }
        }

        // OpenCode - 从官方 opencode.json/auth.json 中读取 API Key 和 Base URL
        if (oc?.enabled && ocTestModels.length > 0) {
          const credential = resolveCliCredentials(
            oc.editedFiles,
            parseOpenCodeConfig,
            oc.apiKeyId,
            availableApiKeys,
            siteUrl
          );
          let apiKey = credential.apiKey;
          let baseUrl = credential.baseUrl;
          const targetProtocol = normalizeCliTargetProtocol(oc.targetProtocol);

          if (oc.apiKeyId != null) {
            maybeWarnPreviewBaseUrlMismatch(
              'OpenCode',
              credential.baseUrl,
              normalizedSiteUrl,
              mismatchWarnings
            );
            const resolved = await window.electronAPI.token?.resolveApiKeyValue?.(
              siteUrl,
              oc.apiKeyId,
              accountId
            );
            if (!resolved || resolved.success !== true || !resolved.data) {
              toast.warning('OpenCode 所选 API Key 无法解析明文，请先刷新站点或重新选择');
              apiKey = null;
            } else {
              apiKey = resolved.data;
              baseUrl = normalizedSiteUrl;
            }
          }

          if (!apiKey || !baseUrl) {
            toast.warning('OpenCode 配置不完整，请先选择 API Key 和测试模型');
          } else {
            ocTestModels.forEach(model => {
              testConfigs.push({
                cliType: 'openCode',
                apiKey,
                model,
                baseUrl,
                targetProtocol,
              });
            });
          }
        }

        if (testConfigs.length === 0) {
          toast.error('没有有效的 CLI 配置，请确保已生成配置文件并选择测试模型');
          return;
        }

        // 调用后端测试，使用配置文件中的 baseUrl
        const response = await (window.electronAPI as any).cliCompat.testWithWrapper({
          siteUrl, // 作为备用
          configs: testConfigs,
        });

        // 处理 IPC 返回格式
        if (!response.success) {
          throw new Error(response.error || '测试失败');
        }

        const result: CliCompatibilityResult = {
          claudeCode: response.data.claudeCode ?? null,
          claudeDetail: response.data.claudeDetail,
          claudeError: response.data.claudeError,
          codex: response.data.codex ?? null,
          codexDetail: response.data.codexDetail, // 保存 Codex 详细测试结果
          codexError: response.data.codexError,
          openCode: response.data.openCode ?? null,
          openCodeDetail: response.data.openCodeDetail,
          openCodeError: response.data.openCodeError,
          testedAt: Date.now(),
        };

        setCliCompatibility(storeKey, result);

        // 保存结果到缓存
        try {
          const persistResult = await persistCliCompatibilityResult(siteUrl, result, {
            accountId,
            samples: response.samples,
          });

          if (!persistResult.success) {
            sessionEventLog.error(
              'cli-test',
              `${siteLabel} CLI 测试结果保存失败：${persistResult.error ?? '未知错误'}`
            );
          }
        } catch (persistError) {
          const message = persistError instanceof Error ? persistError.message : '未知错误';
          sessionEventLog.error('cli-test', `${siteLabel} CLI 测试结果保存失败：${message}`);
        }

        toast.info(`${siteLabel} CLI 兼容性测试完成`);
        sessionEventLog.info('cli-test', `${siteLabel} CLI 兼容性测试完成`);

        // 显示 Claude Code 测试结果
        if (cc?.enabled && response.data.claudeCode !== undefined) {
          if (response.data.claudeCode === true) {
            toast.success('Claude Code: 兼容 ✓', 6000);
          } else if (response.data.claudeCode === false) {
            toast.error('Claude Code: 不兼容 ✗', 6000);
          }
        }

        // 如果测试了 Codex，显示结果并自动更新配置文件中的 wire_api
        if (response.data.codexDetail && cx?.editedFiles) {
          const { responses } = response.data.codexDetail;
          const responsesStatus = responses === true ? '✓' : responses === false ? '✗' : '?';

          if (responses === true) {
            // 更新配置文件中的 wire_api（固定为 responses）
            const updatedEditedFiles = updateCodexWireApi(
              cx.editedFiles,
              'responses',
              response.data.codexDetail
            );
            if (updatedEditedFiles) {
              const updatedCliConfig = {
                ...cliConfig,
                codex: {
                  ...cx,
                  editedFiles: updatedEditedFiles,
                },
              };
              setCliConfig(storeKey, updatedCliConfig);
            }
            // Responses API 可用，显示成功
            toast.success(`Codex: wire_api="responses" [responses: ${responsesStatus}]`, 6000);
          } else if (response.data.codex === false) {
            // Responses API 不支持，显示错误
            toast.error(`Codex: 不兼容 [responses: ${responsesStatus}]`, 6000);
          }
        }

        if (oc?.enabled && response.data.openCode !== undefined) {
          if (response.data.openCode === true) {
            const mode = response.data.openCodeDetail?.mode ?? 'openai-chat-completions';
            toast.success(`OpenCode: 兼容 [${mode}]`, 6000);
          } else if (response.data.openCode === false) {
            toast.error('OpenCode: 不兼容', 6000);
          }
        }
      } catch (error: any) {
        toast.error(`${siteLabel} CLI 兼容性测试失败: ${error.message}`);
        sessionEventLog.error('cli-test', `${siteLabel} CLI 兼容性测试失败：${error.message}`);

        // 设置错误结果
        setCliCompatibility(storeKey, {
          claudeCode: null,
          claudeDetail: undefined,
          claudeError: undefined,
          codex: null,
          codexDetail: undefined,
          codexError: undefined,
          openCode: null,
          openCodeDetail: undefined,
          openCodeError: undefined,
          testedAt: Date.now(),
          error: error.message,
        });
      } finally {
        removeCliTestingSite(storeKey);
      }
    },
    [
      isCliTestingSite,
      getCliConfig,
      addCliTestingSite,
      removeCliTestingSite,
      setCliCompatibility,
      setCliConfig,
    ]
  );

  /**
   * 获取站点的 CLI 兼容性结果
   */
  const getCompatibility = useCallback(
    (storeKey: string) => cliCompatibility[storeKey],
    [cliCompatibility]
  );

  /**
   * 获取站点的 CLI 配置
   */
  const getCliConfigCallback = useCallback(
    (storeKey: string) => cliConfigs[storeKey] ?? null,
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
