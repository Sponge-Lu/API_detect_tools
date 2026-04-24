import { useMemo, useState } from 'react';
import { Bell, Eraser, Filter, History, Wrench } from 'lucide-react';
import { AppButton } from '../components/AppButton/AppButton';
import { AppCard, AppCardContent } from '../components/AppCard';
import { useToastStore, type AppEventItem } from '../store/toastStore';

type EventFilter = 'all' | 'toast' | 'action';

const FILTER_OPTIONS: Array<{
  id: EventFilter;
  label: string;
  icon: typeof Filter;
}> = [
  { id: 'all', label: '全部', icon: Filter },
  { id: 'toast', label: '通知', icon: Bell },
  { id: 'action', label: '操作', icon: Wrench },
];

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

const KIND_LABELS: Record<AppEventItem['kind'], string> = {
  toast: '通知',
  action: '操作',
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

function EventCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

export function LogsPage() {
  const eventHistory = useToastStore(state => state.eventHistory);
  const clearEventHistory = useToastStore(state => state.clearEventHistory);
  const [filter, setFilter] = useState<EventFilter>('all');

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return eventHistory;
    return eventHistory.filter(event => event.kind === filter);
  }, [eventHistory, filter]);

  const notificationCount = useMemo(
    () => eventHistory.filter(event => event.kind === 'toast').length,
    [eventHistory]
  );
  const actionCount = eventHistory.length - notificationCount;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-6 py-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <AppCard>
          <AppCardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <History className="h-4 w-4 text-[var(--accent)]" />
                  当前会话事件
                </div>
                <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
                  这里会保留本次启动后的通知与关键操作记录。Toast 只显示摘要，完整内容在此页查看。
                </p>
              </div>
              <AppButton
                variant="secondary"
                size="sm"
                disabled={eventHistory.length === 0}
                onClick={clearEventHistory}
              >
                <Eraser className="h-4 w-4" />
                清空会话记录
              </AppButton>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <EventCount label="总记录" value={eventHistory.length} />
              <EventCount label="通知" value={notificationCount} />
              <EventCount label="关键操作" value={actionCount} />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {FILTER_OPTIONS.map(option => {
                const Icon = option.icon;
                const selected = filter === option.id;

                return (
                  <AppButton
                    key={option.id}
                    variant={selected ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setFilter(option.id)}
                  >
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </AppButton>
                );
              })}
            </div>
          </AppCardContent>
        </AppCard>

        <AppCard className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <AppCardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-4">
              <div className="text-sm font-semibold text-[var(--text-primary)]">事件列表</div>
              <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                {filteredEvents.length} 条
              </span>
            </div>

            {filteredEvents.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredEvents.map((event, index) => {
                  const levelStyle = LEVEL_STYLES[event.level];
                  return (
                    <article
                      key={event.id}
                      className={`px-5 py-4 ${
                        index === 0 ? '' : 'border-t border-[var(--line-soft)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${levelStyle.badge}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${levelStyle.dot}`} />
                          {levelStyle.label}
                        </span>
                        <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                          {KIND_LABELS[event.kind]}
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
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                <div className="text-sm font-medium text-[var(--text-primary)]">暂无会话记录</div>
                <p className="max-w-xl text-sm text-[var(--text-secondary)]">
                  当前筛选条件下还没有通知或关键操作。后续的保存、检测、CLI
                  测试和路由操作会出现在这里。
                </p>
              </div>
            )}
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  );
}
