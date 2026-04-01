import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const openOverlayStack: string[] = [];

export function registerOpenOverlay(overlayId: string) {
  const existingIndex = openOverlayStack.indexOf(overlayId);
  if (existingIndex !== -1) {
    openOverlayStack.splice(existingIndex, 1);
  }

  openOverlayStack.push(overlayId);
}

export function unregisterOpenOverlay(overlayId: string) {
  const existingIndex = openOverlayStack.indexOf(overlayId);
  if (existingIndex !== -1) {
    openOverlayStack.splice(existingIndex, 1);
  }
}

export function isTopmostOverlay(overlayId: string) {
  return openOverlayStack[openOverlayStack.length - 1] === overlayId;
}

export interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  className?: string;
  overlayZIndexClassName?: string;
  contentClassName?: string;
  'aria-describedby'?: string;
}

const sizeStyles: Record<NonNullable<AppModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-3xl',
};

export function AppModal({
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
  overlayZIndexClassName = 'z-[200]',
  contentClassName = '',
  'aria-describedby': ariaDescribedBy,
}: AppModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalInstanceId = useId();
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) {
      unregisterOpenOverlay(modalInstanceId);
      return;
    }

    registerOpenOverlay(modalInstanceId);

    return () => {
      unregisterOpenOverlay(modalInstanceId);
    };
  }, [isOpen, modalInstanceId]);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setShouldRender(true);

      requestAnimationFrame(() => {
        setIsAnimating(true);
        setTimeout(() => modalRef.current?.focus(), 80);
      });
      return;
    }

    setIsAnimating(false);
    const timer = setTimeout(() => {
      setShouldRender(false);
      previousActiveElement.current?.focus();
    }, 220);

    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnEsc) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostOverlay(modalInstanceId)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEsc, isOpen, modalInstanceId, onClose]);

  useEffect(() => {
    if (!isOpen || !shouldRender || !modalRef.current) {
      return;
    }

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modalRef.current) {
        return;
      }

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    };

    window.addEventListener('keydown', handleTabKey);
    return () => window.removeEventListener('keydown', handleTabKey);
  }, [isOpen, shouldRender]);

  const handleOverlayClick = useCallback(
    (event: React.MouseEvent) => {
      if (closeOnOverlayClick && event.target === event.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  if (!shouldRender) {
    return null;
  }

  return createPortal(
    <div
      className={[
        'fixed inset-0 flex items-center justify-center overflow-y-auto p-4 transition-opacity duration-200',
        overlayZIndexClassName,
        isAnimating ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className={[
          'absolute inset-0 bg-[var(--overlay-mask)] backdrop-blur-[8px] transition-opacity duration-200',
          isAnimating ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden="true"
      />

      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={ariaDescribedBy || descriptionId}
        tabIndex={-1}
        className={[
          'relative my-auto w-full overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] transition-[transform,opacity] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2',
          sizeStyles[size],
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
          className,
        ].join(' ')}
        onClick={event => event.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div
            data-testid="overlay-title"
            className="flex items-center justify-between border-b border-[var(--line-soft)] px-6 py-4"
          >
            <div className="flex items-center gap-3">
              {titleIcon ? (
                <span className="text-[var(--accent)]" aria-hidden="true">
                  {titleIcon}
                </span>
              ) : null}
              {title ? (
                <h2 id={titleId} className="text-lg font-semibold text-[var(--text-primary)]">
                  {title}
                </h2>
              ) : null}
            </div>
            {showCloseButton ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭弹窗"
                title="关闭"
                className="rounded-[var(--radius-md)] p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
              >
                <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}

        <div
          id={!ariaDescribedBy ? descriptionId : undefined}
          data-testid="overlay-body"
          className={['max-h-[60vh] overflow-y-auto px-6 py-4', contentClassName].join(' ').trim()}
        >
          {children}
        </div>

        {footer ? (
          <div
            data-testid="overlay-footer"
            className="flex items-center justify-end gap-3 border-t border-[var(--line-soft)] bg-[var(--surface-2)] px-6 py-4"
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
