/**
 * 输入: Config (应用配置), SiteGroup (站点分组), DialogState (对话框状态)
 * 输出: 分组管理方法 (addGroup, deleteGroup, updateGroup, reorderGroups)
 * 定位: 业务逻辑层 - 管理站点分组操作和状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState } from 'react';
import type { Config, SiteGroup } from '../App';
import type { DialogState } from '../components/ConfirmDialog';

interface UseSiteGroupsOptions {
  config: Config | null;
  saveConfig: (config: Config) => Promise<void>;
  showDialog: (options: Partial<DialogState> & { message: string }) => Promise<boolean>;
  showAlert: (message: string, type: 'success' | 'error' | 'alert' | 'warning') => void;
  activeSiteGroupFilter: string | null;
  setActiveSiteGroupFilter: (filter: string | null) => void;
  defaultGroupId: string;
}

export function useSiteGroups({
  config,
  saveConfig,
  showDialog,
  showAlert,
  activeSiteGroupFilter,
  setActiveSiteGroupFilter,
  defaultGroupId,
}: UseSiteGroupsOptions) {
  // 弹窗状态
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SiteGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState('');

  const openCreateGroupDialog = () => {
    setNewGroupName('');
    setShowCreateGroupDialog(true);
  };

  const openEditGroupDialog = (group: SiteGroup) => {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setShowEditGroupDialog(true);
  };

  const closeCreateGroupDialog = () => {
    setShowCreateGroupDialog(false);
    setNewGroupName('');
  };

  const closeEditGroupDialog = () => {
    setShowEditGroupDialog(false);
    setEditingGroup(null);
    setEditGroupName('');
  };

  const confirmCreateSiteGroup = async () => {
    if (!config) return;

    const trimmed = newGroupName.trim();
    if (!trimmed) {
      alert('分组名称不能为空');
      return;
    }

    const existingGroups: SiteGroup[] = Array.isArray(config.siteGroups) ? config.siteGroups : [];

    if (existingGroups.some(g => g.name === trimmed)) {
      alert('已存在同名分组，请使用其他名称');
      return;
    }

    const baseId =
      trimmed
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '') || 'group';
    let id = baseId;
    let counter = 1;
    while (existingGroups.some(g => g.id === id)) {
      id = `${baseId}-${counter++}`;
    }

    await saveConfig({
      ...config,
      siteGroups: [...existingGroups, { id, name: trimmed }],
    });

    closeCreateGroupDialog();
  };

  const confirmEditSiteGroup = async () => {
    if (!config || !editingGroup) return;

    const trimmed = editGroupName.trim();
    if (!trimmed) {
      alert('分组名称不能为空');
      return;
    }

    const existingGroups: SiteGroup[] = Array.isArray(config.siteGroups) ? config.siteGroups : [];

    if (existingGroups.some(g => g.name === trimmed && g.id !== editingGroup.id)) {
      showAlert('已存在同名分组，请使用其他名称', 'error');
      return;
    }

    await saveConfig({
      ...config,
      siteGroups: existingGroups.map(g => (g.id === editingGroup.id ? { ...g, name: trimmed } : g)),
    });

    closeEditGroupDialog();
  };

  const deleteSiteGroup = async (groupId: string) => {
    if (!config) return;

    if (groupId === defaultGroupId) {
      showAlert('默认分组不能删除', 'error');
      return;
    }

    const existingGroups: SiteGroup[] = Array.isArray(config.siteGroups) ? config.siteGroups : [];
    const groupToDelete = existingGroups.find(g => g.id === groupId);
    if (!groupToDelete) return;

    const sitesInGroup = config.sites.filter(s => (s.group || defaultGroupId) === groupId);
    const confirmMsg =
      sitesInGroup.length > 0
        ? `确定要删除分组「${groupToDelete.name}」吗？\n\n该分组下有 ${sitesInGroup.length} 个站点，删除后这些站点将被移动到默认分组。`
        : `确定要删除分组「${groupToDelete.name}」吗？`;

    const confirmed = await showDialog({
      type: 'warning',
      title: '删除分组',
      message: confirmMsg,
      confirmText: '删除',
    });
    if (!confirmed) return;

    const newSites = config.sites.map(s =>
      (s.group || defaultGroupId) === groupId ? { ...s, group: defaultGroupId } : s
    );

    if (activeSiteGroupFilter === groupId) {
      setActiveSiteGroupFilter(null);
    }

    await saveConfig({
      ...config,
      sites: newSites,
      siteGroups: existingGroups.filter(g => g.id !== groupId),
    });
  };

  const toggleSiteGroupFilter = (groupId: string) => {
    setActiveSiteGroupFilter(activeSiteGroupFilter === groupId ? null : groupId);
  };

  return {
    // 弹窗状态
    showCreateGroupDialog,
    newGroupName,
    setNewGroupName,
    showEditGroupDialog,
    editingGroup,
    editGroupName,
    setEditGroupName,
    // 操作
    openCreateGroupDialog,
    openEditGroupDialog,
    closeCreateGroupDialog,
    closeEditGroupDialog,
    confirmCreateSiteGroup,
    confirmEditSiteGroup,
    deleteSiteGroup,
    toggleSiteGroupFilter,
  };
}
