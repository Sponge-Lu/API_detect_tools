/**
 * @file src/renderer/hooks/useSiteDrag.ts
 * @description 站点拖拽排序 Hook
 *
 * 输入: Config (应用配置), UIStore (UI 状态), 拖拽事件
 * 输出: 拖拽处理方法 (onDragStart, onDragOver, onDrop), 拖拽状态
 * 定位: 业务逻辑层 - 管理站点拖拽排序
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/hooks/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.13
 * @updated 2026-04-02 - 对齐中性滚动容器选择器
 */

/**
 * 站点拖拽排序 Hook
 * 封装站点拖拽相关的状态和逻辑
 */

import { useCallback, useRef, useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import type { Config } from '../App';

interface UseSiteDragOptions {
  config: Config | null;
  saveConfig: (config: Config) => Promise<void>;
  scrollContainerRef?: React.RefObject<HTMLElement>;
}

// 自动滚动配置
const AUTO_SCROLL_THRESHOLD = 80; // 距离边缘多少像素开始滚动
const AUTO_SCROLL_SPEED = 10; // 滚动速度（像素/帧）

export function useSiteDrag({ config, saveConfig, scrollContainerRef }: UseSiteDragOptions) {
  const {
    draggedIndex,
    setDraggedIndex,
    dragOverIndex,
    setDragOverIndex,
    dragOverGroupId,
    setDragOverGroupId,
  } = useUIStore();

  // 自动滚动相关 ref
  const autoScrollRef = useRef<number | null>(null);
  const mouseYRef = useRef<number>(0);

  // 自动滚动逻辑
  const startAutoScroll = useCallback(() => {
    const scroll = () => {
      const container =
        scrollContainerRef?.current || (document.querySelector('.app-scroll-y') as HTMLElement);
      if (!container) {
        autoScrollRef.current = requestAnimationFrame(scroll);
        return;
      }

      const rect = container.getBoundingClientRect();
      const mouseY = mouseYRef.current;

      // 检测是否在顶部边缘
      if (mouseY < rect.top + AUTO_SCROLL_THRESHOLD && mouseY > rect.top) {
        container.scrollTop -= AUTO_SCROLL_SPEED;
      }
      // 检测是否在底部边缘
      else if (mouseY > rect.bottom - AUTO_SCROLL_THRESHOLD && mouseY < rect.bottom) {
        container.scrollTop += AUTO_SCROLL_SPEED;
      }

      autoScrollRef.current = requestAnimationFrame(scroll);
    };

    autoScrollRef.current = requestAnimationFrame(scroll);
  }, [scrollContainerRef]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      cancelAnimationFrame(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  // 清理自动滚动
  useEffect(() => {
    return () => stopAutoScroll();
  }, [stopAutoScroll]);

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

      // 开始自动滚动
      mouseYRef.current = e.clientY;
      startAutoScroll();
    },
    [setDraggedIndex, setDragOverGroupId, startAutoScroll]
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      (e.target as HTMLElement).style.opacity = '1';
      lastDragOverIndexRef.current = null;
      setDraggedIndex(null);
      setDragOverIndex(null);
      setDragOverGroupId(null);

      // 停止自动滚动
      stopAutoScroll();
    },
    [setDraggedIndex, setDragOverIndex, setDragOverGroupId, stopAutoScroll]
  );

  // 使用 ref 跟踪上一次的 dragOverIndex，避免重复设置相同值
  const lastDragOverIndexRef = useRef<number | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();

      // 更新鼠标位置用于自动滚动
      mouseYRef.current = e.clientY;

      // 只有当 index 变化时才更新状态，避免频繁触发重渲染
      if (lastDragOverIndexRef.current !== index) {
        lastDragOverIndexRef.current = index;
        setDragOverIndex(index);
      }
    },
    [setDragOverIndex]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 不在 dragLeave 时清除 dragOverIndex，因为可能是移动到子元素
    // 只有在真正离开卡片区域时才清除（由 dragEnd 或 drop 处理）
  }, []);

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
