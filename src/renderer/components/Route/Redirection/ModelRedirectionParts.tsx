import {
  PriorityModelEntry,
  PriorityRowStatus,
  formatRoutePathDisabledReasonLabel,
  formatRemainingDuration,
  PrioritySessionDot,
} from './model-redirection-view';
import { type ReactNode } from 'react';

import type { RouteModelDisplayItem } from '../../../../shared/types/route-proxy';
import type { AccountCredential, SiteConfig, UserGroupInfo } from '../../../../shared/types/site';

export {
  type RoutePathSuspensionLabel,
  type PriorityModelEntry,
  type PriorityRowStatus,
  formatRoutePathDisabledReasonLabel,
  formatRemainingDuration,
  buildPriorityModelEntries,
  derivePriorityRowStatus,
  type PrioritySessionDot,
  buildSessionChannelKey,
  buildPrioritySessionDots,
  buildDisplayItemViews,
  buildRecommendedCliModelOptions,
  shouldRefreshRegistrySourceDetails,
} from './model-redirection-view';

export interface RedirectEditorContext {
  storageVersion?: RouteModelDisplayItem['storageVersion'];
  mode: 'create' | 'edit';
  displayItemId?: string;
  displayItemMode?: RouteModelDisplayItem['mode'];
  initialSourceKeys: string[];
  displayItemCreatedAt?: number;
}

export interface RedirectEditorErrors {
  canonicalName?: string;
  selectedOriginalModels?: string;
}

export interface RouteRuntimeRuleState {
  item: RouteModelDisplayItem;
  displayName: string;
}

export interface RouteRuntimeRuleErrors {
  maxAttemptsPerRoutePath?: string;
  successRateWindowMinutes?: string;
  disableDurationMinutes?: string;
  minSuccessRatePercent?: string;
}

export interface CreateApiKeyDialogState {
  site: SiteConfig;
  account: AccountCredential;
  groups: Record<string, UserGroupInfo>;
  defaultGroup: string;
}

export const QUOTA_CONVERSION_FACTOR = 500000;

export const PRIORITY_RUNTIME_REFRESH_INTERVAL_MS = 1500;

export const PRIORITY_ROUTE_LOG_LIMIT = 200;

export const PRIORITY_DETAIL_GRID_CLASS = 'grid-cols-[minmax(0,1fr)_auto_44px]';

export function PriorityModelList({ entries }: { entries: PriorityModelEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <span className="break-words">
      {entries.map((entry, index) => (
        <span key={entry.model}>
          {index > 0 ? '、' : ''}
          <span
            className={entry.suspension ? 'text-[var(--text-disabled)] line-through' : undefined}
            data-suspended={entry.suspension ? 'true' : undefined}
          >
            {entry.model}
            {entry.priceLabel ? `（${entry.priceLabel}）` : ''}
          </span>
        </span>
      ))}
    </span>
  );
}

export const PRIORITY_API_KEY_CHIP_CLASS: Record<string, string> = {
  suspended:
    'border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]',
  partial:
    'border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]',
  idle: 'border-[var(--line-soft)] bg-[var(--surface-2)]',
};

export const PRIORITY_STATUS_BADGE_CLASS =
  'shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-semibold';

export function PrioritySessionDots({
  dots,
  selectedInstanceId,
}: {
  dots: PrioritySessionDot[];
  selectedInstanceId: string | null;
}) {
  if (dots.length === 0) {
    return null;
  }

  return (
    <span className="flex shrink-0 items-center gap-0.5" data-testid="priority-session-dots">
      {dots.map(dot => (
        <span
          key={dot.instanceId}
          className="h-2 w-2 shrink-0 rounded-full transition-opacity"
          style={{
            backgroundColor: dot.color,
            opacity: !selectedInstanceId || selectedInstanceId === dot.instanceId ? 1 : 0.25,
          }}
          title={dot.displayName}
          data-session-instance={dot.instanceId}
        />
      ))}
    </span>
  );
}

export function PriorityRowStatusBadge({
  status,
  now,
  title,
  minSuccessRate,
}: {
  status: PriorityRowStatus;
  now: number;
  title?: string;
  minSuccessRate?: number;
}) {
  if (!status) {
    return null;
  }

  const remaining = formatRemainingDuration(status.disabledUntil, now);
  const isDanger =
    status.kind === 'suspended' &&
    (status.reason === 'upstream_credential_rejected' ||
      status.reason === 'upstream_model_unavailable');
  const label =
    status.kind === 'partial'
      ? `部分暂停 ${status.suspended}/${status.total}`
      : formatRoutePathDisabledReasonLabel(status.reason, minSuccessRate);

  return (
    <span
      className={`${PRIORITY_STATUS_BADGE_CLASS} ${
        isDanger
          ? 'border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]'
          : 'border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]'
      }`}
      data-testid="priority-detail-status-badge"
      data-priority-reason={status.kind === 'suspended' ? status.reason : 'partial'}
      title={title || undefined}
    >
      {label} {remaining}
    </span>
  );
}

export interface ModelRedirectionTabProps {
  isActive?: boolean;
  className?: string;
  setPageHeaderActions?: (actions: ReactNode | null) => void;
}
