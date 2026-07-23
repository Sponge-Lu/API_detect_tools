/**
 * 输入: timestamp (毫秒时间戳)
 * 输出: string (格式化后的最近更新时间)
 * 定位: 工具层 - Credit 各卡片共享的"更新于"时间格式化
 */

export function formatLastUpdated(timestamp: number): string {
  if (!timestamp) return '从未更新';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
