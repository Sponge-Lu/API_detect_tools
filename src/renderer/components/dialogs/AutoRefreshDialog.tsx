/**
 * 输入: AutoRefreshDialogProps (站点名称、当前间隔、确认/取消回调)
 * 输出: React 组件 (自动刷新设置对话框 UI)
 * 定位: 展示层 - 自动刷新设置对话框，配置站点自动刷新间隔
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppModal } from '../AppModal/AppModal';
import { IOSButton } from '../IOSButton';

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
  const [interval, setInterval] = useState(currentInterval || 30);

  useEffect(() => {
    if (isOpen) {
      setInterval(Math.max(15, currentInterval || 30));
    }
  }, [currentInterval, isOpen, siteName]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const validInterval = Math.max(15, interval);
    onConfirm(validInterval);
  };

  return (
    <AppModal
      isOpen={isOpen}
      onClose={onCancel}
      title="设置自动刷新间隔"
      titleIcon={<AlertTriangle className="w-5 h-5 text-[var(--warning)]" />}
      size="sm"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onCancel}>
            取消
          </IOSButton>
          <IOSButton variant="primary" onClick={handleConfirm}>
            开启自动刷新
          </IOSButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          为「{siteName}」设置自动刷新间隔时间
        </p>

        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            刷新间隔（分钟）
          </label>
          <input
            type="number"
            min={1}
            value={interval}
            onChange={e => {
              const val = Number(e.target.value);
              setInterval(isNaN(val) ? 1 : Math.max(1, val));
            }}
            onBlur={() => {
              if (interval < 15) setInterval(15);
            }}
            className="w-full rounded-lg border border-[var(--line-soft)] bg-[var(--surface-2)] px-4 py-2 text-[var(--text-primary)] outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)]"
          />
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            最小间隔为 15 分钟
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning-soft)] p-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--warning)]" />
          <div className="text-sm text-[var(--text-primary)]">
            <p className="mb-1 font-medium">Cloudflare 保护站点提示</p>
            <p>开启了 Cloudflare 保护的站点需要保持浏览器窗口开启，自动刷新期间浏览器不会自动关闭。</p>
          </div>
        </div>
      </div>
    </AppModal>
  );
}
