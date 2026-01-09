/**
 * @file src/renderer/components/IOSIcon/IOSIcon.tsx
 * @description iOS 风格图标组件，统一图标样式和尺寸
 *
 * 输入: IOSIconProps (图标组件、尺寸、颜色变体、className)
 * 输出: React 组件 (统一样式的图标)
 * 定位: 展示层 - iOS 设计系统图标组件
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
import type { LucideIcon, LucideProps } from 'lucide-react';

export type IOSIconSize = 'sm' | 'md' | 'lg';
export type IOSIconVariant = 'default' | 'primary' | 'success' | 'error' | 'warning' | 'muted';

export interface IOSIconProps extends Omit<LucideProps, 'size'> {
  /** Lucide 图标组件 */
  icon: LucideIcon;
  /** 图标尺寸: sm (16px), md (20px), lg (24px) */
  size?: IOSIconSize;
  /** 颜色变体 */
  variant?: IOSIconVariant;
  /** 额外的 className */
  className?: string;
  /** 无障碍标签 */
  'aria-label'?: string;
}

// 尺寸映射
const sizeMap: Record<IOSIconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

// 尺寸 CSS 类映射
const sizeClassMap: Record<IOSIconSize, string> = {
  sm: 'ios-icon-sm',
  md: 'ios-icon-md',
  lg: 'ios-icon-lg',
};

// 颜色变体 CSS 类映射
const variantClassMap: Record<IOSIconVariant, string> = {
  default: '',
  primary: 'ios-icon-primary',
  success: 'ios-icon-success',
  error: 'ios-icon-error',
  warning: 'ios-icon-warning',
  muted: 'ios-icon-muted',
};

/**
 * iOS 风格图标组件
 *
 * 特性:
 * - 统一 stroke-width 为 2px
 * - 标准尺寸: 16px (sm), 20px (md), 24px (lg)
 * - 支持颜色变体
 * - 支持无障碍标签
 *
 * @example
 * ```tsx
 * import { Settings, Trash2 } from 'lucide-react';
 *
 * <IOSIcon icon={Settings} size="md" />
 * <IOSIcon icon={Trash2} size="sm" variant="error" aria-label="删除" />
 * ```
 */
export const IOSIcon: React.FC<IOSIconProps> = ({
  icon: Icon,
  size = 'md',
  variant = 'default',
  className = '',
  'aria-label': ariaLabel,
  ...props
}) => {
  const sizeValue = sizeMap[size];
  const sizeClass = sizeClassMap[size];
  const variantClass = variantClassMap[variant];

  const combinedClassName = ['ios-icon', sizeClass, variantClass, className]
    .filter(Boolean)
    .join(' ');

  return (
    <Icon
      className={combinedClassName}
      width={sizeValue}
      height={sizeValue}
      strokeWidth={2}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
      {...props}
    />
  );
};

export default IOSIcon;
