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
        'relative flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)]',
        shellClassName
      )
    : joinClasses('flex h-full flex-col', shellClassName);

  return (
    <div className={rootClassName}>
      {(title || showCloseButton) && (
        <div
          data-testid="overlay-title"
          className={joinClasses(
            'flex items-center justify-between border-b border-[var(--line-soft)] px-[var(--spacing-2xl)] py-[var(--spacing-lg)]',
            headerClassName
          )}
        >
          <div className="flex min-w-0 items-center gap-[var(--spacing-md)]">
            {titleIcon ? (
              <span className="shrink-0 text-[var(--accent)]" aria-hidden="true">
                {titleIcon}
              </span>
            ) : null}
            {title ? (
              <h2
                id={titleId}
                className={joinClasses(
                  'truncate text-lg font-semibold text-[var(--text-primary)]',
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
                '-mr-[var(--spacing-sm)] rounded-[var(--radius-md)] p-[var(--spacing-sm)] text-[var(--text-secondary)]',
                'hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                'transition-all duration-[var(--duration-fast)] [transition-timing-function:var(--ease-standard)] active:scale-95',
                'focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2'
              )}
            >
              <X className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      <div
        id={descriptionId}
        data-testid="overlay-body"
        className={joinClasses('px-[var(--spacing-2xl)] py-[var(--spacing-lg)]', bodyClassName)}
      >
        {children}
      </div>

      {footer ? (
        <div
          data-testid="overlay-footer"
          className={joinClasses(
            'flex items-center justify-end gap-[var(--spacing-md)] px-[var(--spacing-2xl)] py-[var(--spacing-lg)]',
            'border-t border-[var(--line-soft)] bg-[var(--surface-2)]',
            footerClassName
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
