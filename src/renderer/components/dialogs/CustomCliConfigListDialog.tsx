/**
 * @file src/renderer/components/dialogs/CustomCliConfigListDialog.tsx
 * @description 自定义 CLI 配置列表对话框
 *
 * 输入: CustomCliConfigListDialogProps (打开状态、回调)
 * 输出: React 组件 (自定义 CLI 配置列表 UI)
 * 定位: 展示层 - 显示自定义 CLI 配置列表，支持添加/编辑/应用/删除操作
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useEffect, useRef } from 'react';
import { Plus, Settings, Download, Trash2, Edit2, Globe, Loader2 } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import { useCustomCliConfigStore } from '../../store/customCliConfigStore';
import { useDetectionStore } from '../../store/detectionStore';
import { useConfigStore } from '../../store/configStore';
import { toast } from '../../store/toastStore';
import type { CustomCliConfig } from '../../../shared/types/custom-cli-config';
import { CustomCliConfigEditorDialog } from './CustomCliConfigEditorDialog';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
} from '../../services/cli-config-generator';

// 导入 CLI 图标
import ClaudeCodeIcon from '../../assets/cli-icons/claude-code.svg';
import CodexIcon from '../../assets/cli-icons/codex.svg';
import GeminiIcon from '../../assets/cli-icons/gemini.svg';

export interface CustomCliConfigListDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

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

  // 计算位置
  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 4,
        left: rect.left - 100,
      });
    }
  }, [anchorEl]);

  // 点击外部关闭
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

  // 过滤有效的 CLI（已启用且有模型）
  const validCliOptions = CLI_OPTIONS.filter(opt => {
    const settings = config.cliSettings[opt.key];
    return settings.enabled && settings.model;
  });

  return (
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 py-1 min-w-[180px]"
      style={{ top: position.top, left: position.left }}
    >
      {validCliOptions.length === 0 ? (
        <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
          请先配置并启用 CLI
        </div>
      ) : (
        <>
          {/* 合并/覆盖模式切换 */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">应用模式</div>
            <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-slate-600">
              <button
                onClick={() => setApplyMode('merge')}
                className={`flex-1 px-3 py-1 text-xs transition-colors ${
                  applyMode === 'merge'
                    ? 'bg-[var(--ios-blue)] text-white'
                    : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                }`}
              >
                合并
              </button>
              <button
                onClick={() => setApplyMode('overwrite')}
                className={`flex-1 px-3 py-1 text-xs transition-colors ${
                  applyMode === 'overwrite'
                    ? 'bg-[var(--ios-blue)] text-white'
                    : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                }`}
              >
                覆盖
              </button>
            </div>
          </div>
          {/* CLI 选择 */}
          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            选择要应用的 CLI
          </div>
          {validCliOptions.map(option => (
            <button
              key={option.key}
              onClick={() => onApply(option.key, applyMode)}
              className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <img src={option.icon} alt={option.name} className="w-5 h-5" />
              <span className="text-sm text-slate-700 dark:text-slate-300">{option.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * 自定义 CLI 配置列表对话框
 */
export function CustomCliConfigListDialog({ isOpen, onClose }: CustomCliConfigListDialogProps) {
  const { configs, loading, loadConfigs, addConfig, deleteConfig } = useCustomCliConfigStore();
  const { clearCliConfigDetection, detectCliConfig } = useDetectionStore();
  const { config: appConfig } = useConfigStore();

  // 编辑器对话框状态
  const [editingConfig, setEditingConfig] = useState<CustomCliConfig | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  // 应用弹窗状态
  const [applyPopoverConfig, setApplyPopoverConfig] = useState<CustomCliConfig | null>(null);
  const [applyPopoverAnchor, setApplyPopoverAnchor] = useState<HTMLElement | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // 加载配置
  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen, loadConfigs]);

  // 处理添加新配置
  const handleAdd = () => {
    const newConfig = addConfig({ name: '新配置' });
    setEditingConfig(newConfig);
    setShowEditor(true);
  };

  // 处理编辑配置
  const handleEdit = (config: CustomCliConfig) => {
    setEditingConfig(config);
    setShowEditor(true);
  };

  // 处理删除配置
  const handleDelete = async (config: CustomCliConfig) => {
    if (confirm(`确定要删除配置 "${config.name}" 吗？`)) {
      await deleteConfig(config.id);
    }
  };

  // 打开应用弹窗
  const handleOpenApplyPopover = (config: CustomCliConfig, event: React.MouseEvent) => {
    setApplyPopoverConfig(config);
    setApplyPopoverAnchor(event.currentTarget as HTMLElement);
  };

  // 关闭应用弹窗
  const handleCloseApplyPopover = () => {
    setApplyPopoverConfig(null);
    setApplyPopoverAnchor(null);
  };

  // 应用配置到指定 CLI
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
      // 生成配置
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

      // 调用 IPC 写入配置文件
      const result = await (window.electronAPI as any).cliCompat.writeConfig({
        cliType,
        files: filesToWrite,
        applyMode,
      });

      if (result.success) {
        const pathsStr = result.writtenPaths.join(', ');
        toast.success(`${CLI_OPTIONS.find(o => o.key === cliType)?.name} 配置已写入: ${pathsStr}`);

        // 清除 CLI 配置检测缓存并刷新
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

  // 格式化 Base URL 显示
  const formatBaseUrl = (url: string): string => {
    if (!url) return '-';
    const cleaned = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return cleaned.length > 30 ? cleaned.substring(0, 30) + '...' : cleaned;
  };

  // 编辑器关闭回调
  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingConfig(null);
  };

  // 检查配置是否有可应用的 CLI
  const hasValidCli = (config: CustomCliConfig): boolean => {
    return CLI_OPTIONS.some(opt => {
      const settings = config.cliSettings[opt.key];
      return settings.enabled && settings.model;
    });
  };

  return (
    <>
      <IOSModal
        isOpen={isOpen && !showEditor}
        onClose={onClose}
        title="自定义 CLI 配置"
        titleIcon={<Settings className="w-5 h-5" />}
        size="lg"
        contentClassName="!p-0"
        footer={
          <>
            <IOSButton variant="tertiary" onClick={onClose}>
              关闭
            </IOSButton>
            <IOSButton variant="primary" onClick={handleAdd}>
              <Plus className="w-4 h-4" />
              添加配置
            </IOSButton>
          </>
        }
      >
        <div className="px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-[var(--ios-text-secondary)]">加载中...</div>
          ) : configs.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="w-12 h-12 mx-auto mb-3 text-[var(--ios-text-tertiary)]" />
              <p className="text-[var(--ios-text-secondary)] mb-2">暂无自定义配置</p>
              <p className="text-sm text-[var(--ios-text-tertiary)]">
                点击"添加配置"创建自定义 API 端点
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {configs.map(config => (
                <div
                  key={config.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-[var(--ios-separator)] bg-[var(--ios-bg-secondary)]"
                >
                  <div className="w-[140px] shrink-0 mr-3 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-medium text-[var(--ios-text-primary)] truncate"
                        title={config.name}
                      >
                        {config.name || '未命名'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-[var(--ios-text-secondary)] truncate">
                      <span className="truncate max-w-[80px]" title={config.baseUrl}>
                        {formatBaseUrl(config.baseUrl)}
                      </span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{config.models.length} 个模型</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 mr-4">
                    {config.notes && (
                      <div
                        className="text-xs text-[var(--ios-text-tertiary)] line-clamp-2 break-all"
                        title={config.notes}
                      >
                        {config.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => handleOpenApplyPopover(config, e)}
                      disabled={!hasValidCli(config) || isApplying}
                      className={`p-2 rounded-lg transition-colors ${
                        hasValidCli(config)
                          ? 'text-[var(--ios-blue)] hover:bg-[var(--ios-blue)]/10'
                          : 'text-[var(--ios-text-tertiary)] cursor-not-allowed'
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
                      className="p-2 rounded-lg text-[var(--ios-text-secondary)] hover:bg-[var(--ios-bg-tertiary)] transition-colors"
                      title="编辑配置"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(config)}
                      className="p-2 rounded-lg text-[var(--ios-red)] hover:bg-[var(--ios-red)]/10 transition-colors"
                      title="删除配置"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </IOSModal>

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
    </>
  );
}
