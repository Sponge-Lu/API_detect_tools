import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppInput } from '../AppInput/AppInput';
import { AppModal } from '../AppModal/AppModal';
import {
  DEFAULT_CLI_PROBE_CONFIG,
  type RouteCliProbeConfig,
} from '../../../shared/types/route-proxy';

interface CliProbeSettingsDialogProps {
  isOpen: boolean;
  config?: RouteCliProbeConfig | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (config: RouteCliProbeConfig) => Promise<void> | void;
}

type CliProbeSettingsDraft = {
  enabled: boolean;
  runOnStartup: boolean;
  intervalMinutes: string;
  requestTimeoutMs: string;
  maxConcurrency: string;
  retentionDays: string;
};

const toDraft = (config: RouteCliProbeConfig): CliProbeSettingsDraft => ({
  enabled: config.enabled,
  runOnStartup: config.runOnStartup,
  intervalMinutes: String(config.intervalMinutes),
  requestTimeoutMs: String(config.requestTimeoutMs),
  maxConcurrency: String(config.maxConcurrency),
  retentionDays: String(config.retentionDays),
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

export function CliProbeSettingsDialog({
  isOpen,
  config,
  saving = false,
  onClose,
  onSave,
}: CliProbeSettingsDialogProps) {
  const effectiveConfig = config ?? DEFAULT_CLI_PROBE_CONFIG;
  const [draft, setDraft] = useState<CliProbeSettingsDraft>(() => toDraft(effectiveConfig));

  useEffect(() => {
    if (isOpen) {
      setDraft(toDraft(effectiveConfig));
    }
  }, [effectiveConfig, isOpen]);

  const normalizedConfig = useMemo<RouteCliProbeConfig>(
    () => ({
      enabled: draft.enabled,
      runOnStartup: draft.runOnStartup,
      intervalMinutes: parseBoundedInteger(
        draft.intervalMinutes,
        effectiveConfig.intervalMinutes,
        { min: 1, max: 1440 }
      ),
      // Kept for persisted config shape compatibility. The actual probe model is now
      // determined by each site/direct config's single selected CLI test model.
      modelsPerCli: 1,
      requestTimeoutMs: parseBoundedInteger(
        draft.requestTimeoutMs,
        effectiveConfig.requestTimeoutMs,
        { min: 1000, max: 300000 }
      ),
      maxConcurrency: parseBoundedInteger(draft.maxConcurrency, effectiveConfig.maxConcurrency, {
        min: 1,
        max: 20,
      }),
      retentionDays: parseBoundedInteger(draft.retentionDays, effectiveConfig.retentionDays, {
        min: 1,
        max: 365,
      }),
    }),
    [draft, effectiveConfig]
  );

  const updateField = (field: keyof CliProbeSettingsDraft, value: string | boolean) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(normalizedConfig);
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title="站点 CLI 探测设置"
      titleIcon={<Activity className="h-5 w-5" strokeWidth={2} />}
      size="lg"
      closeOnOverlayClick={!saving}
      closeOnEsc={!saving}
      footer={
        <>
          <AppButton type="button" variant="secondary" onClick={onClose} disabled={saving}>
            取消
          </AppButton>
          <AppButton type="submit" form="site-cli-probe-settings-form" loading={saving}>
            保存设置
          </AppButton>
        </>
      }
    >
      <form id="site-cli-probe-settings-form" className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsSwitch
            checked={draft.enabled}
            disabled={saving}
            label="启用定时探测"
            description="按固定间隔对已配置的站点 CLI 模型执行可用性采样。"
            onChange={checked => updateField('enabled', checked)}
          />
          <SettingsSwitch
            checked={draft.runOnStartup}
            disabled={saving}
            label="启动后自动探测"
            description="应用启动时执行一次站点 CLI 可用性探测。"
            onChange={checked => updateField('runOnStartup', checked)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <AppInput
            type="number"
            min={1}
            max={1440}
            label="探测间隔（分钟）"
            value={draft.intervalMinutes}
            disabled={saving}
            helpText="范围 1-1440，保存时会自动归一化。"
            onChange={event => updateField('intervalMinutes', event.target.value)}
          />
          <AppInput
            type="number"
            min={1000}
            max={300000}
            step={1000}
            label="请求超时（毫秒）"
            value={draft.requestTimeoutMs}
            disabled={saving}
            helpText="单次 CLI 探测请求超时，范围 1000-300000。"
            onChange={event => updateField('requestTimeoutMs', event.target.value)}
          />
          <AppInput
            type="number"
            min={1}
            max={20}
            label="最大并发"
            value={draft.maxConcurrency}
            disabled={saving}
            helpText="限制同时执行的探测任务数量。"
            onChange={event => updateField('maxConcurrency', event.target.value)}
          />
          <AppInput
            type="number"
            min={1}
            max={365}
            label="历史保留天数"
            value={draft.retentionDays}
            disabled={saving}
            helpText="影响 CLI 探测历史样本清理，默认 3 天，范围 1-365。"
            onChange={event => updateField('retentionDays', event.target.value)}
          />
        </div>
      </form>
    </AppModal>
  );
}
