/**
 * @file src/renderer/components/dialogs/CloseBehaviorDialog.tsx
 * @description 窗口关闭行为选择对话框 - 使用 IOSModal 重构
 *
 * 输入: CloseBehaviorDialogProps (open, onClose)
 * 输出: React 组件 (关闭行为选择对话框 UI)
 * 定位: 展示层 - 让用户选择关闭窗口时的行为（退出或最小化到托盘）
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 使用 IOSModal 重构
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState } from 'react';
import { X, LogOut, Minimize2 } from 'lucide-react';
import { IOSModal } from '../IOSModal';

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
    <IOSModal
      isOpen={open}
      onClose={onClose}
      title="关闭窗口"
      titleIcon={<X className="w-5 h-5" />}
      size="md"
      showCloseButton={!isProcessing}
    >
      {/* 内容区域 */}
      <div className="space-y-4">
        <p className="text-[var(--ios-text-secondary)]">您希望如何处理窗口关闭？</p>

        {/* 选项按钮 */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleAction('quit')}
            disabled={isProcessing}
            className="flex items-center gap-3 w-full px-4 py-3 text-left bg-[var(--ios-bg-tertiary)] hover:bg-[var(--ios-red)]/10 border border-[var(--ios-separator)] rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="p-2 bg-[var(--ios-red)]/10 rounded-[var(--radius-md)]">
              <LogOut className="w-5 h-5 text-[var(--ios-red)]" />
            </div>
            <div>
              <div className="font-medium text-[var(--ios-text-primary)]">退出应用</div>
              <div className="text-sm text-[var(--ios-text-secondary)]">完全关闭应用程序</div>
            </div>
          </button>

          <button
            onClick={() => handleAction('minimize')}
            disabled={isProcessing}
            className="flex items-center gap-3 w-full px-4 py-3 text-left bg-[var(--ios-bg-tertiary)] hover:bg-[var(--ios-blue)]/10 border border-[var(--ios-separator)] rounded-[var(--radius-md)] transition-all duration-[var(--duration-fast)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="p-2 bg-[var(--ios-blue)]/10 rounded-[var(--radius-md)]">
              <Minimize2 className="w-5 h-5 text-[var(--ios-blue)]" />
            </div>
            <div>
              <div className="font-medium text-[var(--ios-text-primary)]">最小化到托盘</div>
              <div className="text-sm text-[var(--ios-text-secondary)]">
                隐藏窗口，在系统托盘中继续运行
              </div>
            </div>
          </button>
        </div>

        {/* 记住选择 */}
        <div className="pt-4 border-t border-[var(--ios-separator)]">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={e => setRememberChoice(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--ios-separator)] text-[var(--ios-blue)] focus:ring-[var(--ios-blue)] focus:ring-offset-0"
            />
            <span className="text-sm text-[var(--ios-text-secondary)]">记住我的选择</span>
          </label>
        </div>
      </div>
    </IOSModal>
  );
}
