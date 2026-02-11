/**
 * @file src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx
 * @description 统一 CLI 配置对话框 - 使用 IOSModal 重构
 *
 * 输入: UnifiedCliConfigDialogProps (站点数据、API Keys、CLI 配置、测试结果)
 * 输出: React 组件 (统一 CLI 配置对话框 UI)
 * 定位: 展示层 - 统一 CLI 配置对话框，支持 CLI 启用/禁用、配置选择、预览编辑和保存
 *
 * @version 2.1.12
 * @updated 2025-01-09 - 修复夜晚模式下代码预览区域的颜色对比度问题，CLI 开关按钮改为蓝色
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useMemo } from 'react';
import { Copy, Check, Edit2, Eye, RotateCcw, Settings } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import type { CliConfig, ApiKeyInfo } from '../../../shared/types/cli-config';
import type { CodexTestDetail, GeminiTestDetail } from '../../../shared/types/site';
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

/** iOS 风格 Toggle Switch 组件 */
function IOSToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`
        relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer rounded-full
        border-2 transition-colors duration-200 ease-in-out
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ios-blue)]
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${
          checked
            ? 'bg-[var(--ios-blue)] border-[var(--ios-blue)]'
            : 'bg-[var(--ios-separator)] border-[var(--ios-separator)]'
        }
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-[18px] w-[18px] rounded-full
          bg-white shadow-md ring-0
          transition-transform duration-200 ease-in-out
          ${checked ? 'translate-x-[21px]' : 'translate-x-[1px]'}
          mt-[1px]
        `}
      />
    </button>
  );
}

export interface UnifiedCliConfigDialogProps {
  isOpen: boolean;
  siteName: string;
  siteUrl: string;
  apiKeys: ApiKeyInfo[];
  siteModels: string[];
  currentConfig: CliConfig | null;
  codexDetail?: CodexTestDetail | null; // Codex 详细测试结果
  geminiDetail?: GeminiTestDetail | null; // Gemini CLI 详细测试结果，用于自动选择端点格式
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

/** 配置文件显示组件 - 支持预览和编辑模式 - iOS 风格 */
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

  // 代码区域使用统一的深色背景和统一的文字颜色
  // 所有配置文件使用相同的亮色，确保一致性和高对比度
  const codeBlockBg = 'bg-[#1e1e1e]';
  const codeTextColor = 'text-[#d4d4d4]'; // 统一使用浅灰白色，类似 VS Code 默认文字颜色

