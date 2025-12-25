/**
 * 窗口关闭行为选择对话框
 *
 * 输入: CloseBehaviorDialogProps (open, onClose)
 * 输出: React 组件 (关闭行为选择对话框 UI)
 * 定位: 展示层 - 让用户选择关闭窗口时的行为（退出或最小化到托盘）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState } from 'react';
import { X, LogOut, Minimize2 } from 'lucide-react';

interface CloseBehaviorDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CloseBehaviorDialog({ open, onClose }: CloseBehaviorDialogProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!open) return null;

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-dark-card rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border bg-gradient-to-r from-slate-500 to-slate-600">
          <div className="flex items-center gap-2 text-white">
            <X className="w-5 h-5" />
            <h2 className="text-lg font-semibold">关闭窗口</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            disabled={isProcessing}
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="px-6 py-5">
          <p className="text-slate-600 dark:text-slate-400 mb-6">您希望如何处理窗口关闭？</p>

          {/* 选项按钮 */}
          <div className="flex flex-col gap-3">
            <button
              onClick={() => handleAction('quit')}
              disabled={isProcessing}
              className="flex items-center gap-3 w-full px-4 py-3 text-left bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <LogOut className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <div className="font-medium text-slate-700 dark:text-slate-200">退出应用</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">完全关闭应用程序</div>
              </div>
            </button>

            <button
              onClick={() => handleAction('minimize')}
              disabled={isProcessing}
              className="flex items-center gap-3 w-full px-4 py-3 text-left bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 border border-slate-200 dark:border-slate-700 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-lg">
                <Minimize2 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <div className="font-medium text-slate-700 dark:text-slate-200">最小化到托盘</div>
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  隐藏窗口，在系统托盘中继续运行
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* 底部区域 */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-light-border dark:border-dark-border">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={e => setRememberChoice(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-primary-500 focus:ring-primary-500 focus:ring-offset-0"
            />
            <span className="text-sm text-slate-600 dark:text-slate-400">记住我的选择</span>
          </label>
        </div>
      </div>
    </div>
  );
}
