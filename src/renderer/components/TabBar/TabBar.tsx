import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Server, Terminal, Coins, Settings } from 'lucide-react';
import type { TabId } from '../../store/uiStore';

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: typeof Server }[] = [
  { id: 'sites', label: '站点管理', icon: Server },
  { id: 'cli', label: '自定义CLI', icon: Terminal },
  { id: 'credit', label: 'Linux Do Credit', icon: Coins },
  { id: 'settings', label: '设置', icon: Settings },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
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
    const activeEl = tabRefs.current.get(activeTab);
    const navEl = navRef.current;
    if (activeEl && navEl) {
      const navRect = navEl.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: tabRect.left - navRect.left,
        width: tabRect.width,
      });
    }
  }, [activeTab]);

  return (
    <div
      ref={navRef}
      className="relative flex items-stretch h-11 shrink-0 border-b border-[var(--ios-separator)] bg-light-bg dark:bg-dark-bg"
    >
      {/* Sliding bottom bar */}
      <div
        className="absolute bottom-0 h-[3px] rounded-full bg-[var(--ios-blue)] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{
          left: indicator.left,
          width: indicator.width,
        }}
      />
      {tabs.map(({ id, label, icon: Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            ref={setTabRef(id)}
            onClick={() => onTabChange(id)}
            className={`
              relative flex items-center justify-center gap-1.5
              px-5 text-[13px] font-medium
              transition-colors duration-200
              ${
                isActive
                  ? 'text-[var(--ios-blue)] font-semibold'
                  : 'text-[var(--ios-text-secondary)] hover:text-[var(--ios-text-primary)]'
              }
            `}
            style={{ WebkitUserSelect: 'none' } as React.CSSProperties}
          >
            <Icon
              className={`w-4 h-4 transition-colors duration-200 ${
                isActive ? 'text-[var(--ios-blue)]' : ''
              }`}
              strokeWidth={isActive ? 2 : 1.5}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