  return (
    <div className="border border-[var(--ios-separator)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--ios-bg-tertiary)] border-b border-[var(--ios-separator)]">
        <code
          className="text-sm font-mono text-[var(--ios-text-primary)]"
          title={`配置文件路径: ${file.path}`}
        >
          {file.path}
        </code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--ios-bg-secondary)] active:scale-95 transition-all"
          title="复制配置内容"
        >
          {isCopied ? (
            <>
              <Check className="w-3.5 h-3.5 text-[var(--ios-green)]" />
              <span className="text-[var(--ios-green)]">已复制</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-[var(--ios-text-secondary)]" />
              <span className="text-[var(--ios-text-secondary)]">复制</span>
            </>
          )}
        </button>
      </div>
      {isEditing ? (
        <textarea
          value={file.content}
          onChange={e => onContentChange(file.path, e.target.value)}
          className={`w-full p-3 text-sm font-mono ${codeBlockBg} ${codeTextColor} border-none resize-none focus:outline-none focus:ring-2 focus:ring-[var(--ios-blue)]`}
          style={{ height: `${contentHeight}rem` }}
          spellCheck={false}
        />
      ) : (
        <pre
          className={`p-3 text-sm font-mono ${codeBlockBg} overflow-x-auto whitespace-pre-wrap`}
          style={{ minHeight: `${contentHeight}rem` }}
        >
          <code className={codeTextColor}>{file.content}</code>
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
  codexDetail,
  geminiDetail,
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
      return generateCodexConfig({ ...params, codexDetail: codexDetail ?? undefined });
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliConfig({ ...params, geminiDetail: geminiDetail ?? undefined });
    }
    return null;
  }, [selectedCli, selectedApiKey, cliConfigs, siteUrl, siteName, codexDetail, geminiDetail]);

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

    // 获取用户手动编辑的 editedFiles（仅保存用户实际编辑过的内容，未编辑则返回 null）
    // 这样下次打开对话框时，未编辑的 CLI 会 fallback 到实时生成的最新配置
    const getEditedFiles = (cliType: 'claudeCode' | 'codex' | 'geminiCli') => {
      // 1. 当前正在编辑的配置（用户在本次会话中手动编辑过）
      if (selectedCli === cliType && editedConfig) {
        return editedConfig.files.map(f => ({ path: f.path, content: f.content }));
      }
      // 2. 之前保存过的用户编辑配置
      if (cliConfigs[cliType].editedFiles) {
        return cliConfigs[cliType].editedFiles!.files.map(f => ({
          path: f.path,
          content: f.content,
        }));
      }
      // 3. 未编辑过则不保存，让预览和应用时实时生成
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

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={onClose}
      title={`CLI 配置 - ${siteName}`}
      titleIcon={<Settings className="w-5 h-5" />}
      size="xl"
      contentClassName="!p-0 !max-h-[70vh]"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onClose}>
            取消
          </IOSButton>
          <IOSButton variant="primary" onClick={handleSave}>
            保存配置
          </IOSButton>
        </>
      }
    >
      <div className="px-6 py-4 space-y-4 overflow-y-auto">
        {/* CLI 开关区域 - 标签和开关在同一行 */}
        <div className="flex items-center gap-6 flex-wrap">
          <label className="text-sm font-semibold text-[var(--ios-text-primary)]">CLI 开关</label>
          <div className="flex items-center gap-5">
            {CLI_TYPES.map(cli => (
              <div key={cli.key} className="flex items-center gap-2">
                <img src={cli.icon} alt={cli.name} className="w-4 h-4" />
                <span className="text-sm text-[var(--ios-text-primary)]">{cli.name}</span>
                <IOSToggle
                  checked={enabledState[cli.key]}
                  onChange={() => handleToggleEnabled(cli.key)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* CLI 类型选择 - iOS 风格统一 */}
        <div>
          <label className="block text-sm font-semibold text-[var(--ios-text-primary)] mb-2">
            选择 CLI 类型进行配置
          </label>
          <div className="flex gap-2 flex-wrap">
            {CLI_TYPES.map(cli => (
              <button
                key={cli.key}
                onClick={() => handleCliTypeChange(cli.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] border transition-all active:scale-95 ${
                  selectedCli === cli.key
                    ? 'border-[var(--ios-blue)] bg-[var(--ios-blue)]/10'
                    : 'border-[var(--ios-separator)] bg-[var(--ios-bg-secondary)] hover:border-[var(--ios-gray)]'
                }`}
              >
                <img src={cli.icon} alt={cli.name} className="w-5 h-5" />
                <span className="text-sm text-[var(--ios-text-primary)]">{cli.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* API Key 和模型选择 - 仅支持的 CLI 显示 */}
        {selectedCli && currentCliConfig?.supported && (
          <>
            {/* API Key 选择 - iOS 风格 */}
            <div>
              <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
                选择 API Key
              </label>
              {apiKeys.length === 0 ? (
                <div className="text-sm text-[var(--ios-text-secondary)] py-2">
                  该站点没有可用的 API Key
                </div>
              ) : (
                <select
                  value={cliConfigs[selectedCli]?.apiKeyId ?? ''}
                  onChange={e =>
                    handleApiKeyChange(e.target.value ? parseInt(e.target.value, 10) : null)
                  }
                  className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
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

            {/* 模型选择 - 分为测试模型和 CLI 模型 - iOS 风格 */}
            {cliConfigs[selectedCli]?.apiKeyId && (
              <div className="grid grid-cols-2 gap-4">
                {/* 测试使用模型 */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
                    测试使用模型
                  </label>
                  {availableModels.length > 0 ? (
                    <select
                      value={cliConfigs[selectedCli]?.testModel ?? ''}
                      onChange={e => handleTestModelChange(e.target.value || null)}
                      className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
                    >
                      <option value="">请选择测试模型（请选择较新的模型）</option>
                      {availableModels.map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-[var(--ios-text-secondary)] py-2">
                      {currentCliConfig.modelPrefix
                        ? `没有匹配 ${currentCliConfig.modelPrefix}* 前缀的模型`
                        : '没有可用模型'}
                    </div>
                  )}
                </div>
                {/* CLI 使用模型 */}
                <div>
                  <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
                    CLI 使用模型
                  </label>
                  {availableModels.length > 0 ? (
                    <select
                      value={cliConfigs[selectedCli]?.model ?? ''}
                      onChange={e => handleModelChange(e.target.value || null)}
                      className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
                    >
                      <option value="">请选择 CLI 模型</option>
                      {availableModels.map(model => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-[var(--ios-text-secondary)] py-2">
                      {currentCliConfig.modelPrefix
                        ? `没有匹配 ${currentCliConfig.modelPrefix}* 前缀的模型`
                        : '没有可用模型'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 配置预览区域 - 始终显示，实时更新 - iOS 风格 */}
            {(selectedCli === 'claudeCode' ||
              selectedCli === 'codex' ||
              selectedCli === 'geminiCli') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-[var(--ios-text-primary)]">
                    配置文件预览
                    {isShowingTemplate && (
                      <span className="ml-2 text-xs text-[var(--ios-orange)]">(模板)</span>
                    )}
                  </div>
                  {displayConfig && !isShowingTemplate && (
                    <div className="flex items-center gap-2">
                      {/* 应用模式选择 - iOS 风格分段控件 */}
                      <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--ios-separator)] overflow-hidden">
                        <button
                          onClick={() => setApplyMode('merge')}
                          className={`px-2.5 py-1 text-xs transition-all active:scale-95 ${
                            applyMode === 'merge'
                              ? 'bg-[var(--ios-blue)] text-white'
                              : 'bg-[var(--ios-bg-secondary)] text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)]'
                          }`}
                          title="合并模式：保留现有配置，只更新相关项"
                        >
                          合并
                        </button>
                        <button
                          onClick={() => setApplyMode('overwrite')}
                          className={`px-2.5 py-1 text-xs transition-all active:scale-95 ${
                            applyMode === 'overwrite'
                              ? 'bg-[var(--ios-blue)] text-white'
                              : 'bg-[var(--ios-bg-secondary)] text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)]'
                          }`}
                          title="覆盖模式：完全替换现有配置文件"
                        >
                          覆盖
                        </button>
                      </div>
                      {/* 重置按钮 - 仅在有编辑内容时显示 - iOS 风格 */}
                      {(editedConfig || savedEditedConfig) && (
                        <button
                          onClick={() => setShowResetConfirm(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-orange)]/50 text-[var(--ios-orange)] hover:bg-[var(--ios-orange)]/10 active:scale-95 transition-all"
                          title="重置为默认配置"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>重置</span>
                        </button>
                      )}
                      <button
                        onClick={toggleEditMode}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-md)] border border-[var(--ios-separator)] text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)] active:scale-95 transition-all"
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
                {/* 配置确认提醒 - 对所有 CLI 类型显示 */}
                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ios-orange)]/10 border border-[var(--ios-orange)]/30 rounded-[var(--radius-md)]">
                  <span className="text-[var(--ios-orange)]">⚠️</span>
                  <span className="text-xs text-[var(--ios-orange)]">
                    请去站点确认配置信息是否正确
                  </span>
                </div>
                {isShowingTemplate && (
                  <div className="text-xs text-[var(--ios-orange)] bg-[var(--ios-orange)]/10 px-3 py-2 rounded-[var(--radius-md)]">
                    请选择 API Key 和 CLI 使用模型以生成实际配置，以下为配置模板
                  </div>
                )}
                {isEditing && (
                  <div className="text-xs text-[var(--ios-text-secondary)]">
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

      {/* 重置确认对话框 */}
      {showResetConfirm && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center rounded-[var(--radius-xl)]">
          <div className="bg-[var(--ios-bg-secondary)] rounded-[var(--radius-lg)] shadow-[var(--shadow-xl)] p-5 mx-4 max-w-sm">
            <h3 className="text-base font-medium text-[var(--ios-text-primary)] mb-2">确认重置</h3>
            <p className="text-sm text-[var(--ios-text-secondary)] mb-4">
              确定要重置为默认配置吗？您的编辑内容将会丢失。
            </p>
            <div className="flex justify-end gap-2">
              <IOSButton size="sm" variant="tertiary" onClick={() => setShowResetConfirm(false)}>
                取消
              </IOSButton>
              <IOSButton
                size="sm"
                variant="primary"
                onClick={handleResetConfig}
                className="bg-[var(--ios-orange)] hover:bg-[var(--ios-orange)]/90"
              >
                确认重置
              </IOSButton>
            </div>
          </div>
        </div>
      )}
    </IOSModal>
  );
}
