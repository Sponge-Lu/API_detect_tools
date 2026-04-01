import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Globe,
  Layers3,
  Loader2,
  PencilLine,
  Plus,
  Settings,
  Trash2,
  Workflow,
} from 'lucide-react';
import { AppButton } from '../components/AppButton/AppButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GeminiIcon from '../assets/cli-icons/gemini.svg';

type CliType = 'claudeCode' | 'codex' | 'geminiCli';
type ApplyMode = 'merge' | 'overwrite';

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

function formatCompactDate(timestamp?: number) {
  if (!timestamp) return '未更新';
  return new Date(timestamp).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getEnabledCliCount(config: CustomCliConfig) {
  return CLI_OPTIONS.filter(option => config.cliSettings[option.key].enabled).length;
}

function getMappedCliOptions(config: CustomCliConfig) {
  return CLI_OPTIONS.filter(option => {
    const settings = config.cliSettings[option.key];
    return settings.enabled && settings.model;
  }).map(option => ({
    ...option,
    model: config.cliSettings[option.key].model as string,
  }));
}

function getMappedCliCount(config: CustomCliConfig) {
  return getMappedCliOptions(config).length;
}

function getMappedModelSlots(configs: CustomCliConfig[]) {
  return configs.reduce((total, config) => total + getMappedCliCount(config), 0);
}

function getEnabledCliSlots(configs: CustomCliConfig[]) {
  return configs.reduce((total, config) => total + getEnabledCliCount(config), 0);
}

function getNotePreview(config: CustomCliConfig) {
  if (!config.notes) return '无备注';
  return config.notes.length > 48 ? `${config.notes.slice(0, 48)}...` : config.notes;
}

function SummaryMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="min-w-[132px] rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] text-[11px] uppercase tracking-[0.08em]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)]"
      title="复制 URL"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-[var(--success)]" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

const handleOpenUrl = async (url: string) => {
  try {
    await window.electronAPI.openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
};

export function CustomCliPage() {
  const { configs, loading, loadConfigs, addConfig, deleteConfig } = useCustomCliConfigStore();
  const { clearCliConfigDetection, detectCliConfig } = useDetectionStore();
  const { config: appConfig } = useConfigStore();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<CustomCliConfig | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<CustomCliConfig | null>(null);
  const [applyMode, setApplyMode] = useState<ApplyMode>('merge');
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (configs.length === 0) {
      setSelectedConfigId(null);
      return;
    }

    if (!selectedConfigId || !configs.some(config => config.id === selectedConfigId)) {
      setSelectedConfigId(configs[0].id);
    }
  }, [configs, selectedConfigId]);

  const selectedConfig = useMemo(
    () => configs.find(config => config.id === selectedConfigId) ?? null,
    [configs, selectedConfigId]
  );

  const summary = useMemo(
    () => ({
      totalConfigs: configs.length,
      enabledCliSlots: getEnabledCliSlots(configs),
      mappedModelSlots: getMappedModelSlots(configs),
    }),
    [configs]
  );

  const handleAdd = () => {
    const newConfig = addConfig({ name: '新配置' });
    setSelectedConfigId(newConfig.id);
    setEditingConfig(newConfig);
    setShowEditor(true);
  };

  const handleEdit = (config: CustomCliConfig) => {
    setSelectedConfigId(config.id);
    setEditingConfig(config);
    setShowEditor(true);
  };

  const handleApplyToCli = async (cliType: CliType) => {
    if (!selectedConfig || isApplying) return;

    const settings = selectedConfig.cliSettings[cliType];
    if (!settings.enabled || !settings.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }

    setIsApplying(true);

    try {
      const params = {
        siteUrl: selectedConfig.baseUrl,
        siteName: selectedConfig.name || '自定义配置',
        apiKey: selectedConfig.apiKey,
        model: settings.model,
      };

      const generatedConfig =
        cliType === 'claudeCode'
          ? generateClaudeCodeConfig(params)
          : cliType === 'codex'
            ? generateCodexConfig(params)
            : generateGeminiCliConfig(params);

      const filesToWrite = generatedConfig.files.map(file => ({
        path: file.path,
        content: file.content,
      }));

      const result = await (window.electronAPI as any).cliCompat.writeConfig({
        cliType,
        files: filesToWrite,
        applyMode,
      });

      if (!result.success) {
        toast.error(`写入失败: ${result.error || '未知错误'}`);
        return;
      }

      const cliLabel = CLI_OPTIONS.find(option => option.key === cliType)?.name || cliType;
      toast.success(`${cliLabel} 配置已写入: ${result.writtenPaths.join(', ')}`);

      try {
        await window.electronAPI.configDetection.clearCache();
      } catch (error) {
        console.error('清除 CLI 配置缓存失败:', error);
      }

      clearCliConfigDetection();

      const siteInfos = (appConfig?.sites || [])
        .filter((site: { url?: string }) => site.url)
        .map((site: { name: string; url?: string }) => ({
          id: site.name,
          name: site.name,
          url: site.url!,
        }));

      detectCliConfig(siteInfos).catch(error => {
        console.error('CLI 配置检测刷新失败:', error);
      });

      if (cliType === 'claudeCode') {
        setTimeout(() => {
          toast.info('使用 Claude Code for VS Code 需重启 IDE 编辑器');
        }, 1200);
      }
    } catch (error: any) {
      toast.error(`应用配置失败: ${error.message || '未知错误'}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteCandidate) return;
    await deleteConfig(deleteCandidate.id);
    setDeleteCandidate(null);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditingConfig(null);
  };

  const selectedMappedCli = selectedConfig ? getMappedCliOptions(selectedConfig) : [];
  const selectedEnabledCli = selectedConfig ? getEnabledCliCount(selectedConfig) : 0;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <div className="border-b border-[var(--line-soft)] px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <Settings className="h-5 w-5 text-[var(--text-secondary)]" />
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  自定义 CLI 配置
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  用注册表方式管理自定义端点，把编辑、检查和应用收敛到同一工作区。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <SummaryMetric
                label="配置总数"
                value={summary.totalConfigs}
                icon={<Layers3 className="h-3.5 w-3.5" />}
              />
              <SummaryMetric
                label="启用 CLI"
                value={summary.enabledCliSlots}
                icon={<Workflow className="h-3.5 w-3.5" />}
              />
              <SummaryMetric
                label="已映射模型"
                value={summary.mappedModelSlots}
                icon={<Download className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
          <AppButton variant="primary" size="sm" onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            添加配置
          </AppButton>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-[var(--text-secondary)]">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
            <p>加载中...</p>
          </div>
        </div>
      ) : configs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-[420px] rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-8 py-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[20px] bg-[var(--surface-2)]">
              <Globe className="h-8 w-8 text-[var(--text-tertiary)]" />
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">暂无自定义配置</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              先创建一个自定义端点，再通过右侧工作区统一完成模型映射与 CLI 应用。
            </p>
            <div className="mt-5">
              <AppButton variant="primary" size="sm" onClick={handleAdd}>
                <Plus className="h-4 w-4" />
                添加第一个配置
              </AppButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 p-4">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    配置注册表
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    默认视图用于快速比对名称、端点、模型覆盖和更新时间，不再使用卡片墙。
                  </p>
                </div>
                <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)]">
                  {configs.length} 项
                </span>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_100px_84px_110px] gap-3 border-b border-[var(--line-soft)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              <span>配置</span>
              <span>Base URL</span>
              <span>CLI</span>
              <span>模型</span>
              <span>更新</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {configs.map(config => {
                const isSelected = config.id === selectedConfigId;
                const enabledCliCount = getEnabledCliCount(config);
                const mappedCliCount = getMappedCliCount(config);

                return (
                  <div
                    key={config.id}
                    className={`grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_100px_84px_110px] gap-3 border-b border-[var(--line-soft)]/80 px-4 py-3 transition-colors ${
                      isSelected ? 'bg-[var(--accent)]/8' : 'hover:bg-[var(--surface-2)]/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedConfigId(config.id)}
                      className="min-w-0 text-left"
                    >
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {config.name || '未命名配置'}
                      </div>
                      <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                        {getNotePreview(config)}
                      </div>
                    </button>

                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => config.baseUrl && handleOpenUrl(config.baseUrl)}
                        className={`max-w-full truncate text-left font-mono text-xs ${
                          config.baseUrl
                            ? 'text-[var(--accent)] hover:underline'
                            : 'text-[var(--text-tertiary)]'
                        }`}
                        title={config.baseUrl || '未设置 URL'}
                      >
                        {config.baseUrl || '未设置 URL'}
                      </button>
                    </div>

                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {enabledCliCount}
                    </div>

                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {mappedCliCount}
                    </div>

                    <div className="text-xs text-[var(--text-secondary)]">
                      {formatCompactDate(config.updatedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="flex min-h-0 w-[360px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">工作区</h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    选中一项后在此检查映射、复制端点、应用到 CLI 或继续编辑。
                  </p>
                </div>
                {selectedConfig && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleEdit(selectedConfig)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)]"
                      title="编辑配置"
                    >
                      <PencilLine className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteCandidate(selectedConfig)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                      title="删除配置"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {selectedConfig ? (
                <div className="space-y-4">
                  <section className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-[var(--text-primary)]">
                          {selectedConfig.name || '未命名配置'}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          最近更新 {formatCompactDate(selectedConfig.updatedAt)}
                        </div>
                      </div>
                      {selectedConfig.baseUrl && <CopyButton text={selectedConfig.baseUrl} />}
                    </div>

                    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        Base URL
                      </div>
                      <button
                        type="button"
                        onClick={() => selectedConfig.baseUrl && handleOpenUrl(selectedConfig.baseUrl)}
                        className={`mt-1 block max-w-full truncate text-left font-mono text-xs ${
                          selectedConfig.baseUrl
                            ? 'text-[var(--accent)] hover:underline'
                            : 'text-[var(--text-tertiary)]'
                        }`}
                      >
                        {selectedConfig.baseUrl || '未设置 URL'}
                      </button>
                    </div>
                  </section>

                  <section className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        配置摘要
                      </h4>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {selectedEnabledCli} 个启用 CLI
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                          可用模型
                        </div>
                        <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                          {selectedConfig.models.length}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                          已映射
                        </div>
                        <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                          {selectedMappedCli.length}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        CLI 映射
                      </h4>
                      <span className="text-xs text-[var(--text-secondary)]">注册表优先</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {CLI_OPTIONS.map(option => {
                        const settings = selectedConfig.cliSettings[option.key];
                        const isActive = settings.enabled && settings.model;

                        return (
                          <div
                            key={option.key}
                            className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-2.5"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <img src={option.icon} alt={option.name} className="h-4 w-4 shrink-0" />
                                <span className="text-sm text-[var(--text-primary)]">
                                  {option.name}
                                </span>
                              </div>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  isActive
                                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                    : 'bg-[var(--surface-1)] text-[var(--text-secondary)]'
                                }`}
                              >
                                {isActive ? '已映射' : settings.enabled ? '待配置' : '未启用'}
                              </span>
                            </div>
                            <div className="mt-2 truncate font-mono text-xs text-[var(--text-secondary)]">
                              {settings.model || '未选择模型'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                        应用到 CLI
                      </h4>
                      <div className="inline-flex rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] p-1">
                        <button
                          type="button"
                          onClick={() => setApplyMode('merge')}
                          className={`rounded-[calc(var(--radius-md)-4px)] px-2.5 py-1 text-xs font-medium transition-colors ${
                            applyMode === 'merge'
                              ? 'bg-[var(--accent)] text-white'
                              : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          合并
                        </button>
                        <button
                          type="button"
                          onClick={() => setApplyMode('overwrite')}
                          className={`rounded-[calc(var(--radius-md)-4px)] px-2.5 py-1 text-xs font-medium transition-colors ${
                            applyMode === 'overwrite'
                              ? 'bg-[var(--accent)] text-white'
                              : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          覆盖
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedMappedCli.length === 0 ? (
                        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-3 text-sm text-[var(--text-secondary)]">
                          当前配置还没有可应用的 CLI，请先在编辑器中启用并选择模型。
                        </div>
                      ) : (
                        selectedMappedCli.map(option => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => void handleApplyToCli(option.key)}
                            disabled={isApplying}
                            className="flex w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-3)] px-3 py-2.5 text-left transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="flex items-center gap-2">
                              <img src={option.icon} alt={option.name} className="h-4 w-4 shrink-0" />
                              <div>
                                <div className="text-sm font-medium text-[var(--text-primary)]">
                                  {option.name}
                                </div>
                                <div className="font-mono text-xs text-[var(--text-secondary)]">
                                  {option.model}
                                </div>
                              </div>
                            </div>
                            {isApplying ? (
                              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
                            ) : (
                              <Download className="h-4 w-4 text-[var(--text-secondary)]" />
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3.5 py-3">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">备注</h4>
                    <p className="mt-2 whitespace-pre-wrap break-all text-sm leading-6 text-[var(--text-secondary)]">
                      {selectedConfig.notes || '暂无备注'}
                    </p>
                  </section>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      )}

      {editingConfig && (
        <CustomCliConfigEditorDialog
          isOpen={showEditor}
          config={editingConfig}
          onClose={handleEditorClose}
        />
      )}

      <ConfirmDialog
        isOpen={deleteCandidate !== null}
        type="warning"
        title="删除自定义配置"
        message={`确定要删除配置 "${deleteCandidate?.name || ''}" 吗？`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={() => void handleDeleteConfirmed()}
        onCancel={() => setDeleteCandidate(null)}
      />
    </div>
  );
}
