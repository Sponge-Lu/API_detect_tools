/**
 * 输入: checked, onCheckedChange, ariaLabel / label, size, disabled
 * 输出: React 组件 (统一开关)
 * 定位: 展示层 - 全 App 唯一布尔开关原语，收敛 InlineSwitch/SettingsSwitch/自绘 toggle
 */

import { forwardRef, useId } from 'react';

export interface AppSwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 可见文本标签；提供时渲染在开关旁并通过 aria-labelledby 关联 */
  label?: string;
  /** 无可见标签时的可访问名称 */
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

const trackStyles: Record<NonNullable<AppSwitchProps['size']>, string> = {
  sm: 'h-4 w-8',
  md: 'h-6 w-11',
};

const thumbStyles: Record<NonNullable<AppSwitchProps['size']>, { base: string; on: string }> = {
  sm: { base: 'h-3 w-3 translate-x-[2px]', on: 'translate-x-[18px]' },
  md: { base: 'h-[18px] w-[18px] translate-x-[3px]', on: 'translate-x-[23px]' },
};

export const AppSwitch = forwardRef<HTMLButtonElement, AppSwitchProps>(function AppSwitch(
  { checked, onCheckedChange, label, ariaLabel, size = 'md', className = '', id, ...props },
  ref
) {
  const generatedId = useId();
  const labelId = label ? `${id ?? generatedId}-label` : undefined;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? labelId : undefined}
        onClick={() => onCheckedChange(!checked)}
        className={`relative inline-flex shrink-0 items-center rounded-full transition-colors duration-[var(--duration-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${trackStyles[size]} ${
          checked ? 'bg-[var(--accent-solid)]' : 'bg-[var(--line-strong)]'
        }`}
        {...props}
      >
        <span
          aria-hidden="true"
          className={`inline-block rounded-full bg-[var(--text-on-accent)] shadow-[var(--shadow-sm)] transition-transform duration-[var(--duration-hover)] ${thumbStyles[size].base} ${
            checked ? thumbStyles[size].on : ''
          }`}
        />
      </button>
      {label ? (
        <span id={labelId} className="select-none text-[13px] text-[var(--text-secondary)]">
          {label}
        </span>
      ) : null}
    </span>
  );
});
