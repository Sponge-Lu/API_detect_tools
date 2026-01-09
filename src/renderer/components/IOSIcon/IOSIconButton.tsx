/**
 * @file src/renderer/components/IOSIcon/IOSIconButton.tsx
 * @description iOS 风格图标按钮组件，带有无障碍支持
 *
 * 输入: IOSIconButtonProps (图标、尺寸、标签、点击回调)
 * 输出: React 组件 (带无障碍支持的图标按钮)
 * 定位: 展示层 - iOS 设计系统图标按钮组件
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/IOSIcon/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.11
 * @created 2025-01-09
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { IOSIcon, type IOSIconSize, type IOSIconVariant } from './IOSIcon';

export interface IOSIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lucide 图标组件 */
  icon: LucideIcon;
  /** 图标尺寸: sm (16px), md (20px), lg (24px) */
  size?: IOSIconSize;
  /** 颜色变体 */
  variant?: IOSIconVariant;
  /** 无障碍标签 (必需) - 用于屏幕阅读器 */
  label: string;
  /** 是否显示 tooltip */
  showTooltip?: boolean;
  /** 额外的图标 className */
  iconClassName?: string;
}

/**
 * iOS 风格图标按钮组件
 *
 * 特性:
 * - 自动添加 aria-label 和 title 属性
 * - 统一的悬停和按下效果
 * - 支持禁用状态
 *
 * @example
 * ```tsx
 * import { Settings, Trash2 } from 'lucide-react';
 *
 * <IOSIconButton icon={Settings} label="设置" onClick={handleSettings} />
 * <IOSIconButton icon={Trash2} label="删除" variant="error" onClick={handleDelete} />
 * ```
 */
export const IOSIconButton: React.FC<IOSIconButtonProps> = ({
  icon,
  size = 'md',
  variant = 'default',
  label,
  showTooltip = true,
  iconClassName = '',
  className = '',
  disabled,
  ...props
}) => {
  const combinedClassName = ['ios-icon-button', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={combinedClassName}
      aria-label={label}
      title={showTooltip ? label : undefined}
      disabled={disabled}
      {...props}
    >
      <IOSIcon icon={icon} size={size} variant={variant} className={iconClassName} />
    </button>
  );
};

export default IOSIconButton;
