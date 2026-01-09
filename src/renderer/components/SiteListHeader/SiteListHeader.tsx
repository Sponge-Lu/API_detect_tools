/**
 * @file src/renderer/components/SiteListHeader/SiteListHeader.tsx
 * @description 站点列表表头组件
 *
 * 输入: SiteListHeaderProps (列宽数组、列宽变更回调)
 * 输出: React 组件 (站点列表表头 UI)
 * 定位: 展示层 - 站点列表表头组件，显示各列标题，支持列宽调整
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/SiteListHeader/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.13
 * @updated 2025-01-09 - iOS 原生风格优化：移除渐变背景，使用透明背景
 */

import { useRef, useCallback } from 'react';
import { COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH } from '../../../shared/constants';

interface SiteListHeaderProps {
  columnWidths: number[];
  onColumnWidthChange: (index: number, width: number) => void;
}

const COLUMN_LABELS = [
  '站点',
  '余额',
  '今日消费',
  '总 Token',
  '输入',
  '输出',
  '请求',
  'RPM',
  'TPM',
  '模型数',
  '更新时间',
  'CC-CX-Gemini?',
  'LDC比例',
];

export function SiteListHeader({ columnWidths, onColumnWidthChange }: SiteListHeaderProps) {
  const resizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      resizingRef.current = {
        index,
        startX: e.clientX,
        startWidth: columnWidths[index],
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const { index, startX, startWidth } = resizingRef.current;
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, startWidth + delta));
        onColumnWidthChange(index, newWidth);
      };

      const handleMouseUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [columnWidths, onColumnWidthChange]
  );

  return (
    <div
      className="grid gap-x-1 items-center px-3 py-2 text-xs font-medium text-[var(--ios-text-secondary)] uppercase tracking-wide"
      style={{
        gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' ') + ' 1fr',
      }}
    >
      {COLUMN_LABELS.map((label, index) => (
        <div key={label} className="relative flex items-center">
          <span className={index >= 4 || index === 11 || index === 12 ? 'text-center w-full' : ''}>
            {label}
          </span>
          {/* 列宽调整手柄 */}
          {index < COLUMN_LABELS.length - 1 && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary-400/50 transition-colors"
              onMouseDown={e => handleMouseDown(e, index)}
            />
          )}
        </div>
      ))}
      {/* 操作列占位 */}
      <div className="text-right">操作</div>
    </div>
  );
}
