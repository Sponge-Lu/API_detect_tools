import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Server, Terminal, Coins, Settings } from 'lucide-react';
import type { TabId } from '../../store/uiStore';
import { LDC_UI_VISIBILITY } from '../../../shared/constants';

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
  const visibleTabs = tabs.filter(tab => LDC_UI_VISIBILITY.showCreditTab || tab.id !== 'credit');
  const visibleActiveTab =
    !LDC_UI_VISIBILITY.showCreditTab && activeTab === 'credit' ? 'sites' : activeTab;
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
      {/* Sliding bottom bar */}
      <div
        className="absolute bottom-0 h-[3px] rounded-full bg-[var(--accent)] transition-all duration-[var(--duration-fast)] [transition-timing-function:var(--ease-standard)]"
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
            className={`
              relative flex items-center justify-center gap-1.5
              px-5 text-[13px] font-medium
              transition-colors duration-200
              ${
                isActive
                  ? 'font-semibold text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
            style={{ WebkitUserSelect: 'none' } as React.CSSProperties}
          >
            <Icon
              className={`w-4 h-4 transition-colors duration-200 ${
                isActive ? 'text-[var(--accent)]' : ''
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
