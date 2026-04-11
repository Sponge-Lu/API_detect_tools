/**
 * 输入: groupId (分组 ID), 颜色池配置
 * 输出: 样式类名字符串, 颜色值
 * 定位: 工具层 - 根据分组 ID 生成一致的站点分组样式
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

// 分组文字颜色池
const GROUP_TEXT_COLOR_POOL = [
  'text-[var(--accent)]',
  'text-[var(--accent-strong)]',
  'text-[var(--success)]',
  'text-[var(--warning)]',
  'text-[var(--danger)]',
  'text-[var(--text-primary)]',
  'text-[var(--text-secondary)]',
] as const;

// 带圆框的数字字符
const CIRCLED_NUMBERS = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
] as const;

// 全局单例 registry，确保整个应用内同一分组颜色一致
const groupColorRegistry: Record<string, string> = {};

/**
 * 获取分组的文字颜色
 */
export function getGroupTextColor(groupName: string): string {
  if (!groupName) return 'text-[var(--text-tertiary)]';

  if (groupColorRegistry[groupName]) {
    return groupColorRegistry[groupName];
  }

  const used = new Set(Object.values(groupColorRegistry));
  let color = GROUP_TEXT_COLOR_POOL.find(c => !used.has(c));

  if (!color) {
    let hash = 0;
    for (let i = 0; i < groupName.length; i++) {
      hash = (hash * 31 + groupName.charCodeAt(i)) >>> 0;
    }
    color = GROUP_TEXT_COLOR_POOL[hash % GROUP_TEXT_COLOR_POOL.length];
  }

  groupColorRegistry[groupName] = color;
  return color;
}

/**
 * 获取分组对应的带圆框数字
 * @param groupName 分组名称
 * @param index 可选，直接指定序号（0-based）
 */
export function getGroupIcon(_groupName: string, index?: number): React.ReactNode {
  const idx = index !== undefined ? index % CIRCLED_NUMBERS.length : 0;
  return <span className="text-xs font-bold">{CIRCLED_NUMBERS[idx]}</span>;
}
