/**
 * @file src/renderer/components/dialogs/SiteGroupDialog.tsx
 * @description 站点分组对话框 - 使用 IOSModal 重构
 *
 * 输入: SiteGroupDialogProps (模式、分组名称、编辑分组、回调函数)
 * 输出: React 组件 (站点分组对话框 UI)
 * 定位: 展示层 - 站点分组对话框，支持创建和编辑分组
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 使用 IOSModal 重构
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useRef, useEffect } from 'react';
import { FolderPlus, Edit3 } from 'lucide-react';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';
import { IOSInput } from '../IOSInput';

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
      }, 100);
    }
  }, [isOpen, mode]);

  const title = mode === 'create' ? '新建站点分组' : '编辑站点分组';
  const confirmText = mode === 'create' ? '确认创建' : '保存修改';
  const titleIcon =
    mode === 'create' ? <FolderPlus className="w-5 h-5" /> : <Edit3 className="w-5 h-5" />;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onConfirm();
    }
  };

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      titleIcon={titleIcon}
      size="sm"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onClose}>
            取消
          </IOSButton>
          <IOSButton variant="primary" onClick={onConfirm}>
            {confirmText}
          </IOSButton>
        </>
      }
    >
      <div className="space-y-3">
        <IOSInput
          ref={inputRef}
          label="分组名称"
          value={groupName}
          onChange={e => onGroupNameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          placeholder="请输入分组名称"
          autoFocus
        />
      </div>
    </IOSModal>
  );
}
