/**
 * 统一 CLI 配置对话框
 * 合并 CliConfigDialog 和 CliConfigGeneratorDialog 功能
 * 支持 CLI 启用/禁用开关、配置选择、预览编辑和保存
 */

import { useState, useEffect, useMemo } from 'react';
import { X, Copy, Check, Edit2, Eye, ToggleLeft, ToggleRight, RotateCcw } from 'lucide-react';
import type { CliConfig, ApiKeyInfo } from '../../../shared/types/cli-config';
import { DEFAULT_CLI_CONFIG } from '../../../shared/types/cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  generateClaudeCodeTemplate,
  generateCodexTemplate,
  generateGeminiCliTemplate,
  type GeneratedConfig,
  type ConfigFile,
} from '../../services/cli-config-generator';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface UnifiedCliConfigDialogProps {
  isOpen: boolean;
  siteName: string;
  siteUrl: string;
  apiKeys: ApiKeyInfo[];
  siteModels: string[];
  currentConfig: CliConfig | null;
  onClose: () => void;
  onSave: (config: CliConfig) => void;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
  modelPrefix: string;
  supported: boolean; // 是否支持配置生成
}

const CLI_TYPES: CliTypeConfig[] = [
  {
    key: 'claudeCode',
    name: 'Claude Code',
    icon: ClaudeCodeIcon,
    modelPrefix: 'claude',
    supported: true,
  },
  { key: 'codex', name: 'Codex', icon: CodexIcon, modelPrefix: 'gpt', supported: true },
  {
    key: 'geminiCli',
    name: 'Gemini CLI',
    icon: GeminiIcon,
    modelPrefix: 'gemini',
    supported: true,
  },
];

/** 过滤匹配前缀的模型 */
function filterModelsByPrefix(models: string[], prefix: string): string[] {
  if (!prefix) return models;
  return models.filter(m => m.toLowerCase().includes(prefix.toLowerCase()));
}

/** 获取 API Key 的 ID */
function getApiKeyId(apiKey: ApiKeyInfo): number {
  return apiKey.id ?? apiKey.token_id ?? 0;
}

/** 获取 API Key 的实际 key 值 */
function getApiKeyValue(apiKey: ApiKeyInfo): string {
  return apiKey.key || apiKey.token || '';
}

/** 配置文件显示组件 - 支持预览和编辑模式 */
function ConfigFileDisplay({
  file,
  onCopy,
  copiedPath,
  isEditing,
  onContentChange,
}: {
  file: ConfigFile;
  onCopy: (path: string, content: string) => void;
  copiedPath: string | null;
  isEditing: boolean;
  onContentChange: (path: string, content: string) => void;
}) {
  const isCopied = copiedPath === file.path;
  // 根据内容行数计算高度，保持编辑和预览模式高度一致
  const lineCount = file.content.split('\n').length;
  const contentHeight = Math.max(lineCount * 1.5, 8); // 每行约 1.5rem，最小 8rem

  return (
    <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-700 border-b border-slate-200 dark:border-slate-600">
        <code
          className="text-sm font-mono text-slate-700 dark:text-slate-300"
          title={`配置文件路径: ${file.path}`}
        >
          {file.path}
        </code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          title="复制配置内容"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-green-500" />
              <span className="text-green-500">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500">复制</span>
            </>
          )}
        </button>
      </div>
      {isEditing ? (
        <textarea
          value={file.content}
          onChange={e => onContentChange(file.path, e.target.value)}
          className="w-full p-3 text-sm font-mono bg-slate-50 dark:bg-slate-800 border-none resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
          style={{ height: `${contentHeight}rem` }}
          spellCheck={false}
        />
      ) : (
        <pre
          className="p-3 text-sm font-mono bg-slate-50 dark:bg-slate-800 overflow-x-auto whitespace-pre-wrap"
          style={{ minHeight: `${contentHeight}rem` }}
        >
          <code
            className={
              file.language === 'json'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-amber-600 dark:text-amber-400'
            }
          >
            {file.content}
          </code>
        </pre>
      )}
    </div>
  );
}

