import React, { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { OverlayFrame } from './OverlayFrame';
import {
  isTopmostOverlay,
  registerOpenOverlay,
  unregisterOpenOverlay,
} from '../AppModal/AppModal';

export interface OverlayDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  className?: string;
  contentClassName?: string;
  widthClassName?: string;
  'aria-describedby'?: string;
}

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function OverlayDrawer({
  isOpen,
  onClose,
  title,
  titleIcon,
  children,
  footer,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  className = '',
  contentClassName = '',
  widthClassName = 'max-w-[760px]',
  'aria-describedby': ariaDescribedBy,
}: OverlayDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [shouldRender, setShouldRender] = React.useState(false);
  const drawerInstanceId = useId();
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsAnimating(true);
        setTimeout(() => {
          drawerRef.current?.focus();
        }, 100);
      });
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setShouldRender(false);
        previousActiveElement.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!shouldRender) {
      return;
    }

    registerOpenOverlay(drawerInstanceId);

    return () => {
      unregisterOpenOverlay(drawerInstanceId);
    };
  }, [drawerInstanceId, shouldRender]);

  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopmostOverlay(drawerInstanceId)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEsc, drawerInstanceId, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !shouldRender) return;

    const handleTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !drawerRef.current) return;

      const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else if (document.activeElement === lastElement) {
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

  if (!shouldRender) return null;

  return createPortal(
    <div
      className={joinClasses(
        'fixed inset-0 z-[210] flex justify-end p-4 overflow-hidden',
        'transition-opacity duration-[var(--duration-normal)] [transition-timing-function:var(--ease-ios)] [will-change:opacity]',
        isAnimating ? 'opacity-100' : 'opacity-0'
      )}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className={joinClasses(
          'absolute inset-0 bg-black/40 backdrop-blur-[8px] [-webkit-backdrop-filter:blur(8px)]',
          '[will-change:opacity,backdrop-filter] [transform:translateZ(0)]',
          'transition-opacity duration-[var(--duration-normal)] [transition-timing-function:var(--ease-ios)]',
          isAnimating ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden="true"
        data-perf-monitor="blur"
      />

      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={ariaDescribedBy || descriptionId}
        tabIndex={-1}
        className={joinClasses(
          'relative z-[1] h-full w-full',
          widthClassName,
          'transition-[transform,opacity] duration-[var(--duration-normal)] [transition-timing-function:var(--ease-ios)]',
          '[will-change:transform,opacity] [transform-origin:right_center]',
          isAnimating ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ios-blue)] focus-visible:ring-offset-2',
          className
        )}
        onClick={event => event.stopPropagation()}
      >
        <OverlayFrame
          title={title}
          titleIcon={titleIcon}
          footer={footer}
          showCloseButton={showCloseButton}
          onClose={onClose}
          titleId={title ? titleId : undefined}
          descriptionId={!ariaDescribedBy ? descriptionId : undefined}
          shellClassName="h-full"
          bodyClassName={joinClasses('flex-1 min-h-0', contentClassName)}
        >
          {children}
        </OverlayFrame>
      </div>
    </div>,
    document.body
  );
}
