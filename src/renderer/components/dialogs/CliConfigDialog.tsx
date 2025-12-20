/**
 * CLI 配置对话框
 * 允许用户为每个 CLI 类型选择 API Key 和模型
 */

import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';

export interface CliConfig {
  claudeCode: { apiKeyId: number | null; model: string | null } | null;
  codex: { apiKeyId: number | null; model: string | null } | null;
  geminiCli: { apiKeyId: number | null; model: string | null } | null;
  chat: { apiKeyId: number | null; model: string | null } | null;
}

export interface ApiKeyInfo {
  id?: number;
  token_id?: number;
  name?: string;
  key?: string;
  token?: string;
  group?: string;
  models?: string;
  status?: number;
}

export interface UserGroupInfo {
  desc: string;
  ratio: number;
}

interface CliConfigDialogProps {
  isOpen: boolean;
  siteName: string;
  apiKeys: ApiKeyInfo[];
  userGroups: Record<string, UserGroupInfo>;
  siteModels: string[];
  currentConfig: CliConfig | null;
  onClose: () => void;
  onSave: (config: CliConfig) => void;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli' | 'chat';

const CLI_TYPES: { key: CliType; name: string; modelPrefix: string }[] = [
  { key: 'claudeCode', name: 'Claude Code', modelPrefix: 'claude' },
  { key: 'codex', name: 'Codex', modelPrefix: 'gpt' },
  { key: 'geminiCli', name: 'Gemini CLI', modelPrefix: 'gemini' },
  { key: 'chat', name: 'Chat', modelPrefix: '' },
];

/**
 * 过滤匹配前缀的模型
 * 如果前缀为空，返回所有模型
 */
function filterModelsByPrefix(models: string[], prefix: string): string[] {
  if (!prefix) return models;
  return models.filter(m => m.toLowerCase().includes(prefix.toLowerCase()));
}

/**
 * 获取用户分组可用的模型
 * 用户分组名称通常对应模型前缀或特定模型集合
 */
function getModelsForGroup(
  groupName: string | undefined,
  siteModels: string[],
  userGroups: Record<string, UserGroupInfo>
): string[] {
  if (!groupName || !userGroups[groupName]) {
    // 如果没有分组，返回所有站点模型
    return siteModels;
  }
  // 返回所有站点模型（用户分组主要用于计费倍率，不限制模型访问）
  return siteModels;
}

export function CliConfigDialog({
  isOpen,
  siteName,
  apiKeys,
  userGroups,
  siteModels,
  currentConfig,
  onClose,
  onSave,
}: CliConfigDialogProps) {
  // 每个 CLI 类型的配置状态
  const [config, setConfig] = useState<CliConfig>({
    claudeCode: null,
    codex: null,
    geminiCli: null,
    chat: null,
  });

  // 初始化配置
  useEffect(() => {
    if (currentConfig) {
      setConfig(currentConfig);
    } else {
      setConfig({
        claudeCode: null,
        codex: null,
        geminiCli: null,
        chat: null,
      });
    }
  }, [currentConfig, isOpen]);

  // 获取 API Key 的 ID
  const getApiKeyId = (apiKey: ApiKeyInfo): number => {
    return apiKey.id ?? apiKey.token_id ?? 0;
  };

  // 获取选中 API Key 对应的用户分组可用模型（按前缀过滤）
  const getAvailableModels = (cliType: CliType, apiKeyId: number | null): string[] => {
    if (!apiKeyId) return [];
    const apiKey = apiKeys.find(k => getApiKeyId(k) === apiKeyId);
    if (!apiKey) return [];

    // 获取该 API Key 所属分组的可用模型
    const groupModels = getModelsForGroup(apiKey.group, siteModels, userGroups);
    const cliConfig = CLI_TYPES.find(c => c.key === cliType);
    if (!cliConfig) return groupModels;

    return filterModelsByPrefix(groupModels, cliConfig.modelPrefix);
  };

  // 获取 API Key 的匹配模型数量（用于显示）
  const getMatchingModelsCount = (apiKey: ApiKeyInfo, modelPrefix: string): number => {
    const groupModels = getModelsForGroup(apiKey.group, siteModels, userGroups);
    return filterModelsByPrefix(groupModels, modelPrefix).length;
  };

  // 处理 API Key 选择变化
  const handleApiKeyChange = (cliType: CliType, apiKeyId: number | null) => {
    setConfig(prev => ({
      ...prev,
      [cliType]: apiKeyId ? { apiKeyId, model: null } : null,
    }));
  };

  // 处理模型选择变化
  const handleModelChange = (cliType: CliType, model: string | null) => {
    setConfig(prev => {
      const current = prev[cliType];
      if (!current) return prev;
      return {
        ...prev,
        [cliType]: { ...current, model },
      };
    });
  };

  // 检查配置是否有效（至少配置了一个 CLI）
  const isConfigValid = useMemo(() => {
    return Object.values(config).some(c => c && c.apiKeyId && c.model);
  }, [config]);

  // 允许保存空配置（清除配置）
  const canSave = isConfigValid || apiKeys.length === 0;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            CLI 配置 - {siteName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <p>该站点没有可用的 API Key</p>
              <p className="text-sm mt-2">请先在站点详情中添加 API Key</p>
            </div>
          ) : (
            CLI_TYPES.map(({ key, name, modelPrefix }) => {
              const cliConfig = config[key];
              const selectedApiKeyId = cliConfig?.apiKeyId ?? null;
              const selectedModel = cliConfig?.model ?? null;
              const availableModels = getAvailableModels(key, selectedApiKeyId);

              return (
                <div
                  key={key}
                  className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg space-y-3"
                >
                  <div className="font-medium text-slate-700 dark:text-slate-300">
                    {name}
                    {modelPrefix && (
                      <span className="text-xs text-slate-500 ml-2">
                        (模型前缀: {modelPrefix}*)
                      </span>
                    )}
                  </div>

                  {/* API Key 选择 */}
                  <div>
                    <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                      API Key
                    </label>
                    <select
                      value={selectedApiKeyId ?? ''}
                      onChange={e => {
                        e.stopPropagation();
                        const val = e.target.value;
                        handleApiKeyChange(key, val ? parseInt(val, 10) : null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer"
                    >
                      <option value="">不配置</option>
                      {apiKeys.map(apiKey => {
                        const id = getApiKeyId(apiKey);
                        const matchingCount = getMatchingModelsCount(apiKey, modelPrefix);
                        const hasMatchingModels = matchingCount > 0;

                        return (
                          <option key={id} value={id}>
                            {apiKey.name || `Key #${id}`}
                            {apiKey.group ? ` [${apiKey.group}]` : ''}
                            {modelPrefix
                              ? hasMatchingModels
                                ? ` (${matchingCount} 个 ${modelPrefix}* 模型)`
                                : ' (无匹配模型)'
                              : ` (${matchingCount} 个模型)`}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* 模型选择 */}
                  {selectedApiKeyId && (
                    <div>
                      <label className="block text-sm text-slate-600 dark:text-slate-400 mb-1">
                        模型
                      </label>
                      {availableModels.length > 0 ? (
                        <select
                          value={selectedModel ?? ''}
                          onChange={e => {
                            e.stopPropagation();
                            handleModelChange(key, e.target.value || null);
                          }}
                          onClick={e => e.stopPropagation()}
                          className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent cursor-pointer"
                        >
                          <option value="">请选择模型</option>
                          {availableModels.map(model => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-sm text-slate-500 py-2">
                          {modelPrefix
                            ? `该 API Key 没有 ${modelPrefix}* 前缀的模型`
                            : '该 API Key 没有可用模型'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onSave(config)}
            disabled={!canSave}
            className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
