import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export interface OverlayFrameProps {
  title?: ReactNode;
  titleIcon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
  shellClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  titleClassName?: string;
  titleId?: string;
  descriptionId?: string;
  useShell?: boolean;
  closeButtonLabel?: string;
}

function joinClasses(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function OverlayFrame({
  title,
  titleIcon,
  children,
  footer,
  showCloseButton = true,
  onClose,
  shellClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  titleClassName,
  titleId,
  descriptionId,
  useShell = true,
  closeButtonLabel = '关闭',
}: OverlayFrameProps) {
  const rootClassName = useShell
    ? joinClasses(
        'relative flex h-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)]',
        shellClassName
      )
    : joinClasses('flex h-full flex-col', shellClassName);

  return (
    <div className={rootClassName}>
      {(title || showCloseButton) && (
        <div
          data-testid="overlay-title"
          className={joinClasses(
            'flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line-soft)] px-5 py-3',
            headerClassName
          )}
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
                className={joinClasses(
                  'truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]',
                  titleClassName
                )}
              >
                {title}
              </h2>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeButtonLabel}
              title={closeButtonLabel}
              className={joinClasses(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)]',
                'hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]',
                'transition-colors duration-[var(--duration-hover)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'
              )}
            >
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      <div
        id={descriptionId}
        data-testid="overlay-body"
        className={joinClasses('min-h-0 px-5 py-4', bodyClassName)}
      >
        {children}
      </div>

      {footer ? (
        <div
          data-testid="overlay-footer"
          className={joinClasses(
            'flex shrink-0 items-center justify-end gap-2 px-5 py-3',
            'border-t border-[var(--line-soft)] bg-[var(--surface-1)]',
            footerClassName
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
