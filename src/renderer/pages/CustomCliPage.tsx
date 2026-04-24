import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Copy, Globe, Loader2, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { AppButton } from '../components/AppButton/AppButton';
import { PageHeader } from '../components/AppShell/PageHeader';
import { APP_PAGE_META } from '../components/AppShell/pageMeta';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useCustomCliConfigStore } from '../store/customCliConfigStore';
import { useDetectionStore } from '../store/detectionStore';
import { toast } from '../store/toastStore';
import type { ClaudeTestDetail, CodexTestDetail, GeminiTestDetail } from '../store/detectionStore';
import {
  createEmptyCustomCliTestState,
  normalizeCustomCliTestState,
  type CustomCliConfig,
  type CustomCliTestState,
} from '../../shared/types/custom-cli-config';
import {
  generateClaudeCodeConfig,
  generateCodexConfig,
  generateGeminiCliConfig,
  type GeneratedConfig,
} from '../services/cli-config-generator';
import ClaudeCodeIcon from '../assets/cli-icons/claude-code.svg';
import CodexIcon from '../assets/cli-icons/codex.svg';
import GeminiIcon from '../assets/cli-icons/gemini.svg';
import {
  buildCliCompatibilityTooltip,
  getCliCompatibilityIconClass,
} from '../components/CliCompatibilityIcons/cliCompatibilityMeta';

type CliType = 'claudeCode' | 'codex' | 'geminiCli';

interface CliOption {
  key: CliType;
  name: string;
  icon: string;
  sizeClass: string;
}

type ConfigCliTestState = Record<CliType, CustomCliTestState>;
type EditedPreviewById = Record<string, Partial<Record<CliType, GeneratedConfig | null>>>;

interface PreviewState {
  cliType: CliType;
  isEditing: boolean;
  draft: GeneratedConfig | null;
}

interface CustomCliPageProps {
  runCliTests?: (
    config: CustomCliConfig,
    cliType: CliType,
    models: string[]
  ) => Promise<CustomCliTestState>;
}

const CLI_OPTIONS: CliOption[] = [
  { key: 'claudeCode', name: 'Claude Code', icon: ClaudeCodeIcon, sizeClass: 'h-[18px] w-[18px]' },
  { key: 'codex', name: 'Codex', icon: CodexIcon, sizeClass: 'h-5 w-5' },
  { key: 'geminiCli', name: 'Gemini CLI', icon: GeminiIcon, sizeClass: 'h-5 w-5' },
];
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const CONFIG_TABLE_GRID_CLASS = 'grid-cols-[96px_minmax(0,1.2fr)_76px_minmax(0,1fr)]';

async function openExternalUrl(url: string): Promise<void> {
  try {
    if (window.electronAPI?.openUrl) {
      await window.electronAPI.openUrl(url);
      return;
    }
  } catch {
    // Fall back to the browser runtime when the Electron bridge is unavailable.
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault();
  event.stopPropagation();
  void openExternalUrl(url);
}

function renderExternalLink(label: string, href: string, linkClassName: string): ReactNode {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={event => handleExternalLinkClick(event, href)}
      className={linkClassName}
    >
      {label}
    </a>
  );
}

function createEmptyConfigTestState(): ConfigCliTestState {
  return {
    claudeCode: createEmptyCustomCliTestState(),
    codex: createEmptyCustomCliTestState(),
    geminiCli: createEmptyCustomCliTestState(),
  };
}

function buildGeneratedConfig(
  config: CustomCliConfig,
  cliType: CliType,
  testState?: CustomCliTestState
): GeneratedConfig | null {
  const setting = config.cliSettings[cliType];
  if (!setting.model || !config.baseUrl || !config.apiKey) return null;

  const params = {
    siteUrl: config.baseUrl,
    siteName: config.name || '自定义配置',
    apiKey: config.apiKey,
    model: setting.model,
  };

  if (cliType === 'claudeCode') {
    return generateClaudeCodeConfig(params);
  }
  if (cliType === 'codex') {
    return generateCodexConfig({
      ...params,
      codexDetail: testState?.codexDetail,
    });
  }
  return generateGeminiCliConfig({
    ...params,
    geminiDetail: testState?.geminiDetail,
  });
}

