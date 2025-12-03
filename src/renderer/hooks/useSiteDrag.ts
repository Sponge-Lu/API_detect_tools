/**
 * 站点拖拽排序 Hook
 * 封装站点拖拽相关的状态和逻辑
 */

import { useCallback } from 'react';
import { useUIStore } from '../store/uiStore';
import type { Config } from '../App';

interface UseSiteDragOptions {
  config: Config | null;
  saveConfig: (config: Config) => Promise<void>;
}

export function useSiteDrag({ config, saveConfig }: UseSiteDragOptions) {
  const {
    draggedIndex,
    setDraggedIndex,
    dragOverIndex,
    setDragOverIndex,
    dragOverGroupId,
    setDragOverGroupId,
  } = useUIStore();

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-no-drag="true"]')) {
        e.preventDefault();
        return;
      }
      setDraggedIndex(index);
      e.dataTransfer.effectAllowed = 'move';
      (e.target as HTMLElement).style.opacity = '0.5';
      setDragOverGroupId(null);
    },
    [setDraggedIndex, setDragOverGroupId]
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      (e.target as HTMLElement).style.opacity = '1';
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragOverGroupId(null);
    },
    [setDraggedIndex, setDragOverIndex, setDragOverGroupId]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      setDragOverIndex(index);
    },
    [setDragOverIndex]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverIndex(null);
    },
    [setDragOverIndex]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      if (!config || draggedIndex === null || draggedIndex === dropIndex) {
        setDragOverIndex(null);
        setDragOverGroupId(null);
        return;
      }
      const newSites = [...config.sites];
      const [draggedSite] = newSites.splice(draggedIndex, 1);
      newSites.splice(dropIndex, 0, draggedSite);
      await saveConfig({ ...config, sites: newSites });
      setDragOverIndex(null);
      setDragOverGroupId(null);
    },
    [config, draggedIndex, saveConfig, setDragOverIndex, setDragOverGroupId]
  );

  const handleDropOnGroup = useCallback(
    async (e: React.DragEvent, targetGroupId: string) => {
      e.preventDefault();
      if (!config || draggedIndex === null) {
        setDragOverGroupId(null);
        return;
      }
      const newSites = [...config.sites];
      const originalSite = newSites[draggedIndex];
      if (!originalSite || originalSite.group === targetGroupId) {
        setDragOverGroupId(null);
        return;
      }
      newSites[draggedIndex] = { ...originalSite, group: targetGroupId || 'default' };
      await saveConfig({ ...config, sites: newSites });
      setDragOverGroupId(null);
    },
    [config, draggedIndex, saveConfig, setDragOverGroupId]
  );

  return {
    draggedIndex,
    dragOverIndex,
    dragOverGroupId,
    setDragOverGroupId,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDropOnGroup,
  };
}
