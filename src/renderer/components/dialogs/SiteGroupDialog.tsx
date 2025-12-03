import { useRef, useEffect } from 'react';
import { XCircle } from 'lucide-react';

interface SiteGroup {
  id: string;
  name: string;
}

interface SiteGroupDialogProps {
  mode: 'create' | 'edit';
  isOpen: boolean;
  groupName: string;
  editingGroup?: SiteGroup | null;
  onGroupNameChange: (name: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function SiteGroupDialog({
  mode,
  isOpen,
  groupName,
  onGroupNameChange,
  onConfirm,
  onClose,
}: SiteGroupDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        if (mode === 'edit') inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const title = mode === 'create' ? '新建站点分组' : '编辑站点分组';
  const confirmText = mode === 'create' ? '确认创建' : '保存修改';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="关闭"
          >
            <XCircle className="w-4 h-4 text-slate-400" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              分组名称
            </label>
            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={groupName}
              onChange={e => onGroupNameChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirm();
              }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="请输入分组名称"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 text-sm rounded bg-primary-500 text-white hover:bg-primary-600 transition-colors"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
