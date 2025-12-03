import {
  Server,
  Crown,
  Star,
  Users,
  RefreshCw,
  Zap,
  DollarSign,
  CheckCircle,
  Gift,
  Play,
  Calendar,
  Fuel,
  Plus,
  Edit,
  Trash2,
} from 'lucide-react';

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

// 分组图标池
const GROUP_ICON_POOL = [
  (className = 'w-3 h-3') => <Crown className={className} />,
  (className = 'w-3 h-3') => <Star className={className} />,
  (className = 'w-3 h-3') => <Users className={className} />,
  (className = 'w-3 h-3') => <Server className={className} />,
  (className = 'w-3 h-3') => <RefreshCw className={className} />,
  (className = 'w-3 h-3') => <Zap className={className} />,
  (className = 'w-3 h-3') => <DollarSign className={className} />,
  (className = 'w-3 h-3') => <CheckCircle className={className} />,
  (className = 'w-3 h-3') => <Gift className={className} />,
  (className = 'w-3 h-3') => <Play className={className} />,
  (className = 'w-3 h-3') => <Calendar className={className} />,
  (className = 'w-3 h-3') => <Fuel className={className} />,
  (className = 'w-3 h-3') => <Plus className={className} />,
  (className = 'w-3 h-3') => <Edit className={className} />,
  (className = 'w-3 h-3') => <Trash2 className={className} />,
] as const;

// 全局单例 registry，确保整个应用内同一分组颜色/图标一致
const groupColorRegistry: Record<string, string> = {};
const groupIconRegistry: Record<string, number> = {};

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
 * 获取分组对应的图标
 */
export function getGroupIcon(groupName: string): React.ReactNode {
  if (!groupName) return <Server className="w-3 h-3" />;

  if (groupIconRegistry[groupName] !== undefined) {
    return GROUP_ICON_POOL[groupIconRegistry[groupName]]('w-3 h-3');
  }

  const used = new Set(Object.values(groupIconRegistry));
  let index = -1;
  for (let i = 0; i < GROUP_ICON_POOL.length; i++) {
    if (!used.has(i)) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    let hash = 0;
    for (let i = 0; i < groupName.length; i++) {
      hash = (hash * 31 + groupName.charCodeAt(i)) >>> 0;
    }
    index = hash % GROUP_ICON_POOL.length;
  }

  groupIconRegistry[groupName] = index;
  return GROUP_ICON_POOL[index]('w-3 h-3');
}
