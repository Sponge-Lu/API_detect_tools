import type { ReactNode } from 'react';

export function AccessPointResourceShell({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="cursor-default space-y-[var(--spacing-sm)] border-t border-[var(--line-soft)] bg-[var(--surface-2)]/92 px-[var(--spacing-md)] py-[var(--spacing-sm)]"
      data-no-drag="true"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function AccessPointResourceSectionHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="min-w-0 truncate text-xs font-semibold text-[var(--text-secondary)]">
        {title}
        {meta}
      </span>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export const accessPointResourceActionClass =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-transparent bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft-strong)] disabled:cursor-not-allowed disabled:opacity-50';

export const accessPointResourceListClass =
  'max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)]/72 p-1';

export const accessPointResourceTokenListClass = 'max-h-40 space-y-0.5 overflow-y-auto';

export const accessPointResourceTokenRowClass =
  'flex min-w-0 items-center gap-x-2 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-xs transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line-soft))]';

export const accessPointResourceIconActionClass =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

// Tab1 信息表单、Tab2 资源区与 Tab3 测试区共享的紧凑表单规格
export const accessPointFormFieldLabelTextClass =
  'text-xs font-medium text-[var(--text-secondary)]';

export const accessPointFormFieldLabelClass = `mb-1.5 block ${accessPointFormFieldLabelTextClass}`;

export const accessPointFormInputClass =
  'h-8 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2.5 text-xs text-[var(--text-primary)] transition-colors focus:border-transparent focus:ring-1 focus:ring-[var(--accent)]';
