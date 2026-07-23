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
  md: 'h-[24px] w-[44px]',
};

const thumbStyles: Record<NonNullable<AppSwitchProps['size']>, { base: string; on: string }> = {
  sm: { base: 'h-3 w-3 translate-x-[1px]', on: 'translate-x-4' },
  md: { base: 'h-[18px] w-[18px] translate-x-[1px]', on: 'translate-x-[21px]' },
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
        className={`relative inline-flex shrink-0 rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${trackStyles[size]} ${
          checked
            ? 'border-[var(--accent)] bg-[var(--accent)]'
            : 'border-[var(--line-soft)] bg-[var(--surface-2)]'
        }`}
        {...props}
      >
        <span
          aria-hidden="true"
          className={`mt-px inline-block rounded-full border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-sm)] transition-transform ${thumbStyles[size].base} ${
            checked ? thumbStyles[size].on : ''
          }`}
        />
      </button>
      {label ? (
        <span id={labelId} className="text-[var(--text-secondary)] select-none">
          {label}
        </span>
      ) : null}
    </span>
  );
});
