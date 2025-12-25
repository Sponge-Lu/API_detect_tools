/**
 * 输入: 模拟的站点配置和分组数据
 * 输出: 测试验证结果
 * 定位: 测试层 - useSiteGroups Hook 测试，验证站点分组管理逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSiteGroups } from '../renderer/hooks/useSiteGroups';

describe('useSiteGroups', () => {
  const mockConfig = {
    sites: [
      {
        name: 'Site 1',
        url: 'https://site1.com',
        enabled: true,
        group: 'default',
        api_key: 'sk-test1',
      },
      {
        name: 'Site 2',
        url: 'https://site2.com',
        enabled: true,
        group: 'group-a',
        api_key: 'sk-test2',
      },
    ],
    settings: {
      timeout: 30000,
      concurrent: true,
      show_disabled: true,
      auto_refresh: false,
      refresh_interval: 60,
    },
    siteGroups: [
      { id: 'default', name: '默认分组' },
      { id: 'group-a', name: '分组A' },
    ],
  };

  const mockSaveConfig = vi.fn().mockResolvedValue(undefined);
  const mockShowDialog = vi.fn().mockResolvedValue(true);
  const mockShowAlert = vi.fn();
  const mockSetActiveSiteGroupFilter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createHook = (overrides = {}) => {
    return renderHook(() =>
      useSiteGroups({
        config: mockConfig,
        saveConfig: mockSaveConfig,
        showDialog: mockShowDialog,
        showAlert: mockShowAlert,
        activeSiteGroupFilter: null,
        setActiveSiteGroupFilter: mockSetActiveSiteGroupFilter,
        defaultGroupId: 'default',
        ...overrides,
      })
    );
  };

  describe('dialog state', () => {
    it('initializes with dialogs closed', () => {
      const { result } = createHook();
      expect(result.current.showCreateGroupDialog).toBe(false);
      expect(result.current.showEditGroupDialog).toBe(false);
      expect(result.current.editingGroup).toBeNull();
    });

    it('opens create dialog', () => {
      const { result } = createHook();
      act(() => {
        result.current.openCreateGroupDialog();
      });
      expect(result.current.showCreateGroupDialog).toBe(true);
      expect(result.current.newGroupName).toBe('');
    });

    it('opens edit dialog with group data', () => {
      const { result } = createHook();
      const group = { id: 'group-a', name: '分组A' };
      act(() => {
        result.current.openEditGroupDialog(group);
      });
      expect(result.current.showEditGroupDialog).toBe(true);
      expect(result.current.editingGroup).toEqual(group);
      expect(result.current.editGroupName).toBe('分组A');
    });

    it('closes create dialog', () => {
      const { result } = createHook();
      act(() => {
        result.current.openCreateGroupDialog();
      });
      act(() => {
        result.current.closeCreateGroupDialog();
      });
      expect(result.current.showCreateGroupDialog).toBe(false);
    });

    it('closes edit dialog', () => {
      const { result } = createHook();
      act(() => {
        result.current.openEditGroupDialog({ id: 'test', name: 'Test' });
      });
      act(() => {
        result.current.closeEditGroupDialog();
      });
      expect(result.current.showEditGroupDialog).toBe(false);
      expect(result.current.editingGroup).toBeNull();
    });
  });

  describe('toggleSiteGroupFilter', () => {
    it('sets filter when clicking different group', () => {
      const { result } = createHook();
      act(() => {
        result.current.toggleSiteGroupFilter('group-a');
      });
      expect(mockSetActiveSiteGroupFilter).toHaveBeenCalledWith('group-a');
    });

    it('clears filter when clicking same group', () => {
      const { result } = createHook({ activeSiteGroupFilter: 'group-a' });
      act(() => {
        result.current.toggleSiteGroupFilter('group-a');
      });
      expect(mockSetActiveSiteGroupFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('confirmCreateSiteGroup', () => {
    it('does nothing with empty name', async () => {
      const { result } = createHook();
      act(() => {
        result.current.openCreateGroupDialog();
      });
      await act(async () => {
        await result.current.confirmCreateSiteGroup();
      });
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('creates group with valid name', async () => {
      const { result } = createHook();
      act(() => {
        result.current.openCreateGroupDialog();
        result.current.setNewGroupName('新分组');
      });
      await act(async () => {
        await result.current.confirmCreateSiteGroup();
      });
      expect(mockSaveConfig).toHaveBeenCalled();
      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.siteGroups).toHaveLength(3);
      expect(savedConfig.siteGroups[2].name).toBe('新分组');
    });
  });

  describe('deleteSiteGroup', () => {
    it('prevents deleting default group', async () => {
      const { result } = createHook();
      await act(async () => {
        await result.current.deleteSiteGroup('default');
      });
      expect(mockShowAlert).toHaveBeenCalledWith('默认分组不能删除', 'error');
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('deletes non-default group after confirmation', async () => {
      const { result } = createHook();
      await act(async () => {
        await result.current.deleteSiteGroup('group-a');
      });
      expect(mockShowDialog).toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalled();
      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.siteGroups).toHaveLength(1);
      expect(savedConfig.sites[1].group).toBe('default'); // Site moved to default
    });
  });
});
