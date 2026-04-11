import React from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

export type AppIconSize = 'sm' | 'md' | 'lg';
export type AppIconVariant = 'default' | 'primary' | 'success' | 'error' | 'warning' | 'muted';

export interface AppIconProps extends Omit<LucideProps, 'size'> {
  icon: LucideIcon;
  size?: AppIconSize;
  variant?: AppIconVariant;
  className?: string;
  'aria-label'?: string;
}

const sizeMap: Record<AppIconSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
};

const sizeClassMap: Record<AppIconSize, string> = {
  sm: 'app-icon-sm',
  md: 'app-icon-md',
  lg: 'app-icon-lg',
};

const variantClassMap: Record<AppIconVariant, string> = {
  default: '',
  primary: 'app-icon-primary',
  success: 'app-icon-success',
  error: 'app-icon-error',
  warning: 'app-icon-warning',
  muted: 'app-icon-muted',
};

export const AppIcon: React.FC<AppIconProps> = ({
  icon: Icon,
  size = 'md',
  variant = 'default',
  className = '',
  'aria-label': ariaLabel,
  ...props
}) => {
  const combinedClassName = ['app-icon', sizeClassMap[size], variantClassMap[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <Icon
      className={combinedClassName}
      width={sizeMap[size]}
      height={sizeMap[size]}
      strokeWidth={2}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
      {...props}
    />
  );
};

export default AppIcon;
