/**
 * CreditPanel 组件导出
 */

import { getDifferenceColorType } from '../../../shared/types/credit';

export { CreditPanelCompact } from './CreditPanelCompact';
export type { CreditPanelCompactProps } from './CreditPanelCompact';

export { IncomeStatsCard } from './IncomeStatsCard';
export type { IncomeStatsCardProps } from './IncomeStatsCard';

export { ExpenseStatsCard } from './ExpenseStatsCard';
export type { ExpenseStatsCardProps } from './ExpenseStatsCard';

export { TransactionListCard } from './TransactionListCard';
export type { TransactionListCardProps } from './TransactionListCard';

export { RechargeSection } from './RechargeSection';
export type { RechargeSectionProps, LdcSiteInfo } from './RechargeSection';

export function getDifferenceColorClass(difference: number): string {
  switch (getDifferenceColorType(difference)) {
    case 'positive':
      return 'text-[var(--success)]';
    case 'negative':
      return 'text-[var(--danger)]';
    default:
      return 'text-[var(--text-secondary)]';
  }
}
