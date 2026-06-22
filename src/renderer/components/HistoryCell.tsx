/**
 * History Cell 组件
 * 输入: siteId, accountId
 * 输出: 时间桶条形图（CLI 类型与模式由列表头共享 uiStore 控制）
 * 定位: 展示层 - 站点管理页 History 列的行内单元格
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { HistoryBucketBars } from './Route/Usability/HistoryBucketBars';

interface HistoryCellProps {
  siteId: string;
  accountId: string;
}

export function HistoryCell({ siteId, accountId }: HistoryCellProps) {
  return <HistoryBucketBars siteId={siteId} accountId={accountId} />;
}
