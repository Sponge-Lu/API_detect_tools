/**
 * @file src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx
 * @description 自定义 CLI 配置编辑器对话框
 *
 * 输入: CustomCliConfigEditorDialogProps (配置对象、回调)
 * 输出: React 组件 (自定义 CLI 配置编辑 UI)
 * 定位: 展示层 - 编辑自定义 CLI 配置，包含 CLI 开关、模型选择、配置预览、应用配置
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useMemo } from 'react';
import { Copy, Check, RefreshCw, Loader2, Key, Globe, Settings } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import type { CustomCliConfig, CustomCliSettings } from '../../../shared/types/custom-cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  type GeneratedConfig,
} from '../../services/cli-config-generator';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface CustomCliConfigEditorDialogProps {
  isOpen: boolean;
  config: CustomCliConfig;
  onClose: () => void;
}

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliTypeConfig {
  key: CliType;
  name: string;
  icon: string;
  modelPrefix: string;
}

const CLI_TYPES: CliTypeConfig[] = [
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon, modelPrefix: 'claude' },
  { key: 'codex', name: 'Codex', icon: CodexIcon, modelPrefix: 'gpt' },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon, modelPrefix: 'gemini' },
];

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

/** 配置文件显示组件 */
function ConfigFileDisplay({
  file,
  onCopy,
  copiedPath,
}: {
  file: { path: string; content: string };
  onCopy: (path: string, content: string) => void;
  copiedPath: string | null;
}) {
  const isCopied = copiedPath === file.path;
  const lineCount = file.content.split('\n').length;
  const contentHeight = Math.max(lineCount * 1.5, 6);

  return (
    <div className="border border-[var(--ios-separator)] rounded-[var(--radius-md)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--ios-bg-tertiary)] border-b border-[var(--ios-separator)]">
        <code className="text-sm font-mono text-[var(--ios-text-primary)]">{file.path}</code>
        <button
          onClick={() => onCopy(file.path, file.content)}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-[var(--radius-sm)] hover:bg-[var(--ios-bg-secondary)] active:scale-95 transition-all"
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
      <pre
        className="p-3 text-sm font-mono bg-[#1e1e1e] overflow-x-auto whitespace-pre-wrap"
        style={{ minHeight: `${contentHeight}rem` }}
      >
        <code className="text-[#d4d4d4]">{file.content}</code>
      </pre>
    </div>
  );
}

/**
 * 自定义 CLI 配置编辑器对话框
 */
