import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <section className="shrink-0 border-b border-[var(--line-soft)] bg-[var(--surface-1)]/90 px-4 py-2.5 backdrop-blur-sm">
      <div
        data-testid="page-header-row"
        className="flex min-h-[40px] min-w-0 items-center justify-between gap-3"
      >
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <h1 className="shrink-0 text-[20px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
            {title}
          </h1>
          <p className="truncate text-[13px] text-[var(--text-secondary)]">{description}</p>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </section>
  );
}
