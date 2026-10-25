import type { CSSProperties, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  saving?: boolean;
}

export function PageHeader({ title, description, actions, saving = false }: PageHeaderProps) {
  return (
    <header
      className="z-[var(--z-command-bar)] flex h-10 shrink-0 items-center border-b border-[var(--line-soft)] bg-[var(--surface-1)] px-4 transition-colors duration-[var(--duration-hover)]"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      data-testid="page-header-row"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <h1
          className="shrink-0 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]"
          title={description || title}
        >
          {title}
        </h1>
      </div>

      <div
        className="flex shrink-0 items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      >
        <div
          aria-hidden={!saving}
          className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-strong)] transition-opacity duration-[var(--duration-hover)] ${saving ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span>保存中...</span>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}