function inferConfigLanguage(path: string): 'json' | 'toml' {
  return path.endsWith('.toml') || path.endsWith('.env') ? 'toml' : 'json';
}

function normalizeCodexProviderContent(content: string): string {
  return content
    .replace(/^model_provider = ".*"$/m, 'model_provider = "OpenAI"')
    .replace(/^\[model_providers\.[^\]]+\]$/m, '[model_providers.OpenAI]');
}

function normalizeResolvedConfig(
  cliType: CliType,
  config: GeneratedConfig | null | undefined
): GeneratedConfig | null | undefined {
  if (!config || cliType !== 'codex') {
    return config;
  }

  return {
    files: config.files.map(file =>
      file.path.endsWith('/.codex/config.toml') || file.path === '~/.codex/config.toml'
        ? {
            ...file,
            content: normalizeCodexProviderContent(file.content),
          }
        : file
    ),
  };
}

function resolveEffectiveConfig(
  config: CustomCliConfig,
  cliType: CliType,
  editedPreview: GeneratedConfig | null | undefined,
  testState?: CustomCliTestState
): GeneratedConfig | null {
  const normalizedEditedPreview = normalizeResolvedConfig(cliType, editedPreview);
  if (normalizedEditedPreview) {
    return normalizedEditedPreview;
  }

  const generated = buildGeneratedConfig(config, cliType, testState);
  const storedEditedFiles = config.cliSettings[cliType].editedFiles;
  if (storedEditedFiles && storedEditedFiles.length > 0) {
    return normalizeResolvedConfig(cliType, {
      files: storedEditedFiles.map(file => ({
        path: file.path,
        content: file.content,
        language:
          generated?.files.find(generatedFile => generatedFile.path === file.path)?.language ??
          inferConfigLanguage(file.path),
      })),
    })!;
  }

  return normalizeResolvedConfig(cliType, generated) ?? null;
}

function getSelectValue(values: string[] | undefined, index: number): string {
  return values?.[index] ?? '';
}

