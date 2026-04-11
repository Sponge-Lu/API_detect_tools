/**
 * 路由页紧凑子切换条
 */

import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Layers, Activity, BarChart3 } from 'lucide-react';
import type { RouteSubTab } from '../../store/routeStore';

const subTabs: { id: RouteSubTab; label: string; icon: typeof Layers }[] = [
  { id: 'redirection', label: '模型重定向', icon: Layers },
  { id: 'usability', label: 'CLI 可用性', icon: Activity },
  { id: 'proxystats', label: '代理统计', icon: BarChart3 },
];

interface RouteSubTabsProps {
  activeTab: RouteSubTab;
  onChange: (tab: RouteSubTab) => void;
}

export function RouteSubTabs({ activeTab, onChange }: RouteSubTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<RouteSubTab, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });

  const setTabRef = useCallback(
    (id: RouteSubTab) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el);
      else tabRefs.current.delete(id);
    },
    []
  );

  useLayoutEffect(() => {
    const activeEl = tabRefs.current.get(activeTab);
    const containerEl = containerRef.current;
    if (activeEl && containerEl) {
      const cRect = containerEl.getBoundingClientRect();
      const tRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: tRect.left - cRect.left,
        width: tRect.width,
        ready: true,
      });
    }
  }, [activeTab]);

  return (
    <div
      ref={containerRef}
      className="relative mx-6 mb-4 mt-3 flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)]/88 p-0.5"
    >
      <div
        className="absolute top-0.5 h-[calc(100%-4px)] rounded-[var(--radius-md)] bg-[var(--surface-3)] shadow-[var(--shadow-sm)] transition-all duration-[var(--duration-fast)] [transition-timing-function:var(--ease-standard)]"
        style={{
          left: indicator.left,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
        }}
      />

      {subTabs.map(({ id, label, icon: Icon }) => {
        const isActive = activeTab === id;
        return (
          <button
            key={id}
            ref={setTabRef(id)}
            onClick={() => onChange(id)}
            className={`
              relative z-10 flex-1 flex items-center justify-center gap-1.5
              rounded-[var(--radius-md)] px-3 py-1.5 text-[12px] font-medium
              transition-colors duration-200
              ${
                isActive
                  ? 'font-semibold text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }
            `}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={isActive ? 2 : 1.5} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
