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
  'text-red-600 dark:text-red-300',
  'text-emerald-500 dark:text-emerald-300',
  'text-blue-600 dark:text-blue-300',
  'text-amber-500 dark:text-amber-300',
  'text-violet-500 dark:text-violet-300',
  'text-cyan-500 dark:text-cyan-300',
  'text-pink-500 dark:text-pink-300',
  'text-lime-600 dark:text-lime-300',
  'text-indigo-500 dark:text-indigo-300',
  'text-orange-500 dark:text-orange-300',
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
  if (!groupName) return 'text-slate-400';

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