export function CustomCliConfigEditorDialog({
  isOpen,
  config,
  onClose,
}: CustomCliConfigEditorDialogProps) {
  const { updateConfig, saveConfigs, fetchModels, fetchingModels } = useCustomCliConfigStore();

  // 本地编辑状态
  const [name, setName] = useState(config.name);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [notes, setNotes] = useState(config.notes || '');
  const [cliSettings, setCliSettings] = useState(config.cliSettings);
  const [selectedCli, setSelectedCli] = useState<CliType>('claudeCode');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  // 获取当前配置的模型列表 (从 store 中实时获取以反映拉取结果)
  const { configs } = useCustomCliConfigStore();
  const currentConfig = configs.find(c => c.id === config.id);
  const models = currentConfig?.models || config.models;

  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setBaseUrl(config.baseUrl);
      setApiKey(config.apiKey);
      setNotes(config.notes || '');
      setCliSettings(config.cliSettings);
      setSelectedCli('claudeCode');
      setCopiedPath(null);
    }
  }, [isOpen, config]);

  // 过滤匹配前缀的模型
  const filterModelsByPrefix = (modelList: string[], prefix: string): string[] => {
    if (!prefix) return modelList;
    return modelList.filter(m => m.toLowerCase().includes(prefix.toLowerCase()));
  };

  // 当前 CLI 类型配置
  const currentCliConfig = useMemo(() => CLI_TYPES.find(c => c.key === selectedCli), [selectedCli]);

  // 可用模型列表
  const availableModels = useMemo(() => {
    if (!currentCliConfig) return [];
    return filterModelsByPrefix(models, currentCliConfig.modelPrefix);
  }, [currentCliConfig, models]);

  // 生成配置预览
  const configPreview = useMemo((): GeneratedConfig | null => {
    const settings = cliSettings[selectedCli];
    if (!settings.model || !baseUrl || !apiKey) return null;

    const params = {
      siteUrl: baseUrl,
      siteName: name || '自定义配置',
      apiKey,
      model: settings.model,
    };

    if (selectedCli === 'claudeCode') {
      return generateClaudeCodeConfig(params);
    } else if (selectedCli === 'codex') {
      return generateCodexConfig(params);
    } else if (selectedCli === 'geminiCli') {
      return generateGeminiCliConfig(params);
    }
    return null;
  }, [selectedCli, cliSettings, baseUrl, apiKey, name]);

  // 处理 CLI 设置变更
  const handleCliSettingChange = (cliType: CliType, update: Partial<CustomCliSettings>) => {
    setCliSettings(prev => ({
      ...prev,
      [cliType]: { ...prev[cliType], ...update },
    }));
  };

  // 处理拉取模型
  const handleFetchModels = async () => {
    // 先保存当前的 baseUrl 和 apiKey
    updateConfig(config.id, { baseUrl, apiKey });
    await fetchModels(config.id);
  };

  // 复制配置
  const handleCopy = async (path: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 保存配置
  const handleSave = async () => {
    updateConfig(config.id, {
      name,
      baseUrl,
      apiKey,
      notes,
      cliSettings,
    });
    await saveConfigs();
    onClose();
  };

  const isFetching = fetchingModels[config.id] || false;

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={onClose}
      title={config.name ? `编辑: ${config.name}` : '新建自定义配置'}
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
        {/* 基本信息 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              配置名称
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: 我的 API"
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              <Globe className="w-4 h-4 inline mr-1" />
              Base URL
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              <Key className="w-4 h-4 inline mr-1" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
              模型数
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)]">
                {models.length} 个模型
              </div>
              <IOSButton
                variant="secondary"
                size="sm"
                onClick={handleFetchModels}
                disabled={isFetching || !baseUrl || !apiKey}
              >
                {isFetching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                拉取
              </IOSButton>
            </div>
          </div>
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
            备注信息
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="在此添加备注信息（可选）..."
            rows={2}
            className="w-full px-3 py-2 bg-[var(--ios-bg-secondary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:ring-2 focus:ring-[var(--ios-blue)] focus:border-transparent transition-all resize-none"
          />
        </div>

        {/* CLI 开关 */}
        <div className="flex items-center gap-6 flex-wrap">
          <label className="text-sm font-semibold text-[var(--ios-text-primary)]">CLI 开关</label>
          <div className="flex items-center gap-5">
            {CLI_TYPES.map(cli => (
              <div key={cli.key} className="flex items-center gap-2">
                <img src={cli.icon} alt={cli.name} className="w-4 h-4" />
                <span className="text-sm text-[var(--ios-text-primary)]">{cli.name}</span>
                <IOSToggle
                  checked={cliSettings[cli.key].enabled}
                  onChange={checked => handleCliSettingChange(cli.key, { enabled: checked })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* CLI 类型选择 */}
        <div>
          <label className="block text-sm font-semibold text-[var(--ios-text-primary)] mb-2">
            选择 CLI 类型进行配置
          </label>
          <div className="flex gap-2 flex-wrap">
            {CLI_TYPES.map(cli => (
              <button
                key={cli.key}
                onClick={() => setSelectedCli(cli.key)}
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

        {/* CLI 使用模型 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-2">
            CLI 使用模型
          </label>
          {models.length === 0 ? (
            <div className="text-sm text-[var(--ios-text-secondary)] py-2">请先拉取模型列表</div>
          ) : availableModels.length > 0 ? (
            <select
              value={cliSettings[selectedCli]?.model ?? ''}
              onChange={e => handleCliSettingChange(selectedCli, { model: e.target.value || null })}
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
              {currentCliConfig?.modelPrefix
                ? `没有匹配 ${currentCliConfig.modelPrefix}* 前缀的模型`
                : '没有可用模型'}
            </div>
          )}
        </div>

        {/* 配置预览 */}
        {configPreview && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-[var(--ios-text-primary)]">配置文件预览</div>
            {configPreview.files.map(file => (
              <ConfigFileDisplay
                key={file.path}
                file={file}
                onCopy={handleCopy}
                copiedPath={copiedPath}
              />
            ))}
          </div>
        )}
      </div>
    </IOSModal>
  );
}
