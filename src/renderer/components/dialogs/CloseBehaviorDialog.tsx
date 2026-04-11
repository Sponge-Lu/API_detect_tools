/**
 * @file src/renderer/components/dialogs/CloseBehaviorDialog.tsx
 * @description 窗口关闭行为选择对话框 - 使用统一弹窗原语实现
 *
 * 输入: CloseBehaviorDialogProps (open, onClose)
 * 输出: React 组件 (关闭行为选择对话框 UI)
 * 定位: 展示层 - 让用户选择关闭窗口时的行为（退出或最小化到托盘）
 *
 * @version 2.1.11
 * @updated 2026-04-02 - 对齐统一弹窗原语说明
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState } from 'react';
import { X, LogOut, Minimize2 } from 'lucide-react';
import { AppButton } from '../AppButton/AppButton';
import { AppModal } from '../AppModal/AppModal';

interface CloseBehaviorDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CloseBehaviorDialog({ open, onClose }: CloseBehaviorDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (action: 'quit' | 'minimize') => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      await window.electronAPI?.closeBehavior?.respondToDialog({
        action,
        remember: rememberChoice,
      });
      onClose();
    } catch (error) {
      console.error('处理关闭行为失败:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppModal
      isOpen={open}
      onClose={onClose}
      title="关闭窗口"
      titleIcon={<X className="w-5 h-5" />}
      size="md"
      showCloseButton={!isProcessing}
    >
      {/* 内容区域 */}
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">您希望如何处理窗口关闭？</p>

        {/* 选项按钮 */}
        <div className="flex flex-col gap-3">
          <AppButton
            type="button"
            variant="secondary"
            onClick={() => handleAction('quit')}
            disabled={isProcessing}
            className="h-auto w-full items-start justify-start gap-3 px-4 py-3 text-left hover:border-[var(--danger)]/30 hover:bg-[var(--danger-soft)]"
          >
            <div className="rounded-[var(--radius-md)] bg-[var(--danger-soft)] p-2">
              <LogOut className="w-5 h-5 text-[var(--danger)]" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-[var(--text-primary)]">退出应用</div>
              <div className="text-sm text-[var(--text-secondary)]">完全关闭应用程序</div>
            </div>
          </AppButton>

          <AppButton
            type="button"
            variant="secondary"
            onClick={() => handleAction('minimize')}
            disabled={isProcessing}
            className="h-auto w-full items-start justify-start gap-3 px-4 py-3 text-left hover:border-[var(--accent)]/30 hover:bg-[var(--accent-soft)]"
          >
            <div className="rounded-[var(--radius-md)] bg-[var(--accent-soft)] p-2">
              <Minimize2 className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-[var(--text-primary)]">最小化到托盘</div>
              <div className="text-sm text-[var(--text-secondary)]">
                隐藏窗口，在系统托盘中继续运行
              </div>
            </div>
          </AppButton>
        </div>

        {/* 记住选择 */}
        <div className="border-t border-[var(--line-soft)] pt-4">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={e => setRememberChoice(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)] focus:ring-offset-0"
            />
            <span className="text-sm text-[var(--text-secondary)]">记住我的选择</span>
          </label>
        </div>
      </div>
    </AppModal>
  );
}
