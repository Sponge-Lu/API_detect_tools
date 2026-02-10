/**
 * @file src/renderer/components/IOSModal/IOSModal.tsx
 * @description iOS 风格弹窗组件
 *
 * 功能:
 * - iOS 原生风格样式（圆角、毛玻璃背景、居中、无外边框）
 * - 遮罩层（半透明黑色背景 + 模糊）
 * - 打开/关闭动画（缩放 + 淡入淡出）
 * - 按钮布局（底部横向排列，主要操作在右侧）
 * - 支持 ESC 键关闭
 * - 支持点击遮罩关闭
 * - 使用 8px 网格间距系统
 * - 无障碍性支持（焦点管理、ARIA 属性、键盘导航）
 * - 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）
 *
 * @version 2.1.13
 * @updated 2025-01-09 - iOS 原生风格优化：确认无外边框设计
 */

import React, { useEffect, useRef, useCallback, useId } from 'react';
import { X } from 'lucide-react';

export interface IOSModalProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title?: React.ReactNode;
  /** 标题图标 */
  titleIcon?: React.ReactNode;
  /** 子元素 */
  children: React.ReactNode;
  /** 底部操作按钮 */
  footer?: React.ReactNode;
  /** 弹窗尺寸 */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 是否显示关闭按钮 */
  showCloseButton?: boolean;
  /** 是否点击遮罩关闭 */
  closeOnOverlayClick?: boolean;
  /** 是否按 ESC 键关闭 */
  closeOnEsc?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 内容区域自定义类名 */
  contentClassName?: string;
  /** 弹窗描述（用于屏幕阅读器） */
  'aria-describedby'?: string;
}

export function IOSModal({
  isOpen,
  onClose,
  title,
  titleIcon,
  children,
  footer,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  className = '',
  contentClassName = '',
  'aria-describedby': ariaDescribedBy,
}: IOSModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [shouldRender, setShouldRender] = React.useState(false);

  // 生成唯一 ID
  const titleId = useId();
  const descriptionId = useId();

  // 处理打开/关闭动画和焦点管理
  useEffect(() => {
    if (isOpen) {
      // 保存当前焦点元素
      previousActiveElement.current = document.activeElement as HTMLElement;

      setShouldRender(true);
      // 延迟一帧以触发动画
      requestAnimationFrame(() => {
        setIsAnimating(true);
        // 将焦点移到弹窗
        setTimeout(() => {
          modalRef.current?.focus();
        }, 100);
      });
    } else {
      setIsAnimating(false);
      // 等待动画完成后移除 DOM
      const timer = setTimeout(() => {
        setShouldRender(false);
        // 恢复之前的焦点
        previousActiveElement.current?.focus();
      }, 300); // 与动画时长匹配
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEsc, onClose]);

  // 焦点陷阱 - 确保焦点保持在弹窗内
  useEffect(() => {
    if (!isOpen || !shouldRender) return;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleTabKey);
    return () => window.removeEventListener('keydown', handleTabKey);
  }, [isOpen, shouldRender]);

  // 点击遮罩关闭
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  // 尺寸样式
  const sizeStyles = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-3xl',
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`
        fixed inset-0 z-[200]
        flex items-center justify-center
        transition-opacity duration-[var(--duration-normal)]
        [transition-timing-function:var(--ease-ios)]
        [will-change:opacity]
        ${isAnimating ? 'opacity-100' : 'opacity-0'}
      `
        .replace(/\s+/g, ' ')
        .trim()}
      onClick={handleOverlayClick}
      role="presentation"
    >
      {/* 遮罩层 - iOS 风格半透明黑色 + 模糊 + GPU 加速 */}
      <div
        className={`
          absolute inset-0
          bg-black/40
          backdrop-blur-[8px]
          [-webkit-backdrop-filter:blur(8px)]
          [will-change:opacity,backdrop-filter]
          [transform:translateZ(0)]
          transition-opacity duration-[var(--duration-normal)]
          [transition-timing-function:var(--ease-ios)]
          ${isAnimating ? 'opacity-100' : 'opacity-0'}
        `
          .replace(/\s+/g, ' ')
          .trim()}
        aria-hidden="true"
        data-perf-monitor="blur"
      />

      {/* 弹窗内容 - GPU 加速动画 */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={ariaDescribedBy || descriptionId}
        tabIndex={-1}
        className={`
          relative
          w-full mx-4
          ${sizeStyles[size]}
          bg-[var(--ios-bg-secondary)]
          backdrop-blur-[20px]
          [-webkit-backdrop-filter:blur(20px)]
          rounded-[var(--radius-xl)]
          shadow-[var(--shadow-xl)]
          overflow-hidden
          [will-change:transform,opacity,backdrop-filter]
          [backface-visibility:hidden]
          [transform-origin:center_center]
          transition-[transform,opacity] duration-[var(--duration-normal)]
          [transition-timing-function:var(--ease-ios)]
          ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ios-blue)] focus-visible:ring-offset-2
          ${className}
        `
          .replace(/\s+/g, ' ')
          .trim()}
        onClick={e => e.stopPropagation()}
        data-perf-monitor="blur"
      >
        {/* 标题栏 */}
        {(title || showCloseButton) && (
          <div
            className={`
              flex items-center justify-between
              px-[var(--spacing-2xl)] py-[var(--spacing-lg)]
              border-b border-[var(--ios-separator)]
            `
              .replace(/\s+/g, ' ')
              .trim()}
          >
            <div className="flex items-center gap-[var(--spacing-md)]">
              {titleIcon && (
                <span className="text-[var(--ios-blue)]" aria-hidden="true">
                  {titleIcon}
                </span>
              )}
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-[var(--ios-text-primary)]">
                  {title}
                </h2>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label="关闭弹窗"
                title="关闭"
                className={`
                  p-[var(--spacing-sm)] -mr-[var(--spacing-sm)]
                  rounded-[var(--radius-md)]
                  text-[var(--ios-gray)]
                  hover:bg-[rgba(0,0,0,0.05)]
                  dark:hover:bg-[rgba(255,255,255,0.1)]
                  transition-all duration-[var(--duration-fast)]
                  [transition-timing-function:var(--ease-ios)]
                  active:scale-95
                  focus-visible:outline-2 focus-visible:outline-[var(--ios-blue)] focus-visible:outline-offset-2
                `
                  .replace(/\s+/g, ' ')
                  .trim()}
              >
                <X className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* 内容区域 */}
        <div
          id={!ariaDescribedBy ? descriptionId : undefined}
          className={`
            px-[var(--spacing-2xl)] py-[var(--spacing-lg)]
            max-h-[60vh] overflow-y-auto
            ${contentClassName}
          `
            .replace(/\s+/g, ' ')
            .trim()}
        >
          {children}
        </div>

        {/* 底部操作区域 */}
        {footer && (
          <div
            className={`
              flex items-center justify-end gap-[var(--spacing-md)]
              px-[var(--spacing-2xl)] py-[var(--spacing-lg)]
              border-t border-[var(--ios-separator)]
              bg-[var(--ios-bg-tertiary)]
            `
              .replace(/\s+/g, ' ')
              .trim()}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
