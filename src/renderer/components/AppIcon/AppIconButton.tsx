import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AppIcon, type AppIconSize, type AppIconVariant } from './AppIcon';

export interface AppIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  size?: AppIconSize;
  variant?: AppIconVariant;
  label: string;
  showTooltip?: boolean;
  iconClassName?: string;
}

export const AppIconButton: React.FC<AppIconButtonProps> = ({
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
  const combinedClassName = ['app-icon-button', className].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={combinedClassName}
      aria-label={label}
      title={showTooltip ? label : undefined}
      disabled={disabled}
      {...props}
    >
      <AppIcon icon={icon} size={size} variant={variant} className={iconClassName} />
    </button>
  );
};

export default AppIconButton;
