/**
 * 输入: DailyStats (每日统计数据), onRefresh (刷新回调)
 * 输出: React 组件 (收入统计卡片 UI)
 * 定位: 展示层 - 收入变体的 DailyStatsCard 薄封装（向后兼容既有导出）
 */

import { DailyStatsCard, type DailyStatsCardProps } from './DailyStatsCard';

export type IncomeStatsCardProps = Omit<DailyStatsCardProps, 'variant'>;

export function IncomeStatsCard(props: IncomeStatsCardProps) {
  return <DailyStatsCard variant="income" {...props} />;
}
