import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Settings2 } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppInput } from '../AppInput/AppInput';
import { AppModal } from '../AppModal/AppModal';
import type { Settings } from '../../../shared/types/site';

export type SiteRefreshSettings = Pick<
  Settings,
  'timeout' | 'concurrent' | 'max_concurrent' | 'show_disabled' | 'browser_path'
>;

export interface SiteSettingsChanges {
  siteRefreshSettings?: SiteRefreshSettings;
}

interface SiteSettingsDialogProps {
  isOpen: boolean;
  siteRefreshSettings: SiteRefreshSettings;
  saving?: boolean;
  onClose: () => void;
  onSave: (changes: SiteSettingsChanges) => Promise<void> | void;
}

type SiteRefreshSettingsDraft = {
  timeout: string;
  concurrent: boolean;
  maxConcurrent: string;
  showDisabled: boolean;
  browserPath: string;
};

const toDraft = (settings: SiteRefreshSettings): SiteRefreshSettingsDraft => ({
  timeout: String(settings.timeout),
  concurrent: settings.concurrent,
  maxConcurrent: String(settings.max_concurrent ?? 1),
  showDisabled: settings.show_disabled,
  browserPath: settings.browser_path ?? '',
});

function parseBoundedInteger(
  value: string,
  fallback: number,
  options: { min: number; max: number }
): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, options.min), options.max) : fallback;
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
  siteRefreshSettings,
  saving = false,
  onClose,
  onSave,
}: SiteSettingsDialogProps) {
  const normalizedSettings = useMemo<SiteRefreshSettings>(
    () => ({
      timeout: siteRefreshSettings.timeout,
      concurrent: siteRefreshSettings.concurrent,
      max_concurrent: siteRefreshSettings.max_concurrent,
      show_disabled: siteRefreshSettings.show_disabled,
      browser_path: siteRefreshSettings.browser_path,
    }),
    [siteRefreshSettings]
  );
  const [draft, setDraft] = useState(() => toDraft(normalizedSettings));

  useEffect(() => {
    if (isOpen) setDraft(toDraft(normalizedSettings));
  }, [isOpen, normalizedSettings]);

  const nextSettings = useMemo<SiteRefreshSettings>(
    () => ({
      timeout: parseBoundedInteger(draft.timeout, normalizedSettings.timeout, {
        min: 5,
        max: 600,
      }),
      concurrent: draft.concurrent,
      max_concurrent: parseBoundedInteger(
        draft.maxConcurrent,
        normalizedSettings.max_concurrent ?? 1,
        { min: 1, max: 5 }
      ),
      show_disabled: draft.showDisabled,
      browser_path: draft.browserPath.trim(),
    }),
    [draft, normalizedSettings]
  );
  const isDirty = JSON.stringify(nextSettings) !== JSON.stringify(normalizedSettings);

  const updateField = (field: keyof SiteRefreshSettingsDraft, value: string | boolean) => {
    setDraft(previous => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave(isDirty ? { siteRefreshSettings: nextSettings } : {});
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onClose}
      title="站点刷新设置"
      titleIcon={<Settings2 className="h-5 w-5" strokeWidth={2} />}
      size="md"
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
      <form id="site-settings-form" className="space-y-4" onSubmit={handleSubmit}>
        <AppInput
          type="number"
          min={5}
          max={600}
          label="请求超时（秒）"
          value={draft.timeout}
          disabled={saving}
          onChange={event => updateField('timeout', event.target.value)}
        />
        <SettingsSwitch
          checked={draft.concurrent}
          disabled={saving}
          label="并发刷新"
          description="同时刷新多个站点账户。"
          onChange={checked => updateField('concurrent', checked)}
        />
        {draft.concurrent ? (
          <AppInput
            type="number"
            min={1}
            max={5}
            label="最大并发数"
            value={draft.maxConcurrent}
            disabled={saving}
            onChange={event => updateField('maxConcurrent', event.target.value)}
          />
        ) : null}
        <SettingsSwitch
          checked={draft.showDisabled}
          disabled={saving}
          label="显示禁用的站点"
          description="在站点列表中保留已禁用的站点。"
          onChange={checked => updateField('showDisabled', checked)}
        />
        <AppInput
          type="text"
          label="浏览器路径（可选）"
          value={draft.browserPath}
          disabled={saving}
          placeholder="例如：C:\\PortableApps\\Chrome\\chrome.exe"
          onChange={event => updateField('browserPath', event.target.value)}
        />
      </form>
    </AppModal>
  );
}
