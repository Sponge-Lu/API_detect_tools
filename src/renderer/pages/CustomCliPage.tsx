/**
 * 自定义 CLI 配置独立页面
 * 基于 CustomCliConfigListDialog 内容改造为全页面布局
 */

import { useState, useEffect, useRef } from 'react';
import { Plus, Settings, Download, Trash2, Edit2, Globe, Loader2, Copy, Check } from 'lucide-react';
import { IOSButton } from '../components/IOSButton';
import { useCustomCliConfigStore } from '../store/customCliConfigStore';
import { useDetectionStore } from '../store/detectionStore';
import { useConfigStore } from '../store/configStore';
import { toast } from '../store/toastStore';
import type { CustomCliConfig } from '../../shared/types/custom-cli-config';
import { CustomCliConfigEditorDialog } from '../components/dialogs/CustomCliConfigEditorDialog';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
} from '../services/cli-config-generator';

// 导入 CLI 图标
import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GeminiIcon from '../assets/cli-icons/gemini.svg';

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliOption {
  key: CliType;
  name: string;
  icon: string;
}

const CLI_OPTIONS: CliOption[] = [
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon },
  { key: 'codex', name: 'Codex', icon: CodexIcon },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon },
];

/**
 * CLI 应用弹窗组件
 */
function ApplyCliPopover({
  config,
  anchorEl,
  onClose,
  onApply,
}: {
  config: CustomCliConfig;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onApply: (cliType: CliType, applyMode: 'merge' | 'overwrite') => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [applyMode, setApplyMode] = useState<'merge' | 'overwrite'>('merge');

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left - 100,
      });
    }
  }, [anchorEl]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        anchorEl &&
        !anchorEl.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [anchorEl, onClose]);

  const validCliOptions = CLI_OPTIONS.filter(opt => {
    const settings = config.cliSettings[opt.key];
    return settings.enabled && settings.model;
  });

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-white dark:bg-dark-card rounded-xl shadow-xl border border-light-border dark:border-dark-border py-1 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      {validCliOptions.length === 0 ? (
        <div className="px-4 py-3 text-sm text-light-text-secondary dark:text-dark-text-secondary">
          请先配置并启用 CLI
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-light-border dark:border-dark-border">
            <div className="text-xs text-light-text-secondary dark:text-dark-text-secondary mb-1.5">
              应用模式
            </div>
            <div className="flex rounded-lg overflow-hidden border border-light-border dark:border-dark-border">
              <button
                onClick={() => setApplyMode('merge')}
                className={`flex-1 px-3 py-1 text-xs transition-colors ${
                  applyMode === 'merge'
                    ? 'bg-primary-500 text-white'
                    : 'bg-light-bg dark:bg-dark-bg text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border dark:hover:bg-dark-border'
                }`}
              >
                合并
              </button>
              <button
                onClick={() => setApplyMode('overwrite')}
                className={`flex-1 px-3 py-1 text-xs transition-colors ${
                  applyMode === 'overwrite'
                    ? 'bg-primary-500 text-white'
                    : 'bg-light-bg dark:bg-dark-bg text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border dark:hover:bg-dark-border'
                }`}
              >
                覆盖
              </button>
            </div>
          </div>
          <div className="px-3 py-2 text-xs text-light-text-secondary dark:text-dark-text-secondary border-b border-light-border dark:border-dark-border">
            选择要应用的 CLI
          </div>
          {validCliOptions.map(option => (
            <button
              key={option.key}
              onClick={() => onApply(option.key, applyMode)}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
            >
              <img src={option.icon} alt={option.name} className="w-5 h-5" />
              <span className="text-sm text-light-text dark:text-dark-text">{option.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * 复制按钮组件
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 p-1 rounded-md text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-border/50 dark:hover:bg-dark-border/50 transition-colors"
      title="复制 URL"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-primary-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

export function CustomCliPage() {
  const { configs, loading, loadConfigs, addConfig, deleteConfig } = useCustomCliConfigStore();
  const { clearCliConfigDetection, detectCliConfig } = useDetectionStore();
  const { config: appConfig } = useConfigStore();

  const [editingConfig, setEditingConfig] = useState<CustomCliConfig | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [applyPopoverConfig, setApplyPopoverConfig] = useState<CustomCliConfig | null>(null);
  const [applyPopoverAnchor, setApplyPopoverAnchor] = useState<HTMLElement | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const handleAdd = () => {
    const newConfig = addConfig({ name: '新配置' });
    setEditingConfig(newConfig);
    setShowEditor(true);
  };

  const handleEdit = (config: CustomCliConfig) => {
    setEditingConfig(config);
    setShowEditor(true);
  };

  const handleDelete = async (config: CustomCliConfig) => {
    if (confirm(`确定要删除配置 "${config.name}" 吗？`)) {
      await deleteConfig(config.id);
    }
  };

  const handleOpenApplyPopover = (config: CustomCliConfig, event: React.MouseEvent) => {
    setApplyPopoverConfig(config);
    setApplyPopoverAnchor(event.currentTarget as HTMLElement);
  };

  const handleCloseApplyPopover = () => {
    setApplyPopoverConfig(null);
    setApplyPopoverAnchor(null);
  };

  const handleApplyToCli = async (cliType: CliType, applyMode: 'merge' | 'overwrite') => {
    if (!applyPopoverConfig || isApplying) return;

    const config = applyPopoverConfig;
    const settings = config.cliSettings[cliType];
    if (!settings.enabled || !settings.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }

    setIsApplying(true);

    try {
      const params = {
        siteUrl: config.baseUrl,
        siteName: config.name || '自定义配置',
        apiKey: config.apiKey,
        model: settings.model,
      };

      let generatedConfig;
      if (cliType === 'claudeCode') {
        generatedConfig = generateClaudeCodeConfig(params);
      } else if (cliType === 'codex') {
        generatedConfig = generateCodexConfig(params);
      } else {
        generatedConfig = generateGeminiCliConfig(params);
      }

      const filesToWrite = generatedConfig.files.map(f => ({
        path: f.path,
        content: f.content,
      }));

      const result = await (window.electronAPI as any).cliCompat.writeConfig({
        cliType,
        files: filesToWrite,
        applyMode,
      });

      if (result.success) {
        const pathsStr = result.writtenPaths.join(', ');
        toast.success(`${CLI_OPTIONS.find(o => o.key === cliType)?.name} 配置已写入: ${pathsStr}`);

        try {
          await window.electronAPI.configDetection.clearCache();
        } catch (error) {
          console.error('清除 CLI 配置缓存失败:', error);
        }
        clearCliConfigDetection();

        const siteInfos = (appConfig?.sites || [])
          .filter((s: { url?: string }) => s.url)
          .map((s: { name: string; url?: string }) => ({
            id: s.name,
            name: s.name,
            url: s.url!,
          }));
        detectCliConfig(siteInfos).catch(error => {
          console.error('CLI 配置检测刷新失败:', error);
        });

        if (cliType === 'claudeCode') {
          setTimeout(() => {
            toast.info('使用 Claude Code for VS Code 需重启 IDE 编辑器');
          }, 1500);
        }

        handleCloseApplyPopover();
      } else {
        toast.error(`写入失败: ${result.error || '未知错误'}`);
      }
    } catch (error: any) {
      toast.error(`应用配置失败: ${error.message || '未知错误'}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingConfig(null);
  };

  const hasValidCli = (config: CustomCliConfig): boolean => {
    return CLI_OPTIONS.some(opt => {
      const settings = config.cliSettings[opt.key];
      return settings.enabled && settings.model;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 工具栏 */}
      <div className="px-6 py-3 border-b border-light-border dark:border-dark-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Settings className="w-5 h-5 text-light-text-secondary dark:text-dark-text-secondary" />
          <h2 className="text-sm font-semibold text-light-text dark:text-dark-text">
            自定义 CLI 配置
          </h2>
          {configs.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium">
              {configs.length}
            </span>
          )}
        </div>
        <IOSButton variant="primary" size="sm" onClick={handleAdd}>
          <Plus className="w-4 h-4" />
          添加配置
        </IOSButton>
      </div>

      {/* 配置列表 */}
      <div className="px-6 py-4">
        <div className="max-w-5xl mx-auto">
          {loading ? (
            <div className="text-center py-16 text-light-text-secondary dark:text-dark-text-secondary">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              加载中...
            </div>
          ) : configs.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <Globe className="w-8 h-8 text-primary-400 dark:text-primary-500" />
              </div>
              <p className="text-light-text dark:text-dark-text font-medium mb-1">暂无自定义配置</p>
              <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary mb-4">
                创建自定义 API 端点，管理不同 CLI 工具的配置
              </p>
              <IOSButton variant="primary" size="sm" onClick={handleAdd}>
                <Plus className="w-4 h-4" />
                添加第一个配置
              </IOSButton>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {configs.map(config => (
                <div
                  key={config.id}
                  className="bg-white dark:bg-dark-card rounded-xl border border-light-border dark:border-dark-border p-4 shadow-sm hover:border-primary-500/40 dark:hover:border-primary-500/30 transition-colors"
                >
                  {/* 卡片头部：名称 + 操作 */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1 mr-3">
                      <h3
                        className="font-semibold text-light-text dark:text-dark-text truncate"
                        title={config.name}
                      >
                        {config.name || '未命名'}
                      </h3>
                      {/* URL 完整显示 + 复制按钮 */}
                      <div className="mt-1 flex items-center gap-1 min-w-0">
                        <div
                          className="flex-1 min-w-0 font-mono text-xs text-light-text-secondary dark:text-dark-text-secondary bg-light-bg dark:bg-dark-bg px-2 py-1 rounded-md truncate"
                          title={config.baseUrl}
                        >
                          {config.baseUrl || '未设置 URL'}
                        </div>
                        {config.baseUrl && <CopyButton text={config.baseUrl} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={e => handleOpenApplyPopover(config, e)}
                        disabled={!hasValidCli(config) || isApplying}
                        className={`p-2 rounded-lg transition-colors ${
                          hasValidCli(config)
                            ? 'text-primary-500 hover:bg-primary-500/10'
                            : 'text-light-text-secondary/30 dark:text-dark-text-secondary/30 cursor-not-allowed'
                        }`}
                        title={hasValidCli(config) ? '应用配置到 CLI' : '请先配置并启用 CLI'}
                      >
                        {isApplying && applyPopoverConfig?.id === config.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleEdit(config)}
                        className="p-2 rounded-lg text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-bg dark:hover:bg-dark-bg transition-colors"
                        title="编辑配置"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(config)}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                        title="删除配置"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* 选中的模型 + 模型数 */}
                  {(() => {
                    const enabledModels = CLI_OPTIONS.filter(
                      opt =>
                        config.cliSettings[opt.key].enabled && config.cliSettings[opt.key].model
                    ).map(opt => config.cliSettings[opt.key].model!);
                    const uniqueModels = [...new Set(enabledModels)];
                    return (
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                          {uniqueModels.map(model => (
                            <span
                              key={model}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400"
                            >
                              {model}
                            </span>
                          ))}
                        </div>
                        {config.models.length > 0 && (
                          <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-md bg-light-bg dark:bg-dark-bg text-light-text-secondary dark:text-dark-text-secondary ml-auto">
                            {config.models.length} 模型
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* CLI 图标 + 名称 */}
                  <div className="flex items-center gap-3 mt-2">
                    {CLI_OPTIONS.map(opt => {
                      const settings = config.cliSettings[opt.key];
                      const isEnabled = settings.enabled && !!settings.model;
                      return (
                        <div
                          key={opt.key}
                          className={`flex items-center gap-1 text-xs ${isEnabled ? 'opacity-100' : 'opacity-30 grayscale'}`}
                          title={
                            isEnabled ? `${opt.name}: ${settings.model}` : `${opt.name}: 未启用`
                          }
                        >
                          <img src={opt.icon} alt={opt.name} className="w-4 h-4 shrink-0" />
                          <span className="text-light-text-secondary dark:text-dark-text-secondary">
                            {opt.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 备注 */}
                  {config.notes && (
                    <div
                      className="mt-2.5 text-xs text-light-text-secondary dark:text-dark-text-secondary line-clamp-2 break-all"
                      title={config.notes}
                    >
                      {config.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 应用 CLI 弹窗 */}
      {applyPopoverConfig && applyPopoverAnchor && (
        <ApplyCliPopover
          config={applyPopoverConfig}
          anchorEl={applyPopoverAnchor}
          onClose={handleCloseApplyPopover}
          onApply={handleApplyToCli}
        />
      )}

      {/* 编辑器对话框 */}
      {editingConfig && (
        <CustomCliConfigEditorDialog
          isOpen={showEditor}
          config={editingConfig}
          onClose={handleEditorClose}
        />
      )}
    </div>
  );
}
