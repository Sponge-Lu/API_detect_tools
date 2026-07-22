import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, RefreshCw, Settings2 } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppInput } from '../AppInput/AppInput';
import { AppModal } from '../AppModal/AppModal';
import type { Settings } from '../../../shared/types/site';
import {
  DEFAULT_CLI_PROBE_CONFIG,
  type RouteCliProbeConfig,
} from '../../../shared/types/route-proxy';

export type SiteRefreshSettings = Pick<
  Settings,
  'timeout' | 'concurrent' | 'max_concurrent' | 'show_disabled' | 'browser_path'
>;

export interface SiteSettingsChanges {
  cliProbeConfig?: RouteCliProbeConfig;
  siteRefreshSettings?: SiteRefreshSettings;
}

interface SiteSettingsDialogProps {
  isOpen: boolean;
  cliProbeConfig?: RouteCliProbeConfig | null;
  siteRefreshSettings: SiteRefreshSettings;
  saving?: boolean;
  onClose: () => void;
  onSave: (changes: SiteSettingsChanges) => Promise<void> | void;
}

type SettingsCategory = 'cli-probe' | 'site-refresh';

type CliProbeSettingsDraft = {
  enabled: boolean;
  runOnStartup: boolean;
  intervalMinutes: string;
  requestTimeoutMs: string;
  maxConcurrency: string;
  retentionDays: string;
};

type SiteRefreshSettingsDraft = {
  timeout: string;
  concurrent: boolean;
  maxConcurrent: string;
  showDisabled: boolean;
  browserPath: string;
};

const toCliProbeDraft = (config: RouteCliProbeConfig): CliProbeSettingsDraft => ({
  enabled: config.enabled,
  runOnStartup: config.runOnStartup,
  intervalMinutes: String(config.intervalMinutes),
  requestTimeoutMs: String(config.requestTimeoutMs),
  maxConcurrency: String(config.maxConcurrency),
  retentionDays: String(config.retentionDays),
});

const toSiteRefreshDraft = (settings: SiteRefreshSettings): SiteRefreshSettingsDraft => ({
  timeout: String(settings.timeout),
  concurrent: settings.concurrent,
  maxConcurrent: String(settings.max_concurrent ?? 1),
  showDisabled: settings.show_disabled,
  browserPath: settings.browser_path ?? '',
});

const parseBoundedInteger = (
  value: string,
  fallback: number,
  options: { min: number; max: number }
): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, options.min), options.max);
};

function isSameCliProbeConfig(left: RouteCliProbeConfig, right: RouteCliProbeConfig): boolean {
  return (
    left.enabled === right.enabled &&
    left.runOnStartup === right.runOnStartup &&
    left.intervalMinutes === right.intervalMinutes &&
    left.requestTimeoutMs === right.requestTimeoutMs &&
    left.maxConcurrency === right.maxConcurrency &&
    left.retentionDays === right.retentionDays
  );
}

function isSameSiteRefreshSettings(left: SiteRefreshSettings, right: SiteRefreshSettings): boolean {
  return (
    left.timeout === right.timeout &&
    left.concurrent === right.concurrent &&
    (left.max_concurrent ?? 1) === (right.max_concurrent ?? 1) &&
    left.show_disabled === right.show_disabled &&
    (left.browser_path ?? '') === (right.browser_path ?? '')
  );
}

function SettingsSwitch({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-3 text-left transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked
            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
            : 'border-[var(--line-soft)] bg-[var(--surface-1)]'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-[var(--text-primary)] shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  );
}

