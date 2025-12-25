/**
 * 输入: CreateApiKeyDialogProps (站点数据、表单数据、用户分组、回调函数)
 * 输出: React 组件 (创建 API Key 对话框 UI)
 * 定位: 展示层 - 创建 API Key 对话框，支持配置名称、分组、配额和过期时间
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreateApiKeyDialog/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useRef, useEffect } from 'react';
import { X, Key, Loader2 } from 'lucide-react';
import type { SiteConfig } from '../../../shared/types/site';

export interface NewApiTokenForm {
  name: string;
  group: string;
  unlimitedQuota: boolean;
  quota: string;
  expiredTime: string;
}

interface CreateApiKeyDialogProps {
  site: SiteConfig;
  form: NewApiTokenForm;
  groups: Record<string, { desc: string; ratio: number }>;
  creating: boolean;
  onFormChange: (form: Partial<NewApiTokenForm>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function CreateApiKeyDialog({
  site,
  form,
  groups,
  creating,
  onFormChange,
  onSubmit,
  onClose,
}: CreateApiKeyDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦到名称输入框
  useEffect(() => {
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-primary-500" />
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">创建 API Key</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* 站点信息 */}
          <div className="text-sm text-slate-500 dark:text-slate-400">
            站点:{' '}
            <span className="text-slate-700 dark:text-slate-300 font-medium">{site.name}</span>
          </div>

          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              令牌名称 <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={form.name}
              onChange={e => onFormChange({ name: e.target.value })}
              placeholder="输入令牌名称"
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
              required
            />
          </div>

          {/* 分组选择 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              用户分组
            </label>
            <select
              value={form.group}
              onChange={e => onFormChange({ group: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            >
              {Object.entries(groups).map(([groupName, groupInfo]) => (
                <option key={groupName} value={groupName}>
                  {groupName} - {groupInfo.desc} ({groupInfo.ratio}x)
                </option>
              ))}
              {Object.keys(groups).length === 0 && <option value="default">default</option>}
            </select>
          </div>

          {/* 额度设置 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              额度设置
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.unlimitedQuota}
                  onChange={e => onFormChange({ unlimitedQuota: e.target.checked })}
                  className="w-4 h-4 text-primary-500 rounded focus:ring-primary-500"
                />
                <span className="text-sm text-slate-600 dark:text-slate-400">无限额度</span>
              </label>
              {!form.unlimitedQuota && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">$</span>
                  <input
                    type="number"
                    value={form.quota}
                    onChange={e => onFormChange({ quota: e.target.value })}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* 过期时间 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              过期时间 <span className="text-slate-400 text-xs">(可选)</span>
            </label>
            <input
              type="datetime-local"
              value={form.expiredTime}
              onChange={e => onFormChange({ expiredTime: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            />
          </div>

          {/* 按钮 */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>创建中...</span>
                </>
              ) : (
                <span>创建</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
