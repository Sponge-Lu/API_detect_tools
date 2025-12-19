import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface AutoRefreshDialogProps {
  isOpen: boolean;
  siteName: string;
  currentInterval?: number;
  onConfirm: (intervalMinutes: number) => void;
  onCancel: () => void;
}

export function AutoRefreshDialog({
  isOpen,
  siteName,
  currentInterval,
  onConfirm,
  onCancel,
}: AutoRefreshDialogProps) {
  const [interval, setInterval] = useState(currentInterval || 5);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const validInterval = Math.max(3, interval);
    onConfirm(validInterval);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl max-w-md w-full border border-light-border dark:border-dark-border">
        <div className="flex items-center justify-between px-5 py-4 border-b border-light-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-light-text dark:text-dark-text">
            设置自动刷新间隔
          </h3>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary">
            为「{siteName}」设置自动刷新间隔时间
          </p>

          <div>
            <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
              刷新间隔（分钟）
            </label>
            <input
              type="number"
              min={3}
              value={interval}
              onChange={e => setInterval(Math.max(3, Number(e.target.value) || 3))}
              className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text"
            />
            <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
              最小间隔为 3 分钟
            </p>
          </div>

          {/* CF 保护警告 */}
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium mb-1">Cloudflare 保护站点提示</p>
              <p>
                开启了 Cloudflare 保护的站点需要保持浏览器窗口开启，自动刷新期间浏览器不会自动关闭。
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-light-border dark:border-dark-border">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all border border-light-border dark:border-dark-border text-light-text dark:text-dark-text font-medium"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all font-semibold"
          >
            开启自动刷新
          </button>
        </div>
      </div>
    </div>
  );
}
