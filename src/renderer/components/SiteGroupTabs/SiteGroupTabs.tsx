/**
 * 输入: SiteGroupTabsProps (分组列表、活动分组、拖拽状态、操作回调)
 * 输出: React 组件 (站点分组标签 UI)
 * 定位: 展示层 - 站点分组标签组件，支持分组筛选、拖拽排序、编辑和删除
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteGroupTabs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import type { SiteGroup } from '../../App';

interface SiteGroupTabsProps {
  groups: SiteGroup[];
  activeGroupId: string | null;
  draggedGroupIndex: number | null;
  dragOverGroupIndex: number | null;

  onSelectGroup: (groupId: string | null) => void;
  onAddGroup: () => void;
  onEditGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;

  // 拖拽回调
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;

  // 站点拖到分组上
  onSiteDragOverGroup: (groupId: string) => void;
  onSiteDropOnGroup: (groupId: string) => void;
  dragOverGroupId: string | null;
}

export function SiteGroupTabs({
  groups,
  activeGroupId,
  draggedGroupIndex: _draggedGroupIndex,
  dragOverGroupIndex,
  onSelectGroup,
  onAddGroup,
  onEditGroup,
  onDeleteGroup,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSiteDragOverGroup,
  onSiteDropOnGroup: _onSiteDropOnGroup,
  dragOverGroupId,
}: SiteGroupTabsProps) {
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleStartEdit = (group: SiteGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
  };

  const handleSaveEdit = () => {
    if (editingGroupId && editingName.trim()) {
      onEditGroup(editingGroupId, editingName.trim());
    }
    setEditingGroupId(null);
    setEditingName('');
  };

  const handleCancelEdit = () => {
    setEditingGroupId(null);
    setEditingName('');
  };

  return (
    <div className="-mx-4 sticky top-0 z-10 bg-[var(--app-bg)]/95 px-4 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2 flex-wrap">
        {/* 全部标签 */}
        <button
          onClick={() => onSelectGroup(null)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeGroupId === null
              ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-sm)]'
              : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'
          }`}
        >
          全部
        </button>

        {/* 分组标签 */}
        {groups.map((group, index) => (
          <div
            key={group.id}
            draggable={editingGroupId !== group.id}
            onDragStart={() => onDragStart(index)}
            onDragOver={e => {
              e.preventDefault();
              onDragOver(e, index);
            }}
            onDrop={e => onDrop(e, index)}
            onDragEnd={onDragEnd}
            // 支持站点拖到分组上
            onDragEnter={() => onSiteDragOverGroup(group.id)}
            onDragLeave={() => onSiteDragOverGroup('')}
            className={`relative flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              activeGroupId === group.id
                ? 'bg-[var(--accent)] text-white shadow-[var(--shadow-sm)]'
                : 'bg-[var(--surface-2)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'
            } ${dragOverGroupIndex === index ? 'scale-105 ring-2 ring-[var(--accent)]' : ''} ${
              dragOverGroupId === group.id
                ? 'bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]'
                : ''
            } ${editingGroupId !== group.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            {editingGroupId === group.id ? (
              // 编辑模式
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  className="w-20 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-1 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <button
                  onClick={handleSaveEdit}
                  className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--success-soft)]"
                  title="保存"
                  aria-label="保存分组名称"
                >
                  <Check
                    className="h-3 w-3 text-[var(--success)]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--danger-soft)]"
                  title="取消"
                  aria-label="取消编辑"
                >
                  <X className="h-3 w-3 text-[var(--danger)]" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ) : (
              // 显示模式
              <>
                <span onClick={() => onSelectGroup(group.id)} className="cursor-pointer">
                  {group.name}
                </span>
                {group.id !== 'default' && (
                  <div className="flex items-center gap-0.5 ml-1">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleStartEdit(group);
                      }}
                      className="rounded-[var(--radius-sm)] p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--hover-overlay)]"
                      title="编辑分组"
                      aria-label={`编辑分组 ${group.name}`}
                    >
                      <Pencil className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteGroup(group.id);
                      }}
                      className="rounded-[var(--radius-sm)] p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--danger-soft)]"
                      title="删除分组"
                      aria-label={`删除分组 ${group.name}`}
                    >
                      <Trash2
                        className="h-3 w-3 text-[var(--danger)]"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* 添加分组按钮 */}
        <button
          onClick={onAddGroup}
          className="flex items-center gap-1 rounded-lg border border-dashed border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-all hover:bg-[var(--surface-3)]"
          title="添加分组"
          aria-label="添加新分组"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
          <span>添加分组</span>
        </button>
      </div>
    </div>
  );
}
