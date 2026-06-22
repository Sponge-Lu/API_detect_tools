import { History } from 'lucide-react';
import { useMemo } from 'react';
import { AppModal } from '../AppModal/AppModal';
import { useToastStore, type AppEventItem } from '../../store/toastStore';

interface OperationRecordDialogProps {
  open: boolean;
  onClose: () => void;
}

const LEVEL_STYLES: Record<
  AppEventItem['level'],
  {
    badge: string;
    dot: string;
    label: string;
  }
> = {
  success: {
    badge: 'border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]',
    dot: 'bg-[var(--success)]',
    label: '成功',
  },
  error: {
    badge: 'border-[var(--danger)]/20 bg-[var(--danger-soft)] text-[var(--danger)]',
    dot: 'bg-[var(--danger)]',
    label: '错误',
  },
  warning: {
    badge: 'border-[var(--warning)]/20 bg-[var(--warning-soft)] text-[var(--warning)]',
    dot: 'bg-[var(--warning)]',
    label: '警告',
  },
  info: {
    badge: 'border-[var(--accent)]/20 bg-[var(--accent-soft)] text-[var(--accent)]',
    dot: 'bg-[var(--accent)]',
    label: '信息',
  },
};

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function OperationRecordDialog({ open, onClose }: OperationRecordDialogProps) {
  const eventHistory = useToastStore(state => state.eventHistory);
  const operationRecords = useMemo(
    () => eventHistory.filter(event => event.kind === 'action'),
    [eventHistory]
  );

  return (
    <AppModal
      isOpen={open}
      onClose={onClose}
      title="操作记录"
      titleIcon={<History className="h-5 w-5" />}
      size="xl"
      contentClassName="max-h-[68vh] p-0"
    >
      {operationRecords.length > 0 ? (
        <div className="divide-y divide-[var(--line-muted)]">
          {operationRecords.map(event => {
            const levelStyle = LEVEL_STYLES[event.level];

            return (
              <article
                key={event.id}
                className="px-6 py-4 [contain-intrinsic-size:96px] [content-visibility:auto]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${levelStyle.badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${levelStyle.dot}`} />
                    {levelStyle.label}
                  </span>
                  <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                    {event.source}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                    {formatTimestamp(event.createdAt)}
                  </span>
                </div>
                <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-[var(--text-primary)]">
                  {event.message}
                </pre>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[180px] items-center justify-center px-6 py-10 text-sm font-medium text-[var(--text-primary)]">
          暂无操作记录
        </div>
      )}
    </AppModal>
  );
}
