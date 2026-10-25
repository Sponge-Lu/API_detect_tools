/**
 * 输入: columnWidths（站点列表各列像素宽度）
 * 输出: CSS `grid-template-columns` 字符串
 * 定位: 展示层 - 站点列表栅格模板的唯一来源
 *
 * 为什么需要它:
 * 表头（SiteListHeader）与数据行（SiteCardHeader）必须使用完全一致的轨道定义，
 * 否则任何一列宽度变化都会让表头与数据错位。此前两处各写一份，表头还多挂了一个
 * `1fr`，属于随时会错位的隐患。
 *
 * 轨道分配策略:
 * - 前 N-1 列固定像素：数值列只有固定宽度配合 tabular-nums 才能保证小数点对齐
 * - History 列 `minmax(默认宽, 1fr)`：唯一吸收窗口剩余空间的列，时间桶条形图越宽越好读
 * - 末列固定宽度：操作按钮区，保证表头与数据行的右边界严格一致
 *
 * 注意: 弹性轨道只有在两端容器宽度相同时才会算出同一个值，因此数据行也必须让栅格
 * 占满整行（操作按钮作为栅格的最后一格，而不是放在栅格外用 flex 顶到右边）。
 */

/** 操作列固定宽度：最多 3 个 28px 图标按钮 + 2 个 4px 间距 + 左侧 4px 留白 */
export const SITE_ACTIONS_COLUMN_WIDTH = 96;

export function buildSiteGridTemplate(columnWidths: readonly number[]): string {
  if (columnWidths.length === 0) {
    return `minmax(0, 1fr) ${SITE_ACTIONS_COLUMN_WIDTH}px`;
  }

  const fixedColumns = columnWidths.slice(0, -1).map(width => `${width}px`);
  const historyColumn = `minmax(${columnWidths[columnWidths.length - 1]}px, 1fr)`;

  return [...fixedColumns, historyColumn, `${SITE_ACTIONS_COLUMN_WIDTH}px`].join(' ');
}
