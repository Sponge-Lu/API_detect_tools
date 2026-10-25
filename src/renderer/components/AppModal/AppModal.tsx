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
  overlayZIndexClassName = 'z-[var(--z-modal)]',
  contentClassName = '',
  'aria-describedby': ariaDescribedBy,
}: AppModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const overlayPointerDownFromBackdrop = useRef(false);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalInstanceId = useId();
  const titleId = useId();
  const descriptionId = useId();

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
    if (!shouldRender) {
      return;
    }

    registerOpenOverlay(modalInstanceId);

    return () => {
      unregisterOpenOverlay(modalInstanceId);
    };
  }, [modalInstanceId, shouldRender]);

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
      const shouldClose =
        closeOnOverlayClick &&
        overlayPointerDownFromBackdrop.current &&
        event.target === event.currentTarget;

      overlayPointerDownFromBackdrop.current = false;

      if (shouldClose) {
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
        'fixed inset-0 overflow-y-auto p-4 transition-opacity duration-200',
        overlayZIndexClassName,
        isAnimating ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
      onMouseDown={event => {
        overlayPointerDownFromBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className={[
          'absolute inset-0 bg-[var(--overlay-mask)] backdrop-blur-[4px] transition-opacity duration-200',
          isAnimating ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        aria-hidden="true"
      />

      <div className="relative flex min-h-full w-full items-center justify-center pointer-events-none">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={ariaDescribedBy || descriptionId}
          tabIndex={-1}
          className={[
            'pointer-events-auto relative flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-clip rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] transition-[transform,opacity] duration-200 focus:outline-none',
            sizeStyles[size],
            isAnimating ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
            className,
          ].join(' ')}
          onClick={event => event.stopPropagation()}
        >
          {(title || showCloseButton) && (
            <div
              data-testid="overlay-title"
              className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {titleIcon ? (
                  <span
                    className="flex shrink-0 items-center text-[var(--accent)] [&>svg]:h-4 [&>svg]:w-4"
                    aria-hidden="true"
                  >
                    {titleIcon}
                  </span>
                ) : null}
                {title ? (
                  <h2
                    id={titleId}
                    className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]"
                  >
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
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors duration-[var(--duration-hover)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}

          <div
            id={!ariaDescribedBy ? descriptionId : undefined}
            data-testid="overlay-body"
            className={['min-h-0 flex-1 overflow-y-auto px-5 py-4', contentClassName]
              .join(' ')
              .trim()}
          >
            {children}
          </div>

          {footer ? (
            <div
              data-testid="overlay-footer"
              className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--line-soft)] bg-[var(--surface-1)] px-5 py-3"
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
