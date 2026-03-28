/**
 * 路由页 Sub-Tab 导航（iOS Segmented Control 风格）
 */

import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import { Layers, Activity, BarChart3 } from 'lucide-react';
import type { RouteSubTab } from '../../store/routeStore';

const subTabs: { id: RouteSubTab; label: string; icon: typeof Layers }[] = [
  { id: 'redirection', label: '模型重定向', icon: Layers },
  { id: 'usability', label: 'CLI 可用性', icon: Activity },
  { id: 'proxystats', label: '代理&统计', icon: BarChart3 },
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
      className="relative flex items-center gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-lg mx-6 mt-3 mb-4"
    >
      <div
        className="absolute top-0.5 h-[calc(100%-4px)] bg-white dark:bg-gray-700 rounded-md shadow-sm transition-all duration-250 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
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
              px-3 py-1.5 text-[12px] font-medium rounded-md
              transition-colors duration-200
              ${
                isActive
                  ? 'text-[var(--ios-blue)] font-semibold'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
