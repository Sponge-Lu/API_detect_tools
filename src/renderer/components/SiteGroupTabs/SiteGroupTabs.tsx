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
    <div className="sticky top-0 z-10 bg-light-bg/95 dark:bg-dark-bg/95 backdrop-blur-sm py-2 -mx-4 px-4">
      <div className="flex items-center gap-2 flex-wrap">
        {/* 全部标签 */}
        <button
          onClick={() => onSelectGroup(null)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeGroupId === null
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300/50 dark:hover:bg-slate-600/50'
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
                ? 'bg-primary-500 text-white shadow-md'
                : 'bg-slate-200/50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 hover:bg-slate-300/50 dark:hover:bg-slate-600/50'
            } ${dragOverGroupIndex === index ? 'ring-2 ring-primary-500 scale-105' : ''} ${
              dragOverGroupId === group.id ? 'ring-2 ring-accent-500 bg-accent-500/20' : ''
            } ${editingGroupId !== group.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            {editingGroupId === group.id ? (
              // 编辑模式
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  className="w-20 px-1 py-0.5 text-xs bg-white dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-600 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveEdit();
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <button
                  onClick={handleSaveEdit}
                  className="p-0.5 hover:bg-green-500/20 rounded"
                  title="保存"
                >
                  <Check className="w-3 h-3 text-green-500" />
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="p-0.5 hover:bg-red-500/20 rounded"
                  title="取消"
                >
                  <X className="w-3 h-3 text-red-500" />
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
                      className="p-0.5 hover:bg-white/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="编辑分组"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onDeleteGroup(group.id);
                      }}
                      className="p-0.5 hover:bg-red-500/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除分组"
                    >
                      <Trash2 className="w-3 h-3 text-red-500" />
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
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-200/30 dark:bg-slate-700/30 text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-all border border-dashed border-slate-300 dark:border-slate-600"
          title="添加分组"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加分组</span>
        </button>
      </div>
    </div>
  );
}
