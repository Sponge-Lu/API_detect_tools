/**
 * 应用头部组件
 * 包含 Logo、标题、保存状态和设置按钮
 */

import { Settings, Loader2 } from 'lucide-react';
import Logo from '../../assets/logo.svg';

interface HeaderProps {
  saving: boolean;
  onOpenSettings: () => void;
}

export function Header({ saving, onOpenSettings }: HeaderProps) {
  return (
    <header className="bg-white/80 dark:bg-dark-card/80 backdrop-blur-md border-b border-light-border dark:border-dark-border px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="relative w-10 h-10 flex items-center justify-center">
            <img
              src={Logo}
              alt="API Hub Management Tools logo"
              className="w-10 h-10 object-contain select-none"
              draggable={false}
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-light-text dark:text-dark-text">
              API Hub Management Tools
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-lg text-xs border border-primary-500/20">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>保存中...</span>
            </div>
          )}
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all flex items-center gap-1.5 text-sm border border-light-border dark:border-dark-border shadow-sm"
          >
            <Settings className="w-4 h-4" strokeWidth={2} />
            设置
          </button>
        </div>
      </div>
    </header>
  );
}