export function SiteSettingsDialog({
  isOpen,
  cliProbeConfig,
  siteRefreshSettings,
  saving = false,
  onClose,
  onSave,
}: SiteSettingsDialogProps) {
  const effectiveCliProbeConfig = cliProbeConfig ?? DEFAULT_CLI_PROBE_CONFIG;
  const effectiveSiteRefreshSettings = useMemo<SiteRefreshSettings>(
    () => ({
      timeout: siteRefreshSettings.timeout,
      concurrent: siteRefreshSettings.concurrent,
      max_concurrent: siteRefreshSettings.max_concurrent,
      show_disabled: siteRefreshSettings.show_disabled,
      browser_path: siteRefreshSettings.browser_path,
    }),
    [
      siteRefreshSettings.browser_path,
      siteRefreshSettings.concurrent,
      siteRefreshSettings.max_concurrent,
      siteRefreshSettings.show_disabled,
      siteRefreshSettings.timeout,
    ]
  );
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('cli-probe');
  const [cliProbeDraft, setCliProbeDraft] = useState<CliProbeSettingsDraft>(() =>
    toCliProbeDraft(effectiveCliProbeConfig)
  );
  const [siteRefreshDraft, setSiteRefreshDraft] = useState<SiteRefreshSettingsDraft>(() =>
    toSiteRefreshDraft(effectiveSiteRefreshSettings)
  );

  useEffect(() => {
    if (isOpen) {
      setActiveCategory('cli-probe');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setCliProbeDraft(toCliProbeDraft(effectiveCliProbeConfig));
    }
  }, [effectiveCliProbeConfig, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSiteRefreshDraft(toSiteRefreshDraft(effectiveSiteRefreshSettings));
    }
  }, [effectiveSiteRefreshSettings, isOpen]);

  const normalizedCliProbeConfig = useMemo<RouteCliProbeConfig>(
    () => ({
      enabled: cliProbeDraft.enabled,
      runOnStartup: cliProbeDraft.runOnStartup,
      intervalMinutes: parseBoundedInteger(
        cliProbeDraft.intervalMinutes,
        effectiveCliProbeConfig.intervalMinutes,
        { min: 1, max: 1440 }
      ),
      // The persisted shape still carries this field; each access point owns the selected model.
      modelsPerCli: 1,
      requestTimeoutMs: parseBoundedInteger(
        cliProbeDraft.requestTimeoutMs,
        effectiveCliProbeConfig.requestTimeoutMs,
        { min: 1000, max: 300000 }
      ),
      maxConcurrency: parseBoundedInteger(
        cliProbeDraft.maxConcurrency,
        effectiveCliProbeConfig.maxConcurrency,
        { min: 1, max: 20 }
      ),
      retentionDays: parseBoundedInteger(
        cliProbeDraft.retentionDays,
        effectiveCliProbeConfig.retentionDays,
        { min: 1, max: 365 }
      ),
    }),
    [cliProbeDraft, effectiveCliProbeConfig]
  );

  const normalizedSiteRefreshSettings = useMemo<SiteRefreshSettings>(
    () => ({
      timeout: parseBoundedInteger(siteRefreshDraft.timeout, effectiveSiteRefreshSettings.timeout, {
        min: 1,
        max: 60,
      }),
      concurrent: siteRefreshDraft.concurrent,
      max_concurrent: parseBoundedInteger(
        siteRefreshDraft.maxConcurrent,
        effectiveSiteRefreshSettings.max_concurrent ?? 1,
        { min: 1, max: 5 }
      ),
      show_disabled: siteRefreshDraft.showDisabled,
      browser_path: siteRefreshDraft.browserPath,
    }),
    [effectiveSiteRefreshSettings, siteRefreshDraft]
  );

  const cliProbeDirty = !isSameCliProbeConfig(normalizedCliProbeConfig, effectiveCliProbeConfig);
  const siteRefreshDirty = !isSameSiteRefreshSettings(
    normalizedSiteRefreshSettings,
    effectiveSiteRefreshSettings
  );
  const isDirty = cliProbeDirty || siteRefreshDirty;

  const updateCliProbeField = (field: keyof CliProbeSettingsDraft, value: string | boolean) => {
    setCliProbeDraft(previous => ({ ...previous, [field]: value }));
  };

  const updateSiteRefreshField = (
    field: keyof SiteRefreshSettingsDraft,
    value: string | boolean
  ) => {
    setSiteRefreshDraft(previous => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      ...(cliProbeDirty ? { cliProbeConfig: normalizedCliProbeConfig } : {}),
      ...(siteRefreshDirty ? { siteRefreshSettings: normalizedSiteRefreshSettings } : {}),
    });
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title="站点设置"
      titleIcon={<Settings2 className="h-5 w-5" strokeWidth={2} />}
      size="lg"
      closeOnOverlayClick={!saving}
      closeOnEsc={!saving}
      footer={
        <>
          <AppButton type="button" variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </AppButton>
          <AppButton
            type="submit"
            form="site-settings-form"
            loading={saving}
            variant={isDirty ? 'danger' : 'primary'}
            data-testid="site-settings-save-button"
            data-dirty={isDirty ? 'true' : 'false'}
          >
            保存设置
          </AppButton>
        </>
      }
    >
      <form id="site-settings-form" className="space-y-5" onSubmit={handleSubmit}>
        <div
          role="tablist"
          aria-label="设置分类"
          className="grid grid-cols-2 gap-1 rounded-[var(--radius-lg)] bg-[var(--surface-2)] p-1"
        >
          <button
            type="button"
            role="tab"
            id="cli-probe-settings-tab"
            aria-controls="cli-probe-settings-panel"
            aria-selected={activeCategory === 'cli-probe'}
            onClick={() => setActiveCategory('cli-probe')}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ${
              activeCategory === 'cli-probe'
                ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Activity className="h-4 w-4" aria-hidden="true" />
            CLI 探测
          </button>
          <button
            type="button"
            role="tab"
            id="site-refresh-settings-tab"
            aria-controls="site-refresh-settings-panel"
            aria-selected={activeCategory === 'site-refresh'}
            onClick={() => setActiveCategory('site-refresh')}
            className={`flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ${
              activeCategory === 'site-refresh'
                ? 'bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            站点刷新
          </button>
        </div>

        {activeCategory === 'cli-probe' ? (
          <div
            id="cli-probe-settings-panel"
            role="tabpanel"
            aria-labelledby="cli-probe-settings-tab"
            className="space-y-4"
          >
            <SettingsSwitch
              checked={cliProbeDraft.enabled}
              disabled={saving}
              label="启用定时探测"
              description="按固定间隔对已配置的站点 CLI 模型执行可用性采样。"
              onChange={checked => updateCliProbeField('enabled', checked)}
            />

            <SettingsSwitch
              checked={cliProbeDraft.runOnStartup}
              disabled={saving}
              label="启动后自动探测"
              description="应用启动时执行一次站点 CLI 可用性探测。"
              onChange={checked => updateCliProbeField('runOnStartup', checked)}
            />

            <AppInput
              type="number"
              min={1}
              max={1440}
              label="探测间隔（分钟）"
              value={cliProbeDraft.intervalMinutes}
              disabled={saving}
              helpText="范围 1-1440，保存时会自动归一化。"
              onChange={event => updateCliProbeField('intervalMinutes', event.target.value)}
            />

            <AppInput
              type="number"
              min={1000}
              max={300000}
              step={1000}
              label="请求超时（毫秒）"
              value={cliProbeDraft.requestTimeoutMs}
              disabled={saving}
              helpText="单次 CLI 探测请求超时，范围 1000-300000。"
              onChange={event => updateCliProbeField('requestTimeoutMs', event.target.value)}
            />

            <AppInput
              type="number"
              min={1}
              max={20}
              label="最大并发"
              value={cliProbeDraft.maxConcurrency}
              disabled={saving}
              helpText="限制同时执行的探测任务数量。"
              onChange={event => updateCliProbeField('maxConcurrency', event.target.value)}
            />

            <AppInput
              type="number"
              min={1}
              max={365}
              label="历史保留天数"
              value={cliProbeDraft.retentionDays}
              disabled={saving}
              helpText="影响 CLI 探测历史样本清理，默认 3 天，范围 1-365。"
              onChange={event => updateCliProbeField('retentionDays', event.target.value)}
            />
          </div>
        ) : (
          <div
            id="site-refresh-settings-panel"
            role="tabpanel"
            aria-labelledby="site-refresh-settings-tab"
            className="space-y-4"
          >
            <AppInput
              type="number"
              min={1}
              max={60}
              label="请求超时时间 (秒)"
              value={siteRefreshDraft.timeout}
              disabled={saving}
              helpText="每个站点的最大等待时间。"
              onChange={event => updateSiteRefreshField('timeout', event.target.value)}
            />

            <SettingsSwitch
              checked={siteRefreshDraft.concurrent}
              disabled={saving}
              label="并发检测"
              description="同时检测所有站点，速度更快但占用资源更多。"
              onChange={checked => updateSiteRefreshField('concurrent', checked)}
            />

            {siteRefreshDraft.concurrent ? (
              <AppInput
                type="number"
                min={1}
                max={5}
                label="最大并发数"
                value={siteRefreshDraft.maxConcurrent}
                disabled={saving}
                helpText="默认 1（串行），可按机器和网络情况调整为 2-5。"
                onChange={event => updateSiteRefreshField('maxConcurrent', event.target.value)}
              />
            ) : null}

            <SettingsSwitch
              checked={siteRefreshDraft.showDisabled}
              disabled={saving}
              label="显示禁用的站点"
              description="在检测时也包含已禁用的站点。"
              onChange={checked => updateSiteRefreshField('showDisabled', checked)}
            />

            <AppInput
              type="text"
              label="浏览器路径（可选）"
              value={siteRefreshDraft.browserPath}
              disabled={saving}
              placeholder="例如：C:\\PortableApps\\Chrome\\chrome.exe"
              helpText="留空则自动检测 Chrome / Edge。"
              onChange={event => updateSiteRefreshField('browserPath', event.target.value)}
            />
          </div>
        )}
      </form>
    </AppModal>
  );
}

export const CliProbeSettingsDialog = SiteSettingsDialog;