/**
 * 统一 CLI 配置对话框
 */
export function UnifiedCliConfigDialog({
  isOpen,
  siteName,
  siteUrl,
  apiKeys,
  siteModels,
  currentConfig,
  onClose,
  onSave,
}: UnifiedCliConfigDialogProps) {
  // CLI 启用状态
  const [enabledState, setEnabledState] = useState<Record<CliType, boolean>>({
    claudeCode: true,
    codex: true,
    geminiCli: true,
  });

  // 当前选中的 CLI 类型
  const [selectedCli, setSelectedCli] = useState<CliType | null>('claudeCode');

  // 每个 CLI 的配置状态
  const [cliConfigs, setCliConfigs] = useState<
    Record<
      CliType,
      {
        apiKeyId: number | null;
        model: string | null;
        testModel: string | null;
        editedFiles: GeneratedConfig | null;
      }
    >
  >({
    claudeCode: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
    codex: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
    geminiCli: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
  });

  // 生成的配置内容（可编辑）- 用于保存编辑后的内容
  const [editedConfig, setEditedConfig] = useState<GeneratedConfig | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // 应用配置模式：merge（合并）或 overwrite（覆盖）
  const [applyMode, setApplyMode] = useState<'merge' | 'overwrite'>('merge');

  // 初始化配置
  useEffect(() => {
    if (isOpen && currentConfig) {
      // 初始化启用状态
      const newEnabledState: Record<CliType, boolean> = {
        claudeCode: currentConfig.claudeCode?.enabled ?? DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: currentConfig.codex?.enabled ?? DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: currentConfig.geminiCli?.enabled ?? DEFAULT_CLI_CONFIG.geminiCli.enabled,
      };
      setEnabledState(newEnabledState);

      // 初始化配置
      setCliConfigs({
        claudeCode: {
          apiKeyId: currentConfig.claudeCode?.apiKeyId ?? null,
          model: currentConfig.claudeCode?.model ?? null,
          testModel: currentConfig.claudeCode?.testModel ?? null,
          editedFiles: currentConfig.claudeCode?.editedFiles
            ? {
                files: currentConfig.claudeCode.editedFiles.map(f => ({
                  ...f,
                  language: 'json' as const,
                })),
              }
            : null,
        },
        codex: {
          apiKeyId: currentConfig.codex?.apiKeyId ?? null,
          model: currentConfig.codex?.model ?? null,
          testModel: currentConfig.codex?.testModel ?? null,
          editedFiles: currentConfig.codex?.editedFiles
            ? {
                files: currentConfig.codex.editedFiles.map(f => ({
                  ...f,
                  language: f.path.endsWith('.toml') ? ('toml' as const) : ('json' as const),
                })),
              }
            : null,
        },
        geminiCli: {
          apiKeyId: currentConfig.geminiCli?.apiKeyId ?? null,
          model: currentConfig.geminiCli?.model ?? null,
          testModel: currentConfig.geminiCli?.testModel ?? null,
          editedFiles: currentConfig.geminiCli?.editedFiles
            ? {
                files: currentConfig.geminiCli.editedFiles.map(f => ({
                  ...f,
                  language: f.path.endsWith('.env') ? ('toml' as const) : ('json' as const),
                })),
              }
            : null,
        },
      });
    } else if (isOpen) {
      // 重置为默认状态
      setEnabledState({
        claudeCode: DEFAULT_CLI_CONFIG.claudeCode.enabled,
        codex: DEFAULT_CLI_CONFIG.codex.enabled,
        geminiCli: DEFAULT_CLI_CONFIG.geminiCli.enabled,
      });
      setCliConfigs({
        claudeCode: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
        codex: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
        geminiCli: { apiKeyId: null, model: null, testModel: null, editedFiles: null },
      });
    }

    if (isOpen) {
      setSelectedCli('claudeCode');
      setEditedConfig(null);
      setCopiedPath(null);
      setIsEditing(false);
      setShowResetConfirm(false);
      setApplyMode('merge');
    }
  }, [isOpen, currentConfig]);

  // 当 CLI 类型改变时，保存当前编辑的配置并重置编辑状态
  useEffect(() => {
    // 保存之前 CLI 的编辑配置（这里无法获取之前的 selectedCli，所以在切换前处理）
    setEditedConfig(null);
    setIsEditing(false);
    // 加载当前 CLI 的 applyMode
    if (selectedCli && currentConfig?.[selectedCli]?.applyMode) {
      setApplyMode(currentConfig[selectedCli].applyMode!);
    } else {
      setApplyMode('merge');
    }
  }, [selectedCli, currentConfig]);

  // 切换 CLI 类型前保存编辑的配置
  const handleCliTypeChange = (newCliType: CliType) => {
    // 如果当前有编辑过的配置，先保存
    if (
      selectedCli &&
      editedConfig &&
      (selectedCli === 'claudeCode' || selectedCli === 'codex' || selectedCli === 'geminiCli')
    ) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: editedConfig },
      }));
    }
    setSelectedCli(newCliType);
  };

  // 获取当前 CLI 类型配置
  const currentCliConfig = useMemo(() => {
    return CLI_TYPES.find(c => c.key === selectedCli);
  }, [selectedCli]);

  // 获取可用模型列表
  const availableModels = useMemo(() => {
    if (!currentCliConfig || !selectedCli) return [];
    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) return [];
    return filterModelsByPrefix(siteModels, currentCliConfig.modelPrefix);
  }, [currentCliConfig, selectedCli, cliConfigs, siteModels]);

  // 获取选中的 API Key 对象
  const selectedApiKey = useMemo(() => {
    if (!selectedCli) return null;
    const config = cliConfigs[selectedCli];
    if (!config.apiKeyId) return null;
    return apiKeys.find(k => getApiKeyId(k) === config.apiKeyId) || null;
  }, [apiKeys, selectedCli, cliConfigs]);

  // 实时生成配置预览
  const realtimeConfig = useMemo(() => {
    if (!selectedCli || !selectedApiKey) return null;
    const config = cliConfigs[selectedCli];
    if (!config.model) return null;

    const params = {
      siteUrl,
      siteName,
      apiKey: getApiKeyValue(selectedApiKey),
      model: config.model,
    };

    if (selectedCli === 'claudeCode') {
      return generateClaudeCodeConfig(params);
    } else if (selectedCli === 'codex') {
      return generateCodexConfig(params);
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliConfig(params);
    }
    return null;
  }, [selectedCli, selectedApiKey, cliConfigs, siteUrl, siteName]);

  // 配置模板（未选择 API Key 和 model 时显示）
  const templateConfig = useMemo(() => {
    if (selectedCli === 'claudeCode') {
      return generateClaudeCodeTemplate();
    } else if (selectedCli === 'codex') {
      return generateCodexTemplate();
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliTemplate();
    }
    return null;
  }, [selectedCli]);

  // 当前显示的配置（优先级：编辑中的内容 > 已保存的编辑内容 > 实时生成的内容 > 模板）
  const savedEditedConfig = selectedCli ? cliConfigs[selectedCli]?.editedFiles : null;
  const displayConfig =
    isEditing && editedConfig
      ? editedConfig
      : savedEditedConfig || realtimeConfig || templateConfig;

  // 是否显示模板（未选择完整配置时）
  const isShowingTemplate = !realtimeConfig && !savedEditedConfig && !!templateConfig;

  // 切换 CLI 启用状态
  const handleToggleEnabled = (cliType: CliType) => {
    setEnabledState(prev => ({
      ...prev,
      [cliType]: !prev[cliType],
    }));
  };

  // 处理 API Key 选择变化
  const handleApiKeyChange = (apiKeyId: number | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: {
        ...prev[selectedCli],
        apiKeyId,
        model: null,
        testModel: null,
        editedFiles: null,
      },
    }));
    // API Key 变化时重置编辑状态
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 处理 CLI 模型选择变化
  const handleModelChange = (model: string | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: { ...prev[selectedCli], model, editedFiles: null },
    }));
    // 模型变化时重置编辑状态
    setEditedConfig(null);
    setIsEditing(false);
  };

  // 处理测试模型选择变化
  const handleTestModelChange = (testModel: string | null) => {
    if (!selectedCli) return;
    setCliConfigs(prev => ({
      ...prev,
      [selectedCli]: { ...prev[selectedCli], testModel },
    }));
  };

  // 复制配置内容
  const handleCopy = async (path: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 更新配置文件内容（编辑模式）
  const handleContentChange = (path: string, newContent: string) => {
    const baseConfig = editedConfig || realtimeConfig;
    if (!baseConfig) return;
    setEditedConfig({
      files: baseConfig.files.map(file =>
        file.path === path ? { ...file, content: newContent } : file
      ),
    });
  };

  // 切换编辑/预览模式
  const toggleEditMode = () => {
    if (!isEditing) {
      // 进入编辑模式时，优先使用已保存的编辑配置，否则使用实时生成的配置
      const configToEdit = savedEditedConfig || realtimeConfig;
      if (configToEdit) {
        setEditedConfig(configToEdit);
      }
    }
    setIsEditing(!isEditing);
  };

  // 重置配置为默认值
  const handleResetConfig = () => {
    setEditedConfig(null);
    setIsEditing(false);
    if (selectedCli) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: null },
      }));
    }
    setShowResetConfirm(false);
  };

  // 保存配置
  const handleSave = () => {
    // 如果当前 CLI 有编辑过的配置，先保存到 cliConfigs
    if (
      selectedCli &&
      editedConfig &&
      (selectedCli === 'claudeCode' || selectedCli === 'codex' || selectedCli === 'geminiCli')
    ) {
      setCliConfigs(prev => ({
        ...prev,
        [selectedCli]: { ...prev[selectedCli], editedFiles: editedConfig },
      }));
    }

    // 为指定 CLI 类型生成配置文件
    const generateConfigForCli = (cliType: 'claudeCode' | 'codex' | 'geminiCli') => {
      const config = cliConfigs[cliType];
      if (!config.apiKeyId || !config.model) return null;

      const apiKey = apiKeys.find(k => getApiKeyId(k) === config.apiKeyId);
      if (!apiKey) return null;

      const params = {
        siteUrl,
        siteName,
        apiKey: getApiKeyValue(apiKey),
        model: config.model,
      };

      if (cliType === 'claudeCode') {
        return generateClaudeCodeConfig(params);
      } else if (cliType === 'codex') {
        return generateCodexConfig(params);
      } else if (cliType === 'geminiCli') {
        return generateGeminiCliConfig(params);
      }
      return null;
    };

    // 获取最新的 editedFiles（优先级：当前编辑 > 已保存编辑 > 实时生成）
    const getEditedFiles = (cliType: 'claudeCode' | 'codex' | 'geminiCli') => {
      // 1. 当前正在编辑的配置
      if (selectedCli === cliType && editedConfig) {
        return editedConfig.files.map(f => ({ path: f.path, content: f.content }));
      }
      // 2. 已保存的编辑配置
      if (cliConfigs[cliType].editedFiles) {
        return cliConfigs[cliType].editedFiles!.files.map(f => ({
          path: f.path,
          content: f.content,
        }));
      }
      // 3. 实时生成的配置（如果有完整的 apiKeyId 和 model）
      const generatedConfig = generateConfigForCli(cliType);
      if (generatedConfig) {
        return generatedConfig.files.map(f => ({ path: f.path, content: f.content }));
      }
      return null;
    };

    const newConfig: CliConfig = {
      claudeCode: {
        apiKeyId: cliConfigs.claudeCode.apiKeyId,
        model: cliConfigs.claudeCode.model,
        testModel: cliConfigs.claudeCode.testModel,
        enabled: enabledState.claudeCode,
        editedFiles: getEditedFiles('claudeCode'),
        applyMode:
          selectedCli === 'claudeCode'
            ? applyMode
            : (currentConfig?.claudeCode?.applyMode ?? 'merge'),
      },
      codex: {
        apiKeyId: cliConfigs.codex.apiKeyId,
        model: cliConfigs.codex.model,
        testModel: cliConfigs.codex.testModel,
        enabled: enabledState.codex,
        editedFiles: getEditedFiles('codex'),
        applyMode:
          selectedCli === 'codex' ? applyMode : (currentConfig?.codex?.applyMode ?? 'merge'),
      },
      geminiCli: {
        apiKeyId: cliConfigs.geminiCli.apiKeyId,
        model: cliConfigs.geminiCli.model,
        testModel: cliConfigs.geminiCli.testModel,
        enabled: enabledState.geminiCli,
        editedFiles: getEditedFiles('geminiCli'),
        applyMode:
          selectedCli === 'geminiCli'
            ? applyMode
            : (currentConfig?.geminiCli?.applyMode ?? 'merge'),
      },
    };
    onSave(newConfig);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
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
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* CLI 开关区域 */}
          <div className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              CLI 开关
            </label>
            <div className="flex flex-wrap gap-3">
              {CLI_TYPES.map(cli => (
                <div
                  key={cli.key}
                  className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-600"
                >
                  <img src={cli.icon} alt={cli.name} className="w-4 h-4" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{cli.name}</span>
                  <button
                    onClick={() => handleToggleEnabled(cli.key)}
                    className="flex items-center ml-1"
                    title={enabledState[cli.key] ? '点击禁用' : '点击启用'}
                  >
                    {enabledState[cli.key] ? (
                      <ToggleRight className="w-6 h-6 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-slate-300 dark:text-slate-500" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* CLI 类型选择 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              选择 CLI 类型进行配置
            </label>
            <div className="flex gap-2 flex-wrap">
              {CLI_TYPES.map(cli => (
                <button
                  key={cli.key}
                  onClick={() => handleCliTypeChange(cli.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                    selectedCli === cli.key
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
                >
                  <img src={cli.icon} alt={cli.name} className="w-5 h-5" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">{cli.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key 和模型选择 - 仅支持的 CLI 显示 */}
          {selectedCli && currentCliConfig?.supported && (
            <>
              {/* API Key 选择 */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  选择 API Key
                </label>
                {apiKeys.length === 0 ? (
                  <div className="text-sm text-slate-500 py-2">该站点没有可用的 API Key</div>
                ) : (
                  <select
                    value={cliConfigs[selectedCli]?.apiKeyId ?? ''}
                    onChange={e =>
                      handleApiKeyChange(e.target.value ? parseInt(e.target.value, 10) : null)
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">请选择 API Key</option>
                    {apiKeys.map(apiKey => {
                      const id = getApiKeyId(apiKey);
                      const matchingCount = filterModelsByPrefix(
                        siteModels,
                        currentCliConfig.modelPrefix
                      ).length;
                      return (
                        <option key={id} value={id}>
                          {apiKey.name || `Key #${id}`}
                          {apiKey.group ? ` [${apiKey.group}]` : ''}
                          {currentCliConfig.modelPrefix
                            ? ` (${matchingCount} 个 ${currentCliConfig.modelPrefix}* 模型)`
                            : ` (${matchingCount} 个模型)`}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {/* 模型选择 - 分为测试模型和 CLI 模型 */}
              {cliConfigs[selectedCli]?.apiKeyId && (
                <div className="grid grid-cols-2 gap-4">
                  {/* 测试使用模型 */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      测试使用模型
                    </label>
                    {availableModels.length > 0 ? (
                      <select
                        value={cliConfigs[selectedCli]?.testModel ?? ''}
                        onChange={e => handleTestModelChange(e.target.value || null)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="">请选择测试模型（请选择较新的模型）</option>
                        {availableModels.map(model => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-sm text-slate-500 py-2">
                        {currentCliConfig.modelPrefix
                          ? `没有匹配 ${currentCliConfig.modelPrefix}* 前缀的模型`
                          : '没有可用模型'}
                      </div>
                    )}
                  </div>
                  {/* CLI 使用模型 */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      CLI 使用模型
                    </label>
                    {availableModels.length > 0 ? (
                      <select
                        value={cliConfigs[selectedCli]?.model ?? ''}
                        onChange={e => handleModelChange(e.target.value || null)}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="">请选择 CLI 模型</option>
                        {availableModels.map(model => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-sm text-slate-500 py-2">
                        {currentCliConfig.modelPrefix
                          ? `没有匹配 ${currentCliConfig.modelPrefix}* 前缀的模型`
                          : '没有可用模型'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 配置预览区域 - 始终显示，实时更新 */}
              {(selectedCli === 'claudeCode' ||
                selectedCli === 'codex' ||
                selectedCli === 'geminiCli') && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      配置文件预览
                      {isShowingTemplate && (
                        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                          (模板)
                        </span>
                      )}
                    </div>
                    {displayConfig && !isShowingTemplate && (
                      <div className="flex items-center gap-2">
                        {/* 应用模式选择 */}
                        <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
                          <button
                            onClick={() => setApplyMode('merge')}
                            className={`px-2.5 py-1 text-xs transition-colors ${
                              applyMode === 'merge'
                                ? 'bg-primary-500 text-white'
                                : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600'
                            }`}
                            title="合并模式：保留现有配置，只更新相关项"
                          >
                            合并
                          </button>
                          <button
                            onClick={() => setApplyMode('overwrite')}
                            className={`px-2.5 py-1 text-xs transition-colors ${
                              applyMode === 'overwrite'
                                ? 'bg-primary-500 text-white'
                                : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600'
                            }`}
                            title="覆盖模式：完全替换现有配置文件"
                          >
                            覆盖
                          </button>
                        </div>
                        {/* 重置按钮 - 仅在有编辑内容时显示 */}
                        {(editedConfig || savedEditedConfig) && (
                          <button
                            onClick={() => setShowResetConfirm(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-600 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                            title="重置为默认配置"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>重置</span>
                          </button>
                        )}
                        <button
                          onClick={toggleEditMode}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                          title={isEditing ? '切换到预览模式' : '切换到编辑模式'}
                        >
                          {isEditing ? (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>预览</span>
                            </>
                          ) : (
                            <>
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>编辑</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                  {isShowingTemplate && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
                      请选择 API Key 和 CLI 使用模型以生成实际配置，以下为配置模板
                    </div>
                  )}
                  {isEditing && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      提示：您可以直接编辑配置内容，修改后点击复制按钮复制最终配置
                    </div>
                  )}
                  {displayConfig?.files.map(file => (
                    <ConfigFileDisplay
                      key={file.path}
                      file={file}
                      onCopy={handleCopy}
                      copiedPath={copiedPath}
                      isEditing={isEditing && !isShowingTemplate}
                      onContentChange={handleContentChange}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
          >
            保存配置
          </button>
        </div>

        {/* 重置确认对话框 */}
        {showResetConfirm && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-xl">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-5 mx-4 max-w-sm">
              <h3 className="text-base font-medium text-slate-800 dark:text-slate-200 mb-2">
                确认重置
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                确定要重置为默认配置吗？您的编辑内容将会丢失。
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleResetConfig}
                  className="px-3 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
                >
                  确认重置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
