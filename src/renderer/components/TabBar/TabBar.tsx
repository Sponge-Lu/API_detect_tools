import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Server, Settings } from 'lucide-react';
import type { TabId } from '../../store/uiStore';

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Server }[] = [
  { id: 'sites', label: '站点管理', icon: Server },
  { id: 'settings', label: '设置', icon: Settings },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  const visibleTabs = tabs;
  // 旧版本持久化的 'credit' 标签页回退到站点管理
  const visibleActiveTab: TabId = (activeTab as string) === 'credit' ? 'sites' : activeTab;
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<TabId, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const setTabRef = useCallback(
    (id: TabId) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el);
      else tabRefs.current.delete(id);
    },
    []
  );

  useLayoutEffect(() => {
    const activeEl = tabRefs.current.get(visibleActiveTab);
    const navEl = navRef.current;
    if (activeEl && navEl) {
      const navRect = navEl.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - navRect.left,
        width: tabRect.width,
      });
    }
  }, [visibleActiveTab]);

  return (
    <div
      ref={navRef}
      className="relative flex h-11 shrink-0 items-stretch border-b border-[var(--line-soft)] bg-[var(--surface-1)]"
    >
      {/* Sliding bottom bar：2px 且压住容器 1px 分割线，避免出现"双线" */}
      <div
        aria-hidden="true"
        className="absolute -bottom-px h-[2px] rounded-full bg-[var(--accent-solid)] transition-[left,width] duration-[var(--duration-hover)]"
        style={{
          left: indicator.left,
          width: indicator.width,
        }}
      />
      {visibleTabs.map(({ id, label, icon: Icon }) => {
        const isActive = visibleActiveTab === id;
        return (
          <button
            key={id}
            ref={setTabRef(id)}
            onClick={() => onTabChange(id)}
            aria-current={isActive ? 'page' : undefined}
            className={`
              relative flex items-center justify-center gap-1.5
              px-5 text-[13px] font-medium
              transition-colors duration-[var(--duration-hover)]
              ${
                isActive
                  ? 'font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
            style={{ WebkitUserSelect: 'none' } as React.CSSProperties}
          >
            <Icon
              className={`h-4 w-4 transition-colors duration-[var(--duration-hover)] ${
                isActive ? 'text-[var(--accent)]' : ''
              }`}
              strokeWidth={isActive ? 1.75 : 1.5}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
