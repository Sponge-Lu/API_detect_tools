/**
 * @file src/renderer/components/CreateApiKeyDialog/CreateApiKeyDialog.tsx
 * @description 创建 API Key 对话框 - 使用 IOSModal 重构
 *
 * 输入: CreateApiKeyDialogProps (站点数据、表单数据、用户分组、回调函数)
 * 输出: React 组件 (创建 API Key 对话框 UI)
 * 定位: 展示层 - 创建 API Key 对话框，支持配置名称、分组、配额和过期时间
 *
 * @version 2.1.11
 * @updated 2025-01-09 - 应用 8px 网格间距系统
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/CreateApiKeyDialog/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useRef, useEffect } from 'react';
import { Key } from 'lucide-react';
import type { SiteConfig } from '../../../shared/types/site';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import { IOSInput } from '../IOSInput';

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
    <IOSModal
      isOpen={true}
      onClose={onClose}
      title="创建 API Key"
      titleIcon={<Key className="w-5 h-5" />}
      size="md"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onClose}>
            取消
          </IOSButton>
          <IOSButton
            variant="primary"
            onClick={onSubmit}
            disabled={creating || !form.name.trim()}
            loading={creating}
          >
            {creating ? '创建中...' : '创建'}
          </IOSButton>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-[var(--spacing-lg)]">
        {/* 站点信息 */}
        <div className="text-sm text-[var(--ios-text-secondary)]">
          站点: <span className="text-[var(--ios-text-primary)] font-medium">{site.name}</span>
        </div>

        {/* 名称 */}
        <IOSInput
          ref={nameInputRef}
          label="令牌名称"
          value={form.name}
          onChange={e => onFormChange({ name: e.target.value })}
          placeholder="输入令牌名称"
          required
        />

        {/* 分组选择 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-[var(--spacing-sm)]">
            用户分组
          </label>
          <select
            value={form.group}
            onChange={e => onFormChange({ group: e.target.value })}
            className="w-full px-[var(--spacing-md)] py-[var(--spacing-md)] bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ios-blue)]/20 focus:border-[var(--ios-blue)] transition-all duration-[var(--duration-fast)]"
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
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-[var(--spacing-sm)]">
            额度设置
          </label>
          <div className="space-y-[var(--spacing-sm)]">
            <label className="flex items-center gap-[var(--spacing-sm)] cursor-pointer">
              <input
                type="checkbox"
                checked={form.unlimitedQuota}
                onChange={e => onFormChange({ unlimitedQuota: e.target.checked })}
                className="w-4 h-4 text-[var(--ios-blue)] rounded focus:ring-[var(--ios-blue)] border-[var(--ios-separator)]"
              />
              <span className="text-sm text-[var(--ios-text-secondary)]">无限额度</span>
            </label>
            {!form.unlimitedQuota && (
              <div className="flex items-center gap-[var(--spacing-sm)]">
                <span className="text-sm text-[var(--ios-text-secondary)]">$</span>
                <IOSInput
                  type="number"
                  value={form.quota}
                  onChange={e => onFormChange({ quota: e.target.value })}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  containerClassName="flex-1"
                />
              </div>
            )}
          </div>
        </div>

        {/* 过期时间 */}
        <div>
          <label className="block text-sm font-medium text-[var(--ios-text-primary)] mb-[var(--spacing-sm)]">
            过期时间 <span className="text-[var(--ios-text-tertiary)] text-xs">(可选)</span>
          </label>
          <input
            type="datetime-local"
            value={form.expiredTime}
            onChange={e => onFormChange({ expiredTime: e.target.value })}
            className="w-full px-[var(--spacing-md)] py-[var(--spacing-md)] bg-[var(--ios-bg-tertiary)] border border-[var(--ios-separator)] rounded-[var(--radius-md)] text-sm text-[var(--ios-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ios-blue)]/20 focus:border-[var(--ios-blue)] transition-all duration-[var(--duration-fast)]"
          />
        </div>
      </form>
    </IOSModal>
  );
}