function renderLinkedText(text: string | undefined, linkClassName: string) {
  if (!text) return null;

  const parts = text.split(URL_PATTERN);
  return parts.map((part, index) => {
    if (part.match(URL_PATTERN)) {
      return <span key={`${part}-${index}`}>{renderExternalLink(part, part, linkClassName)}</span>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function renderConfigName(config: CustomCliConfig, linkClassName: string): ReactNode {
  const name = config.name || '未命名配置';

  if (name.match(URL_PATTERN)) {
    return renderLinkedText(name, linkClassName);
  }

  if (config.baseUrl) {
    return renderExternalLink(name, config.baseUrl, linkClassName);
  }

  return <span>{name}</span>;
}

function FormSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[24px] w-[44px] shrink-0 rounded-full border-2 transition-colors ${
        checked
          ? 'border-[var(--accent)] bg-[var(--accent)]'
          : 'border-[var(--line-soft)] bg-[var(--line-soft)]'
      }`}
    >
      <span
        className={`mt-[1px] inline-block h-[18px] w-[18px] rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)] transition-transform ${
          checked ? 'translate-x-[21px]' : 'translate-x-[1px]'
        }`}
      />
    </button>
  );
}

function ConfigPreviewModal({
  config,
  previewState,
  displayConfig,
  onClose,
  onEdit,
  onChangeFile,
  onSaveEdit,
  onCancelEdit,
  onReset,
}: {
  config: CustomCliConfig;
  previewState: PreviewState | null;
  displayConfig: GeneratedConfig | null;
  onClose: () => void;
  onEdit: () => void;
  onChangeFile: (path: string, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReset: () => void;
}) {
  if (!previewState) return null;

  const title = `${CLI_OPTIONS.find(option => option.key === previewState.cliType)?.name || previewState.cliType} 配置预览`;

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/45 p-6">
      <div
        role="dialog"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-[980px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)]"
      >
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {config.name || '未命名配置'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {previewState.isEditing ? (
              <>
                <AppButton variant="tertiary" size="sm" onClick={onCancelEdit}>
                  取消
                </AppButton>
                <AppButton variant="primary" size="sm" onClick={onSaveEdit}>
                  保存
                </AppButton>
              </>
            ) : (
              <>
                <AppButton variant="tertiary" size="sm" onClick={onReset}>
                  <RotateCcw className="h-4 w-4" />
                  重置
                </AppButton>
                <AppButton variant="secondary" size="sm" onClick={onEdit}>
                  编辑
                </AppButton>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)]"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {displayConfig ? (
            displayConfig.files.map(file => (
              <div
                key={file.path}
                className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-soft)]"
              >
                <div className="flex items-center justify-between border-b border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <code className="text-sm text-[var(--text-primary)]">{file.path}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(file.content);
                      toast.success('配置内容已复制');
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)]"
                    title="复制配置内容"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                {previewState.isEditing ? (
                  <textarea
                    aria-label={file.path}
                    value={file.content}
                    onChange={event => onChangeFile(file.path, event.target.value)}
                    className="min-h-[280px] w-full resize-y border-none bg-[var(--code-bg)] px-4 py-3 font-mono text-sm text-[var(--code-text)] focus:outline-none"
                    spellCheck={false}
                  />
                ) : (
                  <pre className="min-h-[280px] overflow-auto bg-[var(--code-bg)] px-4 py-3 text-sm text-[var(--code-text)]">
                    <code>{file.content}</code>
                  </pre>
                )}
              </div>
            ))
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-10 text-center text-sm text-[var(--text-secondary)]">
              请先填写 Base URL、API Key 并为当前 CLI 选择模型。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CustomCliPage({ runCliTests }: CustomCliPageProps = {}) {
  const {
    configs,
    loading,
    loadConfigs,
    addConfig,
    deleteConfig,
    updateConfig,
    saveConfigs,
    fetchModels,
    fetchingModels,
  } = useCustomCliConfigStore();
  const { clearCliConfigDetection } = useDetectionStore();

  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<CustomCliConfig | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [editedPreviews, setEditedPreviews] = useState<EditedPreviewById>({});
  const [testingCli, setTestingCli] = useState<Record<string, Partial<Record<CliType, boolean>>>>(
    {}
  );
  const [applyMenuCliType, setApplyMenuCliType] = useState<CliType | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (configs.length === 0) {
      setSelectedConfigId(null);
      setPreviewState(null);
      setApplyMenuCliType(null);
      setShowApiKey(false);
      return;
    }

    setSelectedConfigId(current =>
      current && configs.some(config => config.id === current) ? current : configs[0].id
    );
  }, [configs]);

  useEffect(() => {
    setShowApiKey(false);
  }, [selectedConfigId]);

  const selectedConfig = useMemo(
    () => configs.find(config => config.id === selectedConfigId) ?? null,
    [configs, selectedConfigId]
  );

  const currentTestState = selectedConfig
    ? {
        claudeCode: normalizeCustomCliTestState(selectedConfig.cliSettings.claudeCode.testState),
        codex: normalizeCustomCliTestState(selectedConfig.cliSettings.codex.testState),
        geminiCli: normalizeCustomCliTestState(selectedConfig.cliSettings.geminiCli.testState),
      }
    : createEmptyConfigTestState();

  const currentEditedPreviews = selectedConfig ? (editedPreviews[selectedConfig.id] ?? {}) : {};

  const previewDisplayConfig =
    selectedConfig && previewState
      ? resolveEffectiveConfig(
          selectedConfig,
          previewState.cliType,
          previewState.draft ?? currentEditedPreviews[previewState.cliType],
          currentTestState[previewState.cliType]
        )
      : null;

  const isFetchingModels = selectedConfig ? fetchingModels[selectedConfig.id] || false : false;

  const persistConfigPatch = (patch: Partial<CustomCliConfig>) => {
    if (!selectedConfig) return;
    updateConfig(selectedConfig.id, patch);
  };

  const persistCliSettingPatch = (
    cliType: CliType,
    patch: Partial<CustomCliConfig['cliSettings'][CliType]>
  ) => {
    if (!selectedConfig) return;
    persistConfigPatch({
      cliSettings: {
        ...selectedConfig.cliSettings,
        [cliType]: {
          ...selectedConfig.cliSettings[cliType],
          ...patch,
        },
      },
    });
  };

  const handleSaveConfig = async () => {
    await saveConfigs();
    toast.success('配置已保存');
  };

  const handleAdd = async () => {
    const newConfig = addConfig({ name: '新配置' });
    setSelectedConfigId(newConfig.id);
    await saveConfigs();
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteCandidate) return;
    await deleteConfig(deleteCandidate.id);
    setDeleteCandidate(null);
  };

  const handleFetchModels = async () => {
    if (!selectedConfig) return;
    await fetchModels(selectedConfig.id);
  };

  const handleUpdateTestModel = (cliType: CliType, slotIndex: number, value: string) => {
    if (!selectedConfig) return;
    const current = [...(selectedConfig.cliSettings[cliType].testModels ?? [])];
    current[slotIndex] = value;
    const sanitized = current
      .map(model => model?.trim() ?? '')
      .filter(Boolean)
      .slice(0, 3);
    persistCliSettingPatch(cliType, { testModels: sanitized });
  };

  const defaultRunCliTests = async (
    config: CustomCliConfig,
    cliType: CliType,
    models: string[]
  ): Promise<CustomCliTestState> => {
    const slots = createEmptyCustomCliTestState().slots;
    let allSuccess = models.length > 0;
    let testedAt: number | null = null;
    let claudeDetail: ClaudeTestDetail | undefined;
    let codexDetail: CodexTestDetail | undefined;
    let geminiDetail: GeminiTestDetail | undefined;

    for (const [index, model] of models.entries()) {
      try {
        const response = await window.electronAPI.cliCompat.testWithWrapper({
          siteUrl: config.baseUrl,
          configs: [
            {
              cliType,
              apiKey: config.apiKey,
              model,
              baseUrl: config.baseUrl,
            },
          ],
        });

        const success = response.success && response.data?.[cliType] === true;
        testedAt = Date.now();
        slots[index] = {
          model,
          success,
          message: success ? undefined : (response.error ?? '未通过'),
          timestamp: testedAt,
        };
        if (!success) allSuccess = false;
        if (response.data?.claudeDetail) claudeDetail = response.data.claudeDetail;
        if (response.data?.codexDetail) codexDetail = response.data.codexDetail;
        if (response.data?.geminiDetail) geminiDetail = response.data.geminiDetail;
      } catch (error: unknown) {
        testedAt = Date.now();
        slots[index] = {
          model,
          success: false,
          message: error instanceof Error ? error.message : '测试失败',
          timestamp: testedAt,
        };
        allSuccess = false;
      }
    }

    return {
      status: models.length > 0 ? allSuccess : null,
      testedAt,
      claudeDetail,
      codexDetail,
      geminiDetail,
      slots,
    };
  };

  const executeCliTests = runCliTests ?? defaultRunCliTests;

  const handleRunCliTests = async (cliType: CliType) => {
    if (!selectedConfig) return;
    if (!selectedConfig.baseUrl || !selectedConfig.apiKey) {
      toast.error('请先填写 Base URL 和 API Key');
      return;
    }

    const models = (selectedConfig.cliSettings[cliType].testModels ?? [])
      .filter(Boolean)
      .slice(0, 3);
    if (models.length === 0) {
      toast.error('请先为该 CLI 选择测试模型');
      return;
    }

    setTestingCli(prev => ({
      ...prev,
      [selectedConfig.id]: {
        ...(prev[selectedConfig.id] ?? {}),
        [cliType]: true,
      },
    }));

    try {
      const result = await executeCliTests(selectedConfig, cliType, models);
      persistCliSettingPatch(cliType, { testState: result });
      await saveConfigs();

      if (result.status) {
        toast.success(`${CLI_OPTIONS.find(option => option.key === cliType)?.name} 测试通过`);
      } else {
        toast.error(`${CLI_OPTIONS.find(option => option.key === cliType)?.name} 测试未全部通过`);
      }

      clearCliConfigDetection();
    } finally {
      setTestingCli(prev => ({
        ...prev,
        [selectedConfig.id]: {
          ...(prev[selectedConfig.id] ?? {}),
          [cliType]: false,
        },
      }));
    }
  };

  const handleOpenPreview = (cliType: CliType) => {
    setApplyMenuCliType(null);
    setPreviewState({
      cliType,
      isEditing: false,
      draft: null,
    });
  };

  const handlePreviewChange = (path: string, content: string) => {
    setPreviewState(prev => {
      if (!prev || !previewDisplayConfig) return prev;
      const nextDraft = prev.draft ?? {
        files: previewDisplayConfig.files.map(file => ({ ...file })),
      };
      return {
        ...prev,
        draft: {
          files: nextDraft.files.map(file => (file.path === path ? { ...file, content } : file)),
        },
      };
    });
  };

  const handlePreviewSave = () => {
    if (!selectedConfig || !previewState?.draft) return;
    const nextEdited = {
      ...(editedPreviews[selectedConfig.id] ?? {}),
      [previewState.cliType]: previewState.draft,
    };
    setEditedPreviews(prev => ({
      ...prev,
      [selectedConfig.id]: nextEdited,
    }));

    persistCliSettingPatch(previewState.cliType, {
      editedFiles: previewState.draft.files.map(file => ({
        path: file.path,
        content: file.content,
      })),
    });

    setPreviewState(prev => (prev ? { ...prev, isEditing: false, draft: null } : null));
  };

  const handlePreviewReset = () => {
    if (!selectedConfig || !previewState) return;
    setEditedPreviews(prev => ({
      ...prev,
      [selectedConfig.id]: {
        ...(prev[selectedConfig.id] ?? {}),
        [previewState.cliType]: null,
      },
    }));
    persistCliSettingPatch(previewState.cliType, { editedFiles: null });
    setPreviewState(prev => (prev ? { ...prev, isEditing: false, draft: null } : null));
  };

  const handlePreviewEdit = () => {
    if (!previewDisplayConfig) return;
    setPreviewState(prev =>
      prev
        ? {
            ...prev,
            isEditing: true,
            draft: {
              files: previewDisplayConfig.files.map(file => ({ ...file })),
            },
          }
        : prev
    );
  };

  const handleApplyCliConfig = async (cliType: CliType, applyMode: 'merge' | 'overwrite') => {
    if (!selectedConfig) return;

    const setting = selectedConfig.cliSettings[cliType];
    if (!selectedConfig.baseUrl || !selectedConfig.apiKey) {
      toast.error('请先填写 Base URL 和 API Key');
      return;
    }
    if (!setting.enabled || !setting.model) {
      toast.error('该 CLI 未启用或未选择模型');
      return;
    }

    const effectiveConfig = resolveEffectiveConfig(
      selectedConfig,
      cliType,
      currentEditedPreviews[cliType],
      currentTestState[cliType]
    );
    if (!effectiveConfig) {
      toast.error('请先填写 Base URL、API Key 并选择模型');
      return;
    }

    try {
      const result = await window.electronAPI.cliCompat.writeConfig({
        cliType,
        files: effectiveConfig.files.map(file => ({
          path: file.path,
          content: file.content,
        })),
        applyMode,
      });

      if (!result.success) {
        toast.error(`写入失败: ${result.error || '未知错误'}`);
        return;
      }

      setApplyMenuCliType(null);
      await window.electronAPI.configDetection.clearCache(cliType);
      clearCliConfigDetection();
      toast.success(`${CLI_OPTIONS.find(option => option.key === cliType)?.name} 配置已写入本地`);

      if (cliType === 'claudeCode') {
        setTimeout(() => {
          toast.info('使用 Claude Code for VS Code 需重启 IDE 编辑器');
        }, 1500);
      }
    } catch (error: unknown) {
      toast.error(`应用配置失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <PageHeader
        title={APP_PAGE_META.cli.title}
        description={APP_PAGE_META.cli.description}
        actions={
          <AppButton variant="primary" size="sm" onClick={() => void handleAdd()}>
            <Plus className="h-4 w-4" />
            添加配置
          </AppButton>
        }
      />

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
            <div className="mt-5">
              <AppButton variant="primary" size="sm" onClick={() => void handleAdd()}>
                <Plus className="h-4 w-4" />
                添加第一个配置
              </AppButton>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-4 p-4">
          <section className="flex min-h-0 flex-[0_0_48%] flex-col overflow-hidden border border-[var(--line-soft)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">配置表</h3>
                <span className="text-xs text-[var(--text-secondary)]">{configs.length} 项</span>
              </div>
            </div>

            <div
              className={`grid ${CONFIG_TABLE_GRID_CLASS} gap-3 border-b border-[var(--line-soft)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]`}
            >
              <span>名称</span>
              <span>BaseURL</span>
              <span>CLI测试</span>
              <span>备注</span>
            </div>

            <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {configs.map(config => (
                <div
                  key={config.id}
                  role="row"
                  data-selected={config.id === selectedConfigId ? 'true' : 'false'}
                  onClick={() => {
                    setSelectedConfigId(config.id);
                    setApplyMenuCliType(null);
                  }}
                  className={`grid cursor-pointer ${CONFIG_TABLE_GRID_CLASS} gap-3 border-b border-l-2 border-[var(--line-soft)]/80 border-l-transparent px-4 py-3 transition-colors ${
                    config.id === selectedConfigId
                      ? 'border-l-[var(--accent)] bg-[var(--accent-soft-strong)] shadow-[inset_4px_0_0_var(--accent)]'
                      : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="min-w-0 truncate text-sm font-semibold text-[var(--text-primary)]">
                    {renderConfigName(
                      config,
                      'text-[var(--accent-strong)] underline underline-offset-2 hover:text-[var(--accent)]'
                    )}
                  </div>
                  <div className="min-w-0 truncate font-mono text-xs text-[var(--text-secondary)]">
                    {config.baseUrl || '未设置 URL'}
                  </div>
                  <div className="flex items-center justify-start gap-1">
                    {CLI_OPTIONS.map(option => {
                      const setting = config.cliSettings[option.key];
                      const configured = Boolean(setting.enabled && setting.model);
                      const testState = normalizeCustomCliTestState(setting.testState);
                      const tooltip = buildCliCompatibilityTooltip({
                        name: option.name,
                        enabled: setting.enabled,
                        configured,
                        status: testState.status,
                        testedAt: testState.testedAt,
                        claudeDetail: testState.claudeDetail,
                        codexDetail: testState.codexDetail,
                        geminiDetail: testState.geminiDetail,
                      });

                      return (
                        <span
                          key={option.key}
                          title={tooltip}
                          className={`${option.sizeClass} inline-flex items-center justify-center ${getCliCompatibilityIconClass(
                            {
                              enabled: setting.enabled,
                              configured,
                              status: testState.status,
                            }
                          )}`}
                        >
                          <img src={option.icon} alt={option.name} className="h-full w-full" />
                        </span>
                      );
                    })}
                  </div>
                  <div className="min-w-0 truncate text-xs text-[var(--text-secondary)]">
                    {renderLinkedText(
                      config.notes || '--',
                      'text-[var(--accent-strong)] underline underline-offset-2 hover:text-[var(--accent)]'
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[var(--line-soft)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--line-soft)] px-4 py-3">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">配置编辑</h3>
                {selectedConfig ? (
                  <div className="flex items-center gap-2">
                    <AppButton
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleSaveConfig()}
                    >
                      <Save className="h-4 w-4" />
                      保存配置
                    </AppButton>
                    <button
                      type="button"
                      onClick={() => setDeleteCandidate(selectedConfig)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/10"
                      title="删除配置"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {selectedConfig ? (
                <div className="flex min-h-full flex-col gap-3">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        配置名称
                      </span>
                      <input
                        type="text"
                        value={selectedConfig.name}
                        onChange={event => persistConfigPatch({ name: event.target.value })}
                        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        Base URL
                      </span>
                      <input
                        type="url"
                        value={selectedConfig.baseUrl}
                        onChange={event => persistConfigPatch({ baseUrl: event.target.value })}
                        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        API Key
                      </span>
                      <div className="flex items-stretch gap-2">
                        <input
                          aria-label="API Key"
                          type={showApiKey ? 'text' : 'password'}
                          value={selectedConfig.apiKey}
                          onChange={event => persistConfigPatch({ apiKey: event.target.value })}
                          className="h-9 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-primary)]"
                        />
                        <AppButton
                          variant="secondary"
                          size="md"
                          className="h-9 shrink-0 px-3"
                          aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                          onClick={() => setShowApiKey(current => !current)}
                        >
                          {showApiKey ? '隐藏' : '显示'}
                        </AppButton>
                      </div>
                    </label>
                    <div className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        模型
                      </span>
                      <div className="flex items-stretch gap-2">
                        <div className="flex h-9 min-w-0 flex-1 items-center rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3">
                          <p className="truncate text-sm text-[var(--text-secondary)]">
                            {selectedConfig.models.length > 0
                              ? `已拉取 ${selectedConfig.models.length} 个模型`
                              : '尚未拉取模型'}
                          </p>
                        </div>
                        <AppButton
                          variant="secondary"
                          size="md"
                          className="h-9 shrink-0 px-4"
                          aria-label="拉取"
                          onClick={() => void handleFetchModels()}
                          disabled={
                            isFetchingModels || !selectedConfig.baseUrl || !selectedConfig.apiKey
                          }
                        >
                          {isFetchingModels ? (
                            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw aria-hidden="true" className="h-4 w-4" />
                          )}
                          拉取
                        </AppButton>
                      </div>
                    </div>
                    <label className="col-span-2 block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        备注
                      </span>
                      <input
                        type="text"
                        value={selectedConfig.notes ?? ''}
                        onChange={event => persistConfigPatch({ notes: event.target.value })}
                        className="w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-primary)]"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">CLI 配置</h4>
                    <div className="space-y-1">
                      {CLI_OPTIONS.map(option => {
                        const setting = selectedConfig.cliSettings[option.key];
                        return (
                          <div
                            key={option.key}
                            data-cli-config-row={option.key}
                            className={`grid min-w-0 grid-cols-[minmax(0,128px)_44px_minmax(0,1fr)_68px_68px] items-center gap-1.5 px-1 py-0.5 transition-opacity ${
                              setting.enabled ? '' : 'opacity-60'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <img
                                src={option.icon}
                                alt={option.name}
                                className={option.sizeClass}
                              />
                              <span className="truncate text-sm text-[var(--text-primary)]">
                                {option.name}
                              </span>
                            </div>
                            <FormSwitch
                              checked={setting.enabled}
                              onChange={checked =>
                                persistCliSettingPatch(option.key, { enabled: checked })
                              }
                            />
                            <select
                              value={setting.model ?? ''}
                              onChange={event =>
                                persistCliSettingPatch(option.key, {
                                  model: event.target.value || null,
                                })
                              }
                              disabled={!setting.enabled}
                              className="min-w-0 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
                            >
                              <option value="">选择模型</option>
                              {selectedConfig.models.map(model => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                            <AppButton
                              variant="secondary"
                              size="sm"
                              className="h-8 w-[68px] min-w-0 shrink-0 px-2"
                              onClick={() => handleOpenPreview(option.key)}
                              disabled={!setting.enabled}
                            >
                              预览
                            </AppButton>
                            <div className="relative min-w-0 shrink-0">
                              <AppButton
                                variant="secondary"
                                size="sm"
                                className="h-8 w-[68px] min-w-0 shrink-0 px-2"
                                onClick={() =>
                                  setApplyMenuCliType(current =>
                                    current === option.key ? null : option.key
                                  )
                                }
                                disabled={
                                  !selectedConfig.baseUrl ||
                                  !selectedConfig.apiKey ||
                                  !setting.enabled ||
                                  !setting.model
                                }
                              >
                                应用
                              </AppButton>
                              {applyMenuCliType === option.key ? (
                                <div className="absolute right-0 top-[calc(100%+6px)] z-10 flex w-[112px] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-lg)]">
                                  <button
                                    type="button"
                                    className="px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)]"
                                    onClick={() => void handleApplyCliConfig(option.key, 'merge')}
                                  >
                                    合并
                                  </button>
                                  <button
                                    type="button"
                                    className="border-t border-[var(--line-soft)] px-3 py-2 text-left text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-2)]"
                                    onClick={() =>
                                      void handleApplyCliConfig(option.key, 'overwrite')
                                    }
                                  >
                                    覆盖
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">CLI 测试</h4>
                    <div className="grid min-h-0 flex-1 grid-cols-3 items-start divide-x divide-[var(--line-soft)]">
                      {CLI_OPTIONS.map(option => {
                        const setting = selectedConfig.cliSettings[option.key];
                        const cliState = currentTestState[option.key];
                        const isTesting = testingCli[selectedConfig.id]?.[option.key] ?? false;

                        return (
                          <section key={option.key} className="min-w-0 px-1">
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <img
                                  src={option.icon}
                                  alt={option.name}
                                  className={option.sizeClass}
                                />
                                <h5 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                                  {option.name}
                                </h5>
                              </div>
                              <AppButton
                                variant="secondary"
                                size="sm"
                                className="shrink-0 px-2"
                                onClick={() => void handleRunCliTests(option.key)}
                                disabled={!setting.enabled || isTesting}
                              >
                                {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                测试
                              </AppButton>
                            </div>

                            <div className="space-y-1.5">
                              {[0, 1, 2].map(index => {
                                const slotResult = cliState.slots[index];
                                return (
                                  <div
                                    key={`${option.key}-${index}`}
                                    className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2"
                                  >
                                    <label className="sr-only">{`${option.name} 测试模型 ${index + 1}`}</label>
                                    <select
                                      aria-label={`${option.name} 测试模型 ${index + 1}`}
                                      value={getSelectValue(setting.testModels, index)}
                                      onChange={event =>
                                        handleUpdateTestModel(option.key, index, event.target.value)
                                      }
                                      disabled={!setting.enabled}
                                      className="min-w-0 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50"
                                    >
                                      <option value="">选择测试模型</option>
                                      {selectedConfig.models.map(model => (
                                        <option key={model} value={model}>
                                          {model}
                                        </option>
                                      ))}
                                    </select>
                                    <span
                                      className={`text-right text-xs ${
                                        slotResult?.success === true
                                          ? 'text-[var(--success)]'
                                          : slotResult?.success === false
                                            ? 'text-[var(--danger)]'
                                            : 'text-[var(--text-secondary)]'
                                      }`}
                                      title={slotResult?.message}
                                    >
                                      {slotResult?.success === true
                                        ? '通过'
                                        : slotResult?.success === false
                                          ? '失败'
                                          : '未测试'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}

      {selectedConfig && previewState ? (
        <ConfigPreviewModal
          config={selectedConfig}
          previewState={previewState}
          displayConfig={previewDisplayConfig}
          onClose={() => setPreviewState(null)}
          onEdit={handlePreviewEdit}
          onChangeFile={handlePreviewChange}
          onSaveEdit={handlePreviewSave}
          onCancelEdit={() =>
            setPreviewState(prev => (prev ? { ...prev, isEditing: false, draft: null } : null))
          }
          onReset={handlePreviewReset}
        />
      ) : null}

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
