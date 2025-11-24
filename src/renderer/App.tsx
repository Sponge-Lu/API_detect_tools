import { useEffect, useState, useRef } from "react";
import Logo from "./assets/logo.svg";
import {
  Server,
  Plus,
  Play,
  Settings,
  Trash2,
  Edit,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
  Gift,
  Copy,
  ChevronDown,
  Eye,
  EyeOff,
  Users,
  Crown,
  Star,
  Zap,
  DollarSign,
  Calendar,
  Fuel,
} from "lucide-react";
import { SiteEditor } from "./components/SiteEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { useTheme } from "./hooks/useTheme";
// 从共享的types文件导入并重新导出SiteConfig
import type { SiteConfig } from "../main/types/token";
export type { SiteConfig } from "../main/types/token";

declare global {
  interface Window {
    electronAPI: {
      loadConfig: () => Promise<Config>;
      saveConfig: (config: Config) => Promise<void>;
      launchChromeForLogin: (url: string) => Promise<{ success: boolean; message: string }>;
      getCookies: (url: string) => Promise<any[]>;
      fetchWithCookies: (url: string, options: any) => Promise<{ ok: boolean; status: number; statusText: string; data: any }>;
      detectSite: (site: SiteConfig, timeout: number, quickRefresh?: boolean, cachedData?: DetectionResult) => Promise<DetectionResult>;
      detectAllSites: (config: Config, quickRefresh?: boolean, cachedResults?: DetectionResult[]) => Promise<DetectionResult[]>;
      openUrl: (url: string) => Promise<void>;
      getAllAccounts: () => Promise<any[]>;
      token?: any;
      storage?: any;
    };
  }
}

export interface Settings {
  timeout: number;
  concurrent: boolean;
  show_disabled: boolean;
  auto_refresh: boolean;
  refresh_interval: number;
  // 新增：浏览器可执行文件路径（可选），用于自定义 Chromium / Edge / 便携版浏览器
  browser_path?: string;
}

export interface Config {
  sites: SiteConfig[];
  settings: Settings;
}

export interface DetectionResult {
  name: string;
  url: string;
  status: string;
  models: string[];
  balance?: number;
  todayUsage?: number; // 今日消费(美元)
  todayPromptTokens?: number;      // 今日输入 Token
  todayCompletionTokens?: number;  // 今日输出 Token
  todayTotalTokens?: number;       // 今日总 Token
  todayRequests?: number;          // 今日请求次数
  error?: string;
  has_checkin: boolean;  // 是否支持签到功能
  can_check_in?: boolean;  // 今日是否可签到（true=可签到, false=已签到）
  // 新增：缓存的扩展数据
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: any;
}

// 新增：创建 API Key 表单数据类型
interface NewApiTokenForm {
  name: string;            // 令牌名称
  group: string;           // 分组名称
  unlimitedQuota: boolean; // 是否无限额度
  quota: string;           // 用户输入的额度（单位：美元，字符串便于校验）
  expiredTime: string;     // 过期时间（datetime-local 字符串，空字符串表示永不过期）
}

// 新增：额度换算系数（与后端保持一致：1 美元 = 500000 内部单位）
const QUOTA_CONVERSION_FACTOR = 500000;

// 站点列表默认列宽设置（单位：像素），顺序为：
// 0: 站点名称、1: 状态、2: 余额、3: 今日消费、4: 总 Token、5: 输入、6: 输出、
// 7: 请求、8: RPM、9: TPM、10: 模型数、11: 更新时间
const DEFAULT_COLUMN_WIDTHS: number[] = [
  110, // 站点
  70,  // 状态
  90,  // 余额
  75,  // 今日消费
  70,  // 总 Token
  70,  // 输入
  70,  // 输出
  55,  // 请求
  55,  // RPM
  55,  // TPM
  50,  // 模型数
  60,  // 更新时间
];

function App() {
  // 初始化主题系统
  useTheme();
  
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectingSite, setDetectingSite] = useState<string | null>(null);
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [showSiteEditor, setShowSiteEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  // 存储每个站点的扩展数据（从DetectionResult缓存中加载）
  const [apiKeys, setApiKeys] = useState<Record<string, any[]>>({});
  const [userGroups, setUserGroups] = useState<Record<string, Record<string, { desc: string; ratio: number }>>>({});
  const [modelPricing, setModelPricing] = useState<Record<string, any>>({});
  // 新增：分组筛选
  const [selectedGroup, setSelectedGroup] = useState<Record<string, string | null>>({});
  // 新增：刷新提示消息
  const [refreshMessage, setRefreshMessage] = useState<{site: string, message: string, type: 'success' | 'info'} | null>(null);
  // 新增：模型搜索
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({});
  // 新增：存储站点账号数据（用于显示最后更新时间）
  const [siteAccounts, setSiteAccounts] = useState<Record<string, any>>({});
  // 新增：签到状态
  const [checkingIn, setCheckingIn] = useState<string | null>(null);  // 正在签到的站点名称
  // 新增：拖拽状态
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // 新增：保存状态
  const [saving, setSaving] = useState(false);
  // 新增：创建 API Key 弹窗状态
  const [creatingTokenSite, setCreatingTokenSite] = useState<SiteConfig | null>(null);
  // 新增：创建 API Key 弹窗版本号，用于每次打开时强制重新挂载，避免残留状态影响输入
  const [tokenDialogVersion, setTokenDialogVersion] = useState(0);
  // 新增：创建 API Key 名称输入框引用，用于自动聚焦
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [newTokenForm, setNewTokenForm] = useState<NewApiTokenForm>({
    name: '',
    group: 'default',
    unlimitedQuota: true,
    quota: '',
    expiredTime: '',
  });
  const [creatingToken, setCreatingToken] = useState(false);
  // 新增：删除 API Key 状态（用字符串标识当前正在删除的令牌，避免重复点击）
  const [deletingTokenKey, setDeletingTokenKey] = useState<string | null>(null);
  // 新增：站点列表列宽，可调整并持久化到 localStorage
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    try {
      const stored = window.localStorage.getItem('siteListColumnWidths');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_COLUMN_WIDTHS.length) {
          const forcedIndices = new Set([0, 1, 3]); // 站点 / 状态 / 今日消费 使用最新默认值
          return parsed.map((v: any, idx: number) => {
            if (forcedIndices.has(idx)) {
              return DEFAULT_COLUMN_WIDTHS[idx];
            }
            return typeof v === 'number' && v > 0 ? v : DEFAULT_COLUMN_WIDTHS[idx];
          });
        }
      }
    } catch {
      // 忽略解析错误，回退到默认值
    }
    return DEFAULT_COLUMN_WIDTHS;
  });
  const columnWidthsRef = useRef<number[]>(columnWidths);

  // 保持 ref 与 state 同步，并在变更时写入 localStorage
  useEffect(() => {
    columnWidthsRef.current = columnWidths;
    try {
      window.localStorage.setItem('siteListColumnWidths', JSON.stringify(columnWidths));
    } catch {
      // 某些环境可能禁用存储，忽略错误即可
    }
  }, [columnWidths]);

  // 列宽调整：在表头右侧拖动分隔线即可调整宽度
  const handleColumnResizeMouseDown = (event: React.MouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidthsRef.current[index];

    // 最小/最大列宽，防止列被拖没或过宽
    const minWidth = 50;
    const maxWidth = 320;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      let nextWidth = startWidth + delta;
      if (nextWidth < minWidth) nextWidth = minWidth;
      if (nextWidth > maxWidth) nextWidth = maxWidth;

      setColumnWidths(prev => {
        const next = [...prev];
        next[index] = nextWidth;
        return next;
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // 当弹窗打开或版本号变化时，自动聚焦到名称输入框
  useEffect(() => {
    if (creatingTokenSite && nameInputRef.current) {
      // 自动聚焦并选中文本，提升输入体验
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [creatingTokenSite, tokenDialogVersion]);

  // 切换令牌显示/隐藏
  const toggleTokenVisibility = (siteName: string) => {
    setShowTokens(prev => ({ ...prev, [siteName]: !prev[siteName] }));
  };

  // 为API Key添加sk-前缀（如果没有）
  const addSkPrefix = (key: string): string => {
    if (!key) return '';
    return key.startsWith('sk-') ? key : `sk-${key}`;
  };

  // 分组文字颜色池（高对比度，且不同分组之间颜色差异足够大，而不是一整条渐变）
  const GROUP_TEXT_COLOR_POOL = [
    // 选取的是“间隔明显”的色相，避免连续渐变感
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

  // 全局分组颜色映射，确保同一应用内每个分组颜色唯一且一致
  const groupColorRegistry: Record<string, string> = {};

  // 获取分组的文字颜色（用户分组 / API Key / 模型分组统一调用）
  const getGroupTextColor = (groupName: string): string => {
    if (!groupName) return 'text-slate-400';

    // 已经分配过颜色，直接复用（保证同名分组颜色一致）
    if (groupColorRegistry[groupName]) {
      return groupColorRegistry[groupName];
    }

    // 优先分配尚未使用过的颜色，确保“所有分组颜色都不一样”
    const used = new Set(Object.values(groupColorRegistry));
    let color = GROUP_TEXT_COLOR_POOL.find((c) => !used.has(c));

    // 如果颜色池用完（极端大量分组），使用稳定 hash 回退，尽量分散
    if (!color) {
      let hash = 0;
      for (let i = 0; i < groupName.length; i++) {
        hash = (hash * 31 + groupName.charCodeAt(i)) >>> 0;
      }
      color = GROUP_TEXT_COLOR_POOL[hash % GROUP_TEXT_COLOR_POOL.length];
    }

    groupColorRegistry[groupName] = color;
    return color;
  };

  // 格式化价格显示，去除多余的0
  const formatPrice = (price: number): string => {
    if (price === 0) return '0';
    if (price >= 1) {
      // 价格 >= 1，最多保留2位小数
      return parseFloat(price.toFixed(2)).toString();
    } else if (price >= 0.01) {
      // 0.01 <= 价格 < 1，最多保留4位小数
      return parseFloat(price.toFixed(4)).toString();
    } else {
      // 价格 < 0.01，最多保留6位小数
      return parseFloat(price.toFixed(6)).toString();
    }
  };

  // 分组图标池（全部使用 currentColor，由外层文字颜色控制）
  const GROUP_ICON_POOL = [
    (className = "w-3 h-3") => <Crown className={className} />,
    (className = "w-3 h-3") => <Star className={className} />,
    (className = "w-3 h-3") => <Users className={className} />,
    (className = "w-3 h-3") => <Server className={className} />,
    (className = "w-3 h-3") => <RefreshCw className={className} />,
    (className = "w-3 h-3") => <Zap className={className} />,
    (className = "w-3 h-3") => <DollarSign className={className} />,
    (className = "w-3 h-3") => <CheckCircle className={className} />,
    (className = "w-3 h-3") => <Gift className={className} />,
    (className = "w-3 h-3") => <Play className={className} />,
    (className = "w-3 h-3") => <Calendar className={className} />,
    (className = "w-3 h-3") => <Fuel className={className} />,
    (className = "w-3 h-3") => <Plus className={className} />,
    (className = "w-3 h-3") => <Edit className={className} />,
    (className = "w-3 h-3") => <Trash2 className={className} />,
  ] as const;

  // 全局分组图标映射，确保同一应用内每个分组图标唯一且一致
  const groupIconRegistry: Record<string, number> = {};

  // 获取分组对应的图标（在一个会话内保证图标不重复）
  // inheritColor: 是否继承父元素颜色（目前始终为 true，只控制大小）
  const getGroupIcon = (groupName: string, _inheritColor: boolean = false) => {
    if (!groupName) return <Server className="w-3 h-3" />;

    // 已分配过图标，直接复用
    if (groupIconRegistry[groupName] !== undefined) {
      const idx = groupIconRegistry[groupName];
      return GROUP_ICON_POOL[idx]("w-3 h-3");
    }

    // 先占用一个尚未被使用过的图标槽位，尽量保证不重复
    const used = new Set(Object.values(groupIconRegistry));
    let index = -1;
    for (let i = 0; i < GROUP_ICON_POOL.length; i++) {
      if (!used.has(i)) {
        index = i;
        break;
      }
    }

    // 如果图标数量不够（极端大量分组），使用稳定 hash 回退
    if (index === -1) {
      let hash = 0;
      for (let i = 0; i < groupName.length; i++) {
        hash = (hash * 31 + groupName.charCodeAt(i)) >>> 0;
      }
      index = hash % GROUP_ICON_POOL.length;
    }

    groupIconRegistry[groupName] = index;
    return GROUP_ICON_POOL[index]("w-3 h-3");
  };

  // 获取计费模式图标和文本
  const getQuotaTypeInfo = (quotaType: number): { icon: JSX.Element; text: string; color: string } => {
    if (quotaType === 1) {
      return {
        // 次数计费：提高前景/背景对比度
        icon: <span className="text-xs font-bold text-orange-700 dark:text-orange-100">次</span>,
        text: '按次',
        color: 'bg-orange-500/10 dark:bg-orange-500/30 text-orange-700 dark:text-orange-100 border-orange-500/40'
      };
    }
    return {
      // 按量计费：同样增强对比度
      icon: <span className="text-xs font-bold text-blue-700 dark:text-blue-100">量</span>,
      text: '按量',
      color: 'bg-blue-500/10 dark:bg-blue-500/30 text-blue-700 dark:text-blue-100 border-blue-500/40'
    };
  };

  // 筛选API Keys（根据选中的分组）
  const getFilteredApiKeys = (siteName: string): any[] => {
    const keys = apiKeys[siteName] || [];
    const selected = selectedGroup[siteName];
    
    if (!selected) return keys;
    
    return keys.filter(key => key.group === selected);
  };

  // 筛选模型（根据选中的分组和搜索关键字）
  const getFilteredModels = (siteName: string, allModels: string[]): string[] => {
    const selected = selectedGroup[siteName];
    const pricing = modelPricing[siteName];
    const searchTerm = (modelSearch[siteName] || '').toLowerCase();
    
    let filtered = allModels;
    
    // 根据分组筛选
    if (selected && pricing) {
      filtered = filtered.filter(modelName => {
        // 支持两种数据结构：pricing.data[model] 或 pricing[model]
        const modelData = pricing.data?.[modelName] || pricing[modelName];
        if (!modelData || !modelData.enable_groups) return false;
        return modelData.enable_groups.includes(selected);
      });
    }
    
    // 根据搜索关键字筛选
    if (searchTerm) {
      filtered = filtered.filter(modelName =>
        modelName.toLowerCase().includes(searchTerm)
      );
    }
    
    return filtered;
  };

  // 切换分组选择
  const toggleGroupFilter = (siteName: string, groupName: string | null) => {
    setSelectedGroup(prev => ({
      ...prev,
      [siteName]: prev[siteName] === groupName ? null : groupName
    }));
  };

  // 打开创建 API Key 弹窗
  const openCreateTokenDialog = (site: SiteConfig) => {
    if (!site.system_token || !site.user_id) {
      alert('当前站点未配置系统 Token 或用户 ID，请先在“编辑站点”中填写。');
      return;
    }

    // 根据检测结果名称选择 userGroups 的 key（保持与后端缓存一致）
    const siteResult = results.find(r => r.name === site.name);
    const siteKey = siteResult?.name || site.name;
    const groupsForSite = userGroups[siteKey] || {};
    const groupNames = Object.keys(groupsForSite);

    // 选择一个默认分组：优先 default，其次第一个分组
    let defaultGroup = 'default';
    if (groupNames.length > 0) {
      if (groupsForSite.default) {
        defaultGroup = 'default';
      } else {
        defaultGroup = groupNames[0];
      }
    }

    // 每次打开前重置“创建中”状态，避免异常情况下残留
    setCreatingToken(false);
    // 递增版本号，确保对话框组件在每次打开时重新挂载
    setTokenDialogVersion(prev => prev + 1);

    setNewTokenForm({
      name: '',
      group: defaultGroup,
      unlimitedQuota: true,
      quota: '',
      expiredTime: '',
    });
    setCreatingTokenSite(site);
  };

  // 关闭创建 API Key 弹窗并重置表单
  const closeCreateTokenDialog = () => {
    setCreatingTokenSite(null);
    setNewTokenForm({
      name: '',
      group: 'default',
      unlimitedQuota: true,
      quota: '',
      expiredTime: '',
    });
  };

  /**
   * 仅刷新指定站点的 API Key 列表（不重新检测余额、模型等）
   * 使用后端的 token:fetch-api-tokens 接口，只更新前端的 apiKeys 与 DetectionResult.apiKeys
   */
  const refreshSiteApiKeys = async (site: SiteConfig) => {
    if (!site.system_token || !site.user_id) {
      console.warn('⚠️ [App] 当前站点未配置系统 Token 或用户 ID，无法刷新 API Key 列表');
      return;
    }

    const userIdNum = parseInt(site.user_id || '0', 10);
    if (!userIdNum) {
      console.warn('⚠️ [App] 当前站点用户 ID 无效，无法刷新 API Key 列表');
      return;
    }

    try {
      const resp = await window.electronAPI.token?.fetchApiTokens?.(
        site.url,
        userIdNum,
        site.system_token!
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      const tokens: any[] = Array.isArray(resp.data) ? resp.data : [];

      // 更新独立的 apiKeys 状态（用于列表展示）
      setApiKeys(prev => ({
        ...prev,
        [site.name]: tokens,
      }));

      // 同步更新检测结果中的 apiKeys 缓存，保持数据一致
      setResults(prev =>
        prev.map(r =>
          r.name === site.name
            ? { ...r, apiKeys: tokens }
            : r
        )
      );

      console.log(`✅ [App] 已刷新站点 ${site.name} 的 API Key 列表，数量: ${tokens.length}`);
    } catch (error: any) {
      console.error('❌ [App] 刷新 API Key 列表失败:', error);
      // 这里不弹窗打扰用户，仅在控制台记录
    }
  };

  // 提交创建 API Key
  const handleCreateTokenSubmit = async () => {
    if (!creatingTokenSite) return;
    const site = creatingTokenSite;

    if (!site.system_token || !site.user_id) {
      alert('当前站点未配置系统 Token 或用户 ID，请先在“编辑站点”中填写。');
      return;
    }

    const name = newTokenForm.name.trim();
    if (!name) {
      alert('请填写令牌名称');
      return;
    }

    // 处理额度：无限额度时 remain_quota 置为 0（后端根据 unlimited_quota 判断），有限额度时按美元转换为内部单位
    let remainQuota = 0;
    if (newTokenForm.unlimitedQuota) {
      remainQuota = 0;
    } else {
      const quotaNumber = parseFloat(newTokenForm.quota);
      if (isNaN(quotaNumber) || quotaNumber <= 0) {
        alert('请输入大于 0 的额度（单位：美元）');
        return;
      }
      remainQuota = Math.floor(quotaNumber * QUOTA_CONVERSION_FACTOR);
    }

    // 处理过期时间：空字符串表示永不过期（-1）
    let expiredTime = -1;
    if (newTokenForm.expiredTime) {
      const dt = new Date(newTokenForm.expiredTime);
      if (isNaN(dt.getTime())) {
        alert('请输入有效的过期时间');
        return;
      }
      if (dt.getTime() <= Date.now()) {
        alert('过期时间必须晚于当前时间');
        return;
      }
      expiredTime = Math.floor(dt.getTime() / 1000);
    }

    const group = newTokenForm.group || 'default';

    // 构造后端需要的 payload（与 all-api-hub 保持一致的通用字段）
    const tokenPayload = {
      name,
      remain_quota: remainQuota,
      expired_time: expiredTime,
      unlimited_quota: newTokenForm.unlimitedQuota,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group,
    };

    try {
      setCreatingToken(true);
      const userIdNum = parseInt(site.user_id || '0', 10);
      if (!userIdNum) {
        alert('当前站点用户 ID 无效，请在“编辑站点”中检查配置。');
        return;
      }

      const resp = await window.electronAPI.token?.createApiToken?.(
        site.url,
        userIdNum,
        site.system_token!,
        tokenPayload
      );

      // IPC 返回 { success, data?: any[], error? }
      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      // 如果后端在浏览器模式下已经返回了最新 API Key 列表（data），优先直接使用
      if (resp.data && Array.isArray(resp.data)) {
        const tokens: any[] = resp.data;
        setApiKeys(prev => ({
          ...prev,
          [site.name]: tokens,
        }));
        setResults(prev =>
          prev.map(r =>
            r.name === site.name
              ? { ...r, apiKeys: tokens }
              : r
          )
        );
      } else {
        // 否则仅刷新该站点的 API Key 列表（axios 模式）
        await refreshSiteApiKeys(site);
      }

      alert('API Key 创建成功');
      closeCreateTokenDialog();
    } catch (error: any) {
      console.error('❌ [App] 创建 API Key 失败:', error);
      alert(`创建 API Key 失败: ${error.message || error}`);
    } finally {
      setCreatingToken(false);
    }
  };

  /**
   * 删除指定站点下的单个 API Key
   * 说明：
   * - 优先通过 axios 调用后端删除接口；
   * - 如果被 Cloudflare 拦截，后端会自动回退到浏览器模式，在已打开的站点页面中执行删除；
   * - 删除成功后，调用 detectSingle 快速刷新当前站点的数据（包含最新的 API Keys）。
   */
  const handleDeleteToken = async (site: SiteConfig, token: any, tokenIndex: number) => {
    if (!site.system_token || !site.user_id) {
      alert('当前站点未配置系统 Token 或用户 ID，请先在“编辑站点”中填写。');
      return;
    }

    const displayName = token.name || `Key #${tokenIndex + 1}`;
    const confirmMsg = `确认要删除 API Key「${displayName}」吗？\n此操作不可恢复，请谨慎操作。`;
    if (!window.confirm(confirmMsg)) {
      return;
    }

    const userIdNum = parseInt(site.user_id || '0', 10);
    if (!userIdNum) {
      alert('当前站点用户 ID 无效，请在“编辑站点”中检查配置。');
      return;
    }

    const deletingKeyId = `${site.name}_${token.id ?? token.key ?? tokenIndex}`;
    setDeletingTokenKey(deletingKeyId);

    try {
      const resp = await window.electronAPI.token?.deleteApiToken?.(
        site.url,
        userIdNum,
        site.system_token!,
        {
          // 同时传递 id 和 key，后端会自动选择可用的识别方式
          id: token.id ?? token.token_id ?? undefined,
          key: token.key ?? token.token ?? undefined,
        }
      );

      if (!resp || resp.success !== true) {
        throw new Error(resp?.error || '未知错误');
      }

      // 如果后端在浏览器模式下已经返回了最新 API Key 列表（data），优先直接使用
      if (resp.data && Array.isArray(resp.data)) {
        const tokens: any[] = resp.data;
        setApiKeys(prev => ({
          ...prev,
          [site.name]: tokens,
        }));
        setResults(prev =>
          prev.map(r =>
            r.name === site.name
              ? { ...r, apiKeys: tokens }
              : r
          )
        );
      } else {
        // 否则仅刷新该站点的 API Key 列表（axios 模式）
        await refreshSiteApiKeys(site);
      }
      alert(`API Key「${displayName}」已删除`);
    } catch (error: any) {
      console.error('❌ [App] 删除 API Key 失败:', error);
      alert(`删除 API Key 失败: ${error.message || error}`);
    } finally {
      setDeletingTokenKey(null);
    }
  };

  // 复制到剪贴板
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label} 已复制到剪贴板`);
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败: ' + error);
    }
  };

  useEffect(() => {
    // 先加载配置，再加载缓存数据
    const init = async () => {
      const cfg = await loadConfig();
      if (cfg) {
        await loadCachedData(cfg);
      }
    };
    init();
  }, []);

  // 当expandedSites改变时，确保UI能正确显示
  useEffect(() => {
    console.log('📊 [App] State更新:');
    console.log('   - apiKeys:', Object.keys(apiKeys).length, '个站点的数据');
    console.log('   - expandedSites:', Array.from(expandedSites));
    expandedSites.forEach(siteName => {
      if (apiKeys[siteName]) {
        console.log(`   - ${siteName} 的apiKeys:`, apiKeys[siteName].length, '个');
      }
    });
  }, [apiKeys, expandedSites]);

  const loadConfig = async (): Promise<Config | null> => {
    try {
      setLoading(true);
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
      return cfg;
    } catch (error) {
      console.error("加载配置失败:", error);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * 启动时加载缓存的显示数据
   * @param currentConfig 当前的配置对象，用于匹配站点名称
   */
  const loadCachedData = async (currentConfig: Config) => {
    try {
      console.log('📂 [App] 加载缓存的显示数据...');
      const accounts = await window.electronAPI.getAllAccounts();
      
      console.log('📊 [App] 从token-storage.json获取到账号数据:', accounts?.length || 0);
      
      if (accounts && accounts.length > 0) {
        // 构建站点账号映射表（用于显示最后更新时间）
        const accountsMap: Record<string, any> = {};
        accounts.forEach((account: any) => {
          // 🔧 修复：使用配置文件中的站点名称
          const configSite = currentConfig.sites.find(s => {
            try {
              return new URL(s.url).origin === new URL(account.site_url).origin;
            } catch {
              return false;
            }
          });
          const siteName = configSite?.name || account.site_name;
          
          // 调试日志：显示名称映射
          console.log(`   🔗 [App] 站点映射: ${account.site_url}`);
          console.log(`      - 缓存中的名称: ${account.site_name}`);
          console.log(`      - 配置中的名称: ${configSite?.name || '未找到'}`);
          console.log(`      - 最终使用名称: ${siteName}`);
          
          // 使用URL作为key（更准确）
          const urlKey = new URL(account.site_url).origin;
          accountsMap[urlKey] = account;
          // 使用配置文件中的站点名作为key（重要！）
          accountsMap[siteName] = account;
        });
        setSiteAccounts(accountsMap);
        
        console.log('📋 [App] 账号映射表:', Object.keys(accountsMap));
        
        // 将账号的缓存数据转换为DetectionResult格式
        const cachedResults: DetectionResult[] = accounts
          .filter((account: any) => {
            const hasCachedData = !!account.cached_display_data;
            console.log(`   ${account.site_name}: ${hasCachedData ? '有缓存' : '无缓存'}`);
            return hasCachedData;
          })
          .map((account: any) => {
            // 🔧 修复：使用配置文件中的站点名称，而不是缓存中的名称
            // 通过URL匹配找到配置中的站点
            const configSite = currentConfig.sites.find(s => {
              try {
                return new URL(s.url).origin === new URL(account.site_url).origin;
              } catch {
                return false;
              }
            });
            
            // 优先使用配置中的名称，如果找不到则使用缓存中的名称
            const siteName = configSite?.name || account.site_name;
            
            console.log(`   📦 [App] 加载缓存: ${account.site_url} → 使用名称: ${siteName} (来源: ${configSite ? '配置' : '缓存'})`);
            
            const result = {
              name: siteName,  // 使用配置文件中的名称
              url: account.site_url,
              // 恢复最近一次检测状态，如果没有则默认为成功
              status: (account as any).last_detection_status || '成功',
              error: (account as any).last_detection_error,
              models: account.cached_display_data?.models || [],
              // 🔧 修复：缓存中的余额已经在后端转换过了，直接使用即可
              balance: account.cached_display_data?.quota,
              todayUsage: account.cached_display_data?.today_quota_consumption,
              // 日志指标：从缓存中恢复
              todayPromptTokens: account.cached_display_data?.today_prompt_tokens,
              todayCompletionTokens: account.cached_display_data?.today_completion_tokens,
              todayTotalTokens:
                account.cached_display_data?.today_prompt_tokens !== undefined &&
                account.cached_display_data?.today_completion_tokens !== undefined
                  ? account.cached_display_data.today_prompt_tokens + account.cached_display_data.today_completion_tokens
                  : undefined,
              todayRequests: account.cached_display_data?.today_requests_count,
              has_checkin: typeof account.cached_display_data?.can_check_in === 'boolean',  // 如果有can_check_in字段，说明支持签到
              can_check_in: account.cached_display_data?.can_check_in,  // 签到状态
              apiKeys: account.cached_display_data?.apiKeys,
              userGroups: account.cached_display_data?.userGroups,
              modelPricing: account.cached_display_data?.modelPricing
            };
            console.log(`   → 转换 ${siteName}:`, {
              models: result.models?.length,
              balance: result.balance,
              apiKeys: result.apiKeys?.length,
              nameSource: configSite ? '配置文件' : '缓存'
            });
            return result;
          });
        
        console.log(`✅ [App] 加载了 ${cachedResults.length} 个站点的缓存数据`);
        setResults(cachedResults);
        
        // 同时加载 modelPricing, apiKeys, userGroups 到 state
        // 注意：使用配置文件中的站点名称作为 key
        const newModelPricing: Record<string, any> = {};
        const newApiKeys: Record<string, any[]> = {};
        const newUserGroups: Record<string, Record<string, { desc: string; ratio: number }>> = {};
        
        cachedResults.forEach((result) => {
          if (result.modelPricing) {
            newModelPricing[result.name] = result.modelPricing;
            console.log(`💾 [App] 加载 ${result.name} 的定价数据，模型数: ${result.modelPricing?.data ? Object.keys(result.modelPricing.data).length : 0}`);
          }
          if (result.apiKeys) {
            newApiKeys[result.name] = result.apiKeys;
          }
          if (result.userGroups) {
            newUserGroups[result.name] = result.userGroups;
          }
        });
        
        setModelPricing(newModelPricing);
        setApiKeys(newApiKeys);
        setUserGroups(newUserGroups);
      } else {
        console.log('ℹ️ [App] token-storage.json中没有账号数据');
      }
    } catch (error) {
      console.error('❌ [App] 加载缓存数据失败:', error);
    }
  };

  const saveConfig = async (newConfig: Config) => {
    try {
      setSaving(true);
      await window.electronAPI.saveConfig(newConfig);
      setConfig(newConfig);
      console.log('✅ [App] 配置已保存');
    } catch (error) {
      console.error("❌ [App] 保存配置失败:", error);
      alert("保存配置失败: " + error);
    } finally {
      setSaving(false);
    }
  };

  const addSite = async (site: SiteConfig) => {
    if (!config) return;
    // 保存配置
    await saveConfig({ ...config, sites: [...config.sites, site] });
    console.log('✅ [App] 站点已添加到配置，开始刷新数据...');
    
    // 延迟刷新，确保config已更新并对话框已关闭
    setTimeout(async () => {
      try {
        await detectSingle(site, false);  // 完整刷新
        console.log('✅ [App] 新站点数据刷新完成');
      } catch (error: any) {
        console.error('⚠️ [App] 新站点数据刷新失败:', error.message);
      }
    }, 300);
  };

  const updateSite = async (index: number, site: SiteConfig) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = site;
    await saveConfig({ ...config, sites: newSites });
  };

  const deleteSite = async (index: number) => {
    if (!config) return;
    if (!confirm("确定要删除这个站点吗？")) return;
    const newSites = config.sites.filter((_, i) => i !== index);
    await saveConfig({ ...config, sites: newSites });
  };

  const toggleSite = async (index: number) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = { ...newSites[index], enabled: !newSites[index].enabled };
    await saveConfig({ ...config, sites: newSites });
  };

  const detectAllSites = async () => {
    if (!config) return;
    setDetecting(true);
    try {
      const newResults = await window.electronAPI.detectAllSites(config);
      // 合并新结果与旧结果：如果新结果失败且旧结果存在，则保留旧数据但覆盖状态和错误信息
      setResults((prev) => {
        const map = new Map<string, DetectionResult>();
        prev.forEach(r => map.set(r.name, r));
        newResults.forEach((result) => {
          const old = map.get(result.name);
          let effective = result;
          if (result.status === "失败" && old) {
            effective = {
              ...old,
              status: result.status,
              error: result.error,
            };
          }
          map.set(result.name, effective);
        });
        return Array.from(map.values());
      });

      // 更新成功站点的最后检测时间（仅成功时刷新，失败保留旧时间）
      setSiteAccounts((prev) => {
        const next = { ...prev };
        const now = Date.now();
        newResults.forEach((result) => {
          if (result.status === "成功" && next[result.name]) {
            next[result.name] = {
              ...next[result.name],
              last_sync_time: now,
            };
          }
        });
        return next;
      });
    } catch (error) {
      console.error("检测失败:", error);
      alert("检测失败: " + error);
    } finally {
      setDetecting(false);
    }
  };

  // 比较两个检测结果是否有实质性变化
  const hasSignificantChanges = (oldResult: DetectionResult | undefined, newResult: DetectionResult): boolean => {
    if (!oldResult) return true; // 首次检测算作有变化
    
    // 比较关键字段
    const changes: string[] = [];
    
    if (oldResult.status !== newResult.status) changes.push('状态');
    if (oldResult.balance !== newResult.balance) changes.push('余额');
    if (oldResult.todayUsage !== newResult.todayUsage) changes.push('今日消费');
    if (oldResult.models.length !== newResult.models.length) changes.push('模型数量');
    if (JSON.stringify(oldResult.apiKeys) !== JSON.stringify(newResult.apiKeys)) changes.push('API Keys');
    
    return changes.length > 0;
  };

  const detectSingle = async (site: SiteConfig, quickRefresh: boolean = true) => {
    if (!config) return;
    
    // 防止重复刷新
    if (detectingSite === site.name) {
      console.log('⚠️ 站点正在刷新中，请稍候...');
      return;
    }
    
    // 确保设置正在检测状态
    setDetectingSite(site.name);
    
    try {
      // 现有检测结果（用于在失败时保留旧数据）
      const existingResult = results.find(r => r.name === site.name);
      // 快速刷新模式：传递现有的缓存数据
      const cachedResult = quickRefresh ? existingResult : undefined;
      
      const rawResult = await window.electronAPI.detectSite(
        site,
        config.settings.timeout,
        quickRefresh,
        cachedResult
      );
      
      // 如果本次检测失败且存在旧结果，则保留旧数据，只更新状态和错误信息
      const result: DetectionResult = (rawResult.status === "失败" && existingResult)
        ? {
            ...existingResult,
            status: rawResult.status,
            error: rawResult.error,
          }
        : rawResult;
      
      // 检查数据是否有变化
      const hasChanges = hasSignificantChanges(cachedResult, result);
      
      // 显示提示消息
      if (hasChanges) {
        setRefreshMessage({
          site: site.name,
          message: '✅ 数据已更新',
          type: 'success'
        });
      } else {
        setRefreshMessage({
          site: site.name,
          message: 'ℹ️ 数据无变化',
          type: 'info'
        });
      }
      
      // 3秒后自动清除提示
      setTimeout(() => {
        setRefreshMessage(null);
      }, 3000);
      
      // 更新结果
      setResults((prev) => {
        const filtered = prev.filter((r) => r.name !== site.name);
        return [...filtered, result];
      });

      // 成功时更新该站点的最后检测时间（失败时保留旧时间）
      if (rawResult.status === "成功") {
        setSiteAccounts((prev) => {
          const next = { ...prev };
          const acc = next[site.name];
          if (acc) {
            next[site.name] = {
              ...acc,
              last_sync_time: Date.now(),
            };
          }
          return next;
        });
      }
      
      // 立即更新缓存（不管站点是否展开），仅在检测成功时刷新扩展数据
      if (rawResult && rawResult.status === "成功") {
        if (rawResult.apiKeys) {
          setApiKeys(prev => ({ ...prev, [site.name]: rawResult.apiKeys! }));
        }
        if (rawResult.userGroups) {
          setUserGroups(prev => ({ ...prev, [site.name]: rawResult.userGroups! }));
        }
        if (rawResult.modelPricing) {
          console.log(`💾 [App] 保存 ${site.name} 的定价数据，模型数: ${rawResult.modelPricing?.data ? Object.keys(rawResult.modelPricing.data).length : 0}`);
          setModelPricing(prev => ({ ...prev, [site.name]: rawResult.modelPricing! }));
        }
      }
    } catch (error: any) {
      console.error("检测失败:", error);
      
      // 检查是否是浏览器关闭错误
      const errorMessage = error?.message || String(error);
      let displayMessage = '❌ 刷新失败: ' + errorMessage;
      
      if (errorMessage.includes('浏览器已关闭') || errorMessage.includes('操作已取消') || errorMessage.includes('操作已被取消')) {
        displayMessage = '⚠️ 浏览器已关闭，操作已取消。请重新打开浏览器后重试。';
      }
      
      setRefreshMessage({
        site: site.name,
        message: displayMessage,
        type: 'info'
      });
      setTimeout(() => {
        setRefreshMessage(null);
      }, 5000);
    } finally {
      // 确保无论成功失败都清除加载状态
      setDetectingSite(null);
    }
  };

  const openCheckinPage = async (site: SiteConfig) => {
    try {
      await window.electronAPI.openUrl(site.url);
    } catch (error) {
      console.error("打开浏览器失败:", error);
      alert("打开浏览器失败: " + error);
    }
  };

  /**
   * 执行签到
   */
  const handleCheckIn = async (site: SiteConfig) => {
    // 检查是否有必要的认证信息
    if (!site.system_token || !site.user_id) {
      const shouldOpenSite = confirm(
        "签到失败：缺少必要的认证信息\n\n" +
        "是否打开网站手动签到？"
      );
      if (shouldOpenSite) {
        await openCheckinPage(site);
      }
      return;
    }

    setCheckingIn(site.name);

    try {
      const result = await (window.electronAPI as any).token.checkIn(
        site.url,
        parseInt(site.user_id),
        site.system_token
      );

      if (result.success) {
        // 签到成功
        alert(`✅ 签到成功！\n\n${result.message}`);
        // 签到成功后刷新站点数据
        await detectSingle(site, true);
      } else {
        // 签到失败
        if (result.needManualCheckIn) {
          // 需要手动签到
          const shouldOpenSite = confirm(
            `❌ 自动签到失败\n\n${result.message}\n\n` +
            "是否打开网站手动签到？"
          );
          if (shouldOpenSite) {
            await openCheckinPage(site);
          }
        } else {
          // 不需要手动签到（如今日已签到、站点不支持等）
          alert(`ℹ️ ${result.message}`);
        }
      }
    } catch (error: any) {
      console.error("签到失败:", error);
      
      // 检查是否是浏览器关闭错误
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('浏览器已关闭') || errorMessage.includes('操作已取消') || errorMessage.includes('操作已被取消')) {
        alert('⚠️ 浏览器已关闭，操作已取消。\n\n请重新打开浏览器后重试签到。');
      } else {
        const shouldOpenSite = confirm(
          `❌ 签到请求失败\n\n${errorMessage}\n\n` +
          "是否打开网站手动签到？"
        );
        if (shouldOpenSite) {
          await openCheckinPage(site);
        }
      }
    } finally {
      setCheckingIn(null);
    }
  };

  /**
   * 打开加油站链接
   */
  const openExtraLink = async (url: string) => {
    try {
      await window.electronAPI.openUrl(url);
    } catch (error) {
      console.error("打开加油站链接失败:", error);
      alert("打开加油站链接失败: " + error);
    }
  };

  const toggleModelSelection = (model: string) => {
    setSelectedModels((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(model)) {
        newSet.delete(model);
      } else {
        newSet.add(model);
      }
      return newSet;
    });
  };

  const copySelectedModels = async () => {
    if (selectedModels.size === 0) {
      alert("请先选择要复制的模型");
      return;
    }
    
    // 使用逗号分隔所有选中的模型
    const modelsText = Array.from(selectedModels).join(",");
    try {
      await navigator.clipboard.writeText(modelsText);
      alert(`已复制 ${selectedModels.size} 个模型到剪贴板`);
    } catch (error) {
      console.error("复制失败:", error);
      alert("复制失败: " + error);
    }
  };

  // 拖拽处理函数
  const handleDragStart = (e: React.DragEvent, index: number) => {
    // 如果起始拖拽位置在禁止拖拽区域（如二级面板、令牌管理卡片等），直接忽略
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag="true"]')) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // 设置拖拽时的透明度
    (e.target as HTMLElement).style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    
    if (!config || draggedIndex === null || draggedIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }

    // 重新排序站点
    const newSites = [...config.sites];
    const [draggedSite] = newSites.splice(draggedIndex, 1);
    newSites.splice(dropIndex, 0, draggedSite);

    await saveConfig({ ...config, sites: newSites });
    setDragOverIndex(null);
  };

  // 当展开站点时从缓存中加载数据（所有数据在检测时已获取）
  const handleExpandSite = (siteName: string) => {
    setExpandedSites(prev => {
      const newSet = new Set(prev);
      if (newSet.has(siteName)) {
        newSet.delete(siteName);
        console.log(`🔽 [App] 收起站点: ${siteName}`);
        return newSet;
      } else {
        newSet.add(siteName);
        console.log(`🔽 [App] 展开站点: ${siteName}`);
        
        // 展开时从 DetectionResult 缓存中加载数据
        const siteResult = results.find(r => r.name === siteName);
        console.log('📦 [App] 查找结果:', siteResult ? '找到' : '未找到');
        
        if (siteResult) {
          console.log('📊 [App] 数据状态:', {
            hasApiKeys: !!siteResult.apiKeys,
            apiKeysCount: siteResult.apiKeys?.length || 0,
            hasUserGroups: !!siteResult.userGroups,
            userGroupsCount: siteResult.userGroups ? Object.keys(siteResult.userGroups).length : 0,
            hasModelPricing: !!siteResult.modelPricing,
            modelPricingCount: siteResult.modelPricing?.data ? Object.keys(siteResult.modelPricing.data).length : 0
          });
          
          // 从缓存加载数据到 state（即使为空也要设置，避免使用旧数据）
          setApiKeys(prev => ({ ...prev, [siteName]: siteResult.apiKeys || [] }));
          setUserGroups(prev => ({ ...prev, [siteName]: siteResult.userGroups || {} }));
          setModelPricing(prev => ({ ...prev, [siteName]: siteResult.modelPricing || { data: {} } }));
          
          console.log('✅ [App] 数据已加载到 state');
        } else {
          console.warn('⚠️ [App] 未找到站点数据，可能需要先刷新');
        }
        
        return newSet;
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        {/* 装饰背景 */}
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-500" />
          <p className="text-light-text-secondary dark:text-dark-text-secondary">加载配置中...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-light-bg dark:bg-dark-bg relative">
        {/* 装饰背景 */}
        <div className="light-bg-decoration dark:dark-bg-decoration"></div>
        <div className="text-center relative z-10">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-light-text dark:text-dark-text mb-4">配置加载失败</p>
          <button
            onClick={loadConfig}
            className="px-6 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all shadow-lg hover:shadow-xl"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text relative overflow-x-auto overflow-y-hidden">
      {/* 装饰背景 */}
      <div className="light-bg-decoration dark:dark-bg-decoration"></div>
      
      {/* 主要内容 */}
      <div className="relative z-10 h-full flex flex-col">
        <header className="bg-white/80 dark:bg-dark-card/80 backdrop-blur-md border-b border-light-border dark:border-dark-border px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Logo - 使用新的品牌图标 */}
              <div className="relative w-10 h-10 rounded-2xl border border-light-border dark:border-dark-border bg-white/70 dark:bg-dark-card/70 shadow-lg flex items-center justify-center overflow-hidden">
                <img src={Logo} alt="API Hub Management Tools logo" className="w-8 h-8 object-contain select-none" draggable={false} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-light-text dark:text-dark-text">API Hub Management Tools</h1>
              </div>
            </div>
          <div className="flex items-center gap-2">
            {saving && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-lg text-xs border border-primary-500/20">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>保存中...</span>
              </div>
            )}
            <button
              onClick={() => setShowSettings(true)}
                className="px-3 py-1.5 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all flex items-center gap-1.5 text-sm border border-light-border dark:border-dark-border shadow-sm"
            >
                <Settings className="w-4 h-4" strokeWidth={2} />
              设置
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-hidden overflow-x-visible flex">
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-3 bg-white/60 dark:bg-dark-card/60 backdrop-blur-sm border-b border-light-border dark:border-dark-border flex items-center justify-between">
            <button
              onClick={() => {
                setEditingSite(null);
                setShowSiteEditor(true);
              }}
              className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium shadow-md hover:shadow-lg"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />
              添加站点
            </button>
            <button
              onClick={detectAllSites}
              disabled={detecting || !config || config.sites.length === 0}
              className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
            >
              {detecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
                  检测中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" strokeWidth={2.5} />
                  检测所有站点
                </>
              )}
            </button>
          </div>
          {/* 站点列表区域：纵向滚动交给内部容器，横向滚动交给整体窗口（根容器 overflow-x-auto） */}
          <div className="flex-1 overflow-y-auto overflow-x-visible px-4 pb-4 space-y-3">
            {config.sites.length === 0 ? (
              <div className="text-center py-16 text-light-text-secondary dark:text-dark-text-secondary">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                <p className="text-lg font-medium mb-2">还没有添加任何站点</p>
                <p className="text-sm">点击"添加站点"按钮开始</p>
              </div>
            ) : (
              // 为了在窗口变窄时出现横向滚动条，内部内容设置一个最小宽度（由根容器负责横向滚动）
              <>
                {/* 列表表头（固定在滚动容器顶部）：站点名称 / 状态 / 余额 / 今日消费 / 总Token / 输入 / 输出 / 请求 / RPM / TPM / 模型数 / 更新时间 / 操作 */}
                <div className="min-w-[1180px] sticky top-0 z-20 px-4 py-2 bg-light-bg/95 dark:bg-dark-bg/95 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-100">
                  <div
                    className="grid gap-x-1 flex-1 items-center select-none"
                    style={{ gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' ') }}
                  >
                    {[
                      '站点',
                      '状态',
                      '余额',
                      '今日消费',
                      '总 Token',
                      '输入',
                      '输出',
                      '请求',
                      'RPM',
                      'TPM',
                      '模型数',
                      '更新时间',
                    ].map((label, idx) => {
                      const centerHeader = idx >= 4 && idx <= 11; // 总 Token / 输入 / 输出 / 请求 / RPM / TPM / 模型数 / 更新时间
                      return (
                        <div
                          key={label}
                          className={`relative flex items-center pr-1 ${
                            centerHeader ? 'justify-center text-center' : 'justify-start'
                          }`}
                        >
                          <span className={centerHeader ? 'w-full text-center' : undefined}>
                            {label}
                          </span>
                        {/* 列宽调整拖拽条：占据单元格右侧 4px 区域 */}
                          <div
                            onMouseDown={(e) => handleColumnResizeMouseDown(e, idx)}
                            className="absolute top-0 right-0 h-full w-1 cursor-col-resize group"
                          >
                            <div className="w-[3px] h-full mx-auto opacity-0 group-hover:opacity-60 bg-slate-300 dark:bg-slate-500 transition-opacity" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="w-[96px] text-right pr-1">站点操作</div>
                </div>

                <div className="min-w-[1180px] space-y-3">
                  {config.sites.map((site, index) => {
                    // 先按名称匹配检测结果，如果名称被修改则回退到按URL匹配
                    let siteResult = results.find(r => r.name === site.name);
                    if (!siteResult) {
                      try {
                        const siteOrigin = new URL(site.url).origin;
                        siteResult = results.find(r => {
                          try {
                            return new URL(r.url).origin === siteOrigin;
                          } catch {
                            return false;
                          }
                        });
                      } catch {
                        // ignore url parse error
                      }
                    }
                    const isExpanded = expandedSites.has(site.name);
                // 账号信息也优先按名称匹配，失败时按URL回退
                let siteAccount = siteAccounts[site.name];
                if (!siteAccount) {
                  try {
                    const urlKey = new URL(site.url).origin;
                    siteAccount = siteAccounts[urlKey];
                  } catch {
                    // ignore
                  }
                }
                
                // 计算最后更新时间显示：
                // - 如果是今天：显示具体「小时:分钟」（如 13:45）
                // - 7天以内：显示「X天前」
                // - 超过7天且在1个月以内：显示「X周前」
                // - 超过1个月：显示「X月前」
                let lastSyncDisplay: string | null = null;
                if (siteAccount?.last_sync_time) {
                  const dt = new Date(siteAccount.last_sync_time);
                  const now = new Date();

                  const isSameDay =
                    dt.getFullYear() === now.getFullYear() &&
                    dt.getMonth() === now.getMonth() &&
                    dt.getDate() === now.getDate();

                  if (isSameDay) {
                    const hour = String(dt.getHours()).padStart(2, '0');
                    const minute = String(dt.getMinutes()).padStart(2, '0');
                    lastSyncDisplay = `${hour}:${minute}`;
                  } else {
                    const diffMs = now.getTime() - dt.getTime();
                    const diffDays = Math.max(Math.floor(diffMs / (1000 * 60 * 60 * 24)), 1);

                    if (diffDays < 7) {
                      lastSyncDisplay = `${diffDays}天前`;
                    } else if (diffDays < 30) {
                      const weeks = Math.max(Math.floor(diffDays / 7), 1);
                      lastSyncDisplay = `${weeks}周前`;
                    } else {
                      const months = Math.max(Math.floor(diffDays / 30), 1);
                      lastSyncDisplay = `${months}月前`;
                    }
                  }
                }
                
                // 从错误信息中提取 Error Code（例如 "status code 403"）
                let errorCode: string | null = null;
                // 从错误信息中提取超时秒数（例如 "timeout of 10000ms exceeded"）
                let timeoutSeconds: number | null = null;
                if (siteResult?.error) {
                  const codeMatch = siteResult.error.match(/status code (\d{3})/i);
                  if (codeMatch) {
                    errorCode = codeMatch[1];
                  }
                  const timeoutMatch = siteResult.error.match(/timeout.*?(\d+)\s*ms/i);
                  if (timeoutMatch) {
                    const ms = parseInt(timeoutMatch[1], 10);
                    if (!isNaN(ms) && ms > 0) {
                      timeoutSeconds = Math.round(ms / 1000);
                    }
                  }
                }

                // ===== 日志指标计算（总 Token / 输入 / 输出 / 请求 / RPM / TPM）=====
                const todayPromptTokens = siteResult?.todayPromptTokens ?? 0;
                const todayCompletionTokens = siteResult?.todayCompletionTokens ?? 0;
                const todayTotalTokens =
                  siteResult?.todayTotalTokens ?? (todayPromptTokens + todayCompletionTokens);
                const todayRequests = siteResult?.todayRequests ?? 0;

                // 以本地时间的「今日 00:00」到当前时间作为统计窗口，计算平均 RPM / TPM
                const now = new Date();
                const dayStart = new Date(now);
                dayStart.setHours(0, 0, 0, 0);
                const minutesSinceStart = Math.max(
                  (now.getTime() - dayStart.getTime()) / 60000,
                  1
                );
                const rpm = todayRequests > 0 ? todayRequests / minutesSinceStart : 0;
                const tpm = todayTotalTokens > 0 ? todayTotalTokens / minutesSinceStart : 0;
                
                return (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm rounded-xl border transition-all cursor-move ${
                      site.enabled 
                        ? "border-primary-200/30 dark:border-primary-700/40 hover:border-primary-300/50 dark:hover:border-primary-600/60 shadow-md hover:shadow-lg dark:shadow-slate-900/50 dark:hover:shadow-slate-900/70" 
                        : "border-slate-200/40 dark:border-slate-600/40 opacity-60 shadow-sm dark:shadow-slate-900/30"
                    } ${
                      dragOverIndex === index ? "border-primary-500/60 border-2 scale-[1.02] shadow-xl dark:shadow-primary-900/50" : ""
                    }`}
                  >
                    {/* 刷新提示消息 */}
                    {refreshMessage && refreshMessage.site === site.name && (
                      <div className={`mx-3 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        refreshMessage.type === 'success'
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30'
                          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                      }`}>
                        {refreshMessage.message}
                      </div>
                    )}
                    
                    {/* 一级信息 - 紧凑卡片布局（固定栅格列宽确保对齐） */}
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        {/* 左侧：固定宽度栅格，确保所有站点卡片上下对齐（多列布局，与表头对应）*/}
                        <div
                          className="grid gap-x-1 items-center text-xs"
                          style={{ gridTemplateColumns: columnWidths.map(w => `${w}px`).join(' ') }}
                        >
                            {/* 1. 站点名称（不再在这里显示状态图标，状态列单独展示） */}
                            <button
                              onClick={() => openCheckinPage(site)}
                              className="flex items-center hover:text-primary-400 transition-colors group min-w-0"
                              title={`打开 ${site.name}`}
                            >
                              <span className="font-bold text-sm md:text-base truncate">
                                {site.name}
                              </span>
                            </button>

                            {/* 2. 状态（在线/离线/未检测） + 错误码/超时信息 */}
                            <div className="flex flex-col items-start gap-0.5">
                              <div className="flex items-center gap-1">
                                {siteResult ? (
                                  siteResult.status === "成功" ? (
                                    <div
                                      className="w-2 h-2 rounded-full bg-green-500 animate-pulse"
                                      title="在线"
                                    />
                                  ) : (
                                    <div
                                      className="w-2 h-2 rounded-full bg-red-500"
                                      title="离线"
                                    />
                                  )
                                ) : (
                                  <div
                                    className="w-2 h-2 rounded-full bg-gray-500"
                                    title="未检测"
                                  />
                                )}
                                <span
                                  className={`${
                                    siteResult
                                      ? siteResult.status === "成功"
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-red-500 dark:text-red-400"
                                      : "text-slate-400 dark:text-slate-500"
                                  }`}
                                >
                                  {siteResult
                                    ? siteResult.status === "成功"
                                      ? "在线"
                                      : "离线"
                                    : "未检测"}
                                </span>
                              </div>
                              {errorCode && (
                                <span className="text-red-500 dark:text-red-400 text-[11px] font-semibold">
                                  Err {errorCode}
                                </span>
                              )}
                              {!errorCode && timeoutSeconds !== null && (
                                <span className="text-red-500 dark:text-red-400 text-[11px] font-semibold">
                                  Timeout {timeoutSeconds}s
                                </span>
                              )}
                            </div>

                            {/* 3. 余额 */}
                            <div className="flex flex-col">
                              {siteResult &&
                              siteResult.balance !== undefined &&
                              siteResult.balance !== null ? (
                                siteResult.balance === -1 ? (
                                  <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                                    ∞
                                  </span>
                                ) : (
                                  <span className="font-mono font-semibold text-green-600 dark:text-green-400 truncate">
                                    ${siteResult.balance.toFixed(2)}
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">
                                  --
                                </span>
                              )}
                            </div>

                            {/* 4. 今日消费 */}
                            <div className="flex flex-col">
                              {siteResult && siteResult.todayUsage !== undefined ? (
                                <span className="font-mono font-semibold text-orange-600 dark:text-orange-400 truncate">
                                  $-{siteResult.todayUsage.toFixed(2)}
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">
                                  --
                                </span>
                              )}
                            </div>

                            {/* 5. 总 Token */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {todayTotalTokens.toLocaleString()}
                              </span>
                            </div>

                            {/* 6. 输入 Token */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {todayPromptTokens.toLocaleString()}
                              </span>
                            </div>

                            {/* 7. 输出 Token */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {todayCompletionTokens.toLocaleString()}
                              </span>
                            </div>

                            {/* 8. 请求次数 */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {todayRequests.toLocaleString()}
                              </span>
                            </div>

                            {/* 9. RPM */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {rpm.toFixed(2)}
                              </span>
                            </div>

                            {/* 10. TPM */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span className="font-mono font-medium">
                                {tpm.toFixed(0)}
                              </span>
                            </div>

                            {/* 11. 模型数 */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              <span
                                className={`font-medium ${
                                  (() => {
                                    const key = siteResult?.name || site.name;
                                    const pricing = modelPricing[key];
                                    const apiModelCount =
                                      siteResult?.models?.length || 0;
                                    const pricingModelCount = pricing?.data
                                      ? Object.keys(pricing.data).length
                                      : 0;
                                    const actualCount = Math.max(
                                      apiModelCount,
                                      pricingModelCount
                                    );
                                    return actualCount > 0
                                      ? "text-blue-600 dark:text-blue-400"
                                      : "text-slate-400 dark:text-slate-500";
                                  })()
                                }`}
                              >
                                {(() => {
                                  const key = siteResult?.name || site.name;
                                  const pricing = modelPricing[key];
                                  const apiModelCount =
                                    siteResult?.models?.length || 0;
                                  const pricingModelCount = pricing?.data
                                    ? Object.keys(pricing.data).length
                                    : 0;
                                  return Math.max(apiModelCount, pricingModelCount);
                                })()}
                              </span>
                            </div>

                            {/* 12. 更新时间 */}
                            <div className="flex flex-col items-center justify-center text-[11px] text-slate-600 dark:text-slate-300">
                              {lastSyncDisplay ? (
                                <span className="font-medium">
                                  {lastSyncDisplay}
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">
                                  --
                                </span>
                              )}
                            </div>
                        </div>
                        
                        {/* 右侧：操作按钮组（固定在右侧）*/}
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          {/* 签到按钮 - 优先使用用户配置，然后使用检测结果 */}
                          {(site.force_enable_checkin || siteResult?.has_checkin) && (
                            <>
                              {/* 可签到：显示签到按钮 */}
                              {(siteResult?.can_check_in === true || (site.force_enable_checkin && siteResult?.can_check_in !== false)) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCheckIn(site);
                                  }}
                                  disabled={checkingIn === site.name}
                                  className="px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded transition-all flex items-center gap-1 text-xs font-semibold disabled:opacity-50"
                                  title="点击签到"
                                >
                                  {checkingIn === site.name ? (
                                    <>
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                      <span>签到中</span>
                                    </>
                                  ) : (
                                    <>
                                      <Calendar className="w-3 h-3" />
                                      <span>签到</span>
                                    </>
                                  )}
                                </button>
                              )}

                              {/* 已签到：显示已签标签 */}
                              {siteResult?.can_check_in === false && (
                                <div className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded flex items-center gap-1 text-xs" title="今日已签到">
                                  <CheckCircle className="w-3 h-3" />
                                  <span>已签</span>
                                </div>
                              )}
                            </>
                          )}

                          {/* 加油站按钮 - 如果设置了加油站链接 */}
                          {site.extra_links && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openExtraLink(site.extra_links!);
                              }}
                              className="px-2 py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-700 dark:text-purple-300 rounded transition-all flex items-center gap-1 text-xs font-semibold"
                              title={`打开加油站: ${site.extra_links}`}
                            >
                              <Fuel className="w-3 h-3 animate-pulse" />
                              <span>加油站</span>
                            </button>
                          )}
                          
                          {/* 展开/收起按钮 */}
                          <button
                            onClick={() => handleExpandSite(site.name)}
                            className="p-1 hover:bg-white/10 rounded transition-all"
                            title={isExpanded ? "收起详情" : "展开详情"}
                          >
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {/* 复制 URL 按钮（复制站点地址） */}
                          <button
                            onClick={() => copyToClipboard(site.url, 'URL')}
                            className="p-1 hover:bg-white/10 rounded transition-all"
                            title="复制URL"
                          >
                            <Copy className="w-3.5 h-3.5 text-gray-400" />
                          </button>
                          
                          <button
                            onClick={() => detectSingle(site)}
                            disabled={detectingSite === site.name}
                            className="p-1 hover:bg-primary-500/20 rounded transition-all disabled:opacity-50"
                            title="刷新检测"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${detectingSite === site.name ? 'animate-spin' : ''}`} />
                          </button>
                          
                          <button
                            onClick={() => toggleSite(index)}
                            className="p-1 hover:bg-white/10 rounded transition-all"
                            title={site.enabled ? "禁用站点" : "启用站点"}
                          >
                            <CheckCircle className={`w-3.5 h-3.5 ${site.enabled ? "text-green-500" : "text-gray-500"}`} />
                          </button>
                          
                          <button
                            onClick={() => { setEditingSite(index); setShowSiteEditor(true); }}
                            className="p-1 hover:bg-white/10 rounded transition-all"
                            title="编辑站点"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          
                          <button
                            onClick={() => deleteSite(index)}
                            className="p-1 hover:bg-red-500/20 rounded transition-all"
                            title="删除站点"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* 二级展开面板 */}
                    {isExpanded && (
                      <div
                        className="border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-900/60 px-3 py-1.5 space-y-1 cursor-default"
                        data-no-drag="true"
                      >
                        {/* 用户分组 */}
                        {(() => {
                          const key = siteResult?.name || site.name;
                          return userGroups[key] && Object.keys(userGroups[key]).length > 0;
                        })() && (
                          <div className="flex items-center gap-1 flex-wrap py-0">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">用户分组</span>
                            {Object.entries(userGroups[siteResult?.name || site.name]).map(([groupName, groupData]: [string, any]) => (
                              <button
                                key={groupName}
                                onClick={() => toggleGroupFilter(site.name, groupName)}
                                className={`px-1.5 py-0.5 rounded text-xs font-medium transition-all flex items-center gap-0.5 ${
                                  selectedGroup[site.name] === groupName
                                    ? 'bg-primary-600 text-white shadow-lg'
                                    : `${getGroupTextColor(groupName)} hover:opacity-70`
                                }`}
                                title={`${groupData.desc} (倍率: ${groupData.ratio})`}
                              >
                                {getGroupIcon(groupName, true)}
                                <span className="font-semibold">{groupName}</span>
                                <span className="opacity-90">×{groupData.ratio}</span>
                              </button>
                            ))}
                            {selectedGroup[site.name] && (
                              <button
                                onClick={() => toggleGroupFilter(site.name, null)}
                                className="px-1.5 py-0.5 rounded text-xs font-medium text-red-400 hover:text-red-300 transition-all"
                              >
                                清除
                              </button>
                            )}
                          </div>
                        )}
                        
                        {/* 令牌管理（API Keys 列表） */}
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1 justify-between">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
                              {(() => {
                                const siteKey = siteResult?.name || site.name;
                                const allKeys = apiKeys[siteKey] || [];
                                return `令牌管理 (${getFilteredApiKeys(siteKey).length}/${allKeys.length})`;
                              })()}
                              {selectedGroup[site.name] && (
                                <span className="ml-1 text-primary-400">· {selectedGroup[site.name]}</span>
                              )}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openCreateTokenDialog(site);
                              }}
                              className="px-1.5 py-0.5 bg-primary-600 hover:bg-primary-700 text-white rounded text-xs flex items-center gap-0.5 shadow-sm"
                              title="创建新的 API Key"
                            >
                              <Plus className="w-3 h-3" />
                              <span>添加令牌</span>
                            </button>
                          </div>
                          {(() => {
                            const siteKey = siteResult?.name || site.name;
                            const allKeys = apiKeys[siteKey] || [];
                            const filtered = getFilteredApiKeys(siteKey);

                            if (!allKeys || allKeys.length === 0) {
                              return (
                                <div className="px-1 text-[11px] text-slate-400 dark:text-slate-500">
                                  暂无 API Key，可点击右侧“添加令牌”创建。
                                </div>
                              );
                            }

                            return (
                              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                                {filtered.map((token: any, idx: number) => {
                                  const quotaInfo = token.unlimited_quota ? null : getQuotaTypeInfo(token.type || 0);
                                  return (
                                    <div
                                      key={idx}
                                      className="px-1.5 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-all"
                                    >
                                      {/* 单行固定栅格布局：名称 | 状态 | 分组 | 标签 | 已使用 | API Key | 操作 */}
                                      <div className="grid grid-cols-[120px_50px_180px_90px_120px_minmax(280px,1fr)_60px] gap-x-3 items-center text-xs">
                                        {/* 1. 名称 */}
                                        <div className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                                          {token.name || `Key #${idx + 1}`}
                                        </div>
                                        
                                        {/* 2. 状态（不要框框）*/}
                                        <div className={`font-medium ${
                                          token.status === 1
                                            ? 'text-green-600 dark:text-green-400'
                                            : 'text-gray-500 dark:text-gray-400'
                                        }`}>
                                          {token.status === 1 ? '✓ 启用' : '✕ 禁用'}
                                        </div>
                                        
                                        {/* 3. 分组（带图标，颜色与「用户分组」保持一致，仅文字颜色，无背景）*/}
                                        <div className="min-w-0">
                                          {token.group && token.group.trim() ? (
                                            <span
                                              className={`font-medium flex items-center gap-1 ${getGroupTextColor(
                                                token.group,
                                              )}`}
                                            >
                                              {getGroupIcon(token.group, true)}
                                              <span>{token.group}</span>
                                            </span>
                                          ) : (
                                            <span className="text-slate-400 dark:text-slate-500">--</span>
                                          )}
                                        </div>
                                        
                                        {/* 4. 标签（颜色与名称保持一致）*/}
                                        <div className="text-slate-800 dark:text-slate-100">
                                          {token.unlimited_quota ? (
                                            <span className="font-medium">限额: ∞</span>
                                          ) : quotaInfo ? (
                                            <span className="font-medium">限额: {quotaInfo.text}</span>
                                          ) : (
                                            <span className="text-slate-400 dark:text-slate-500">--</span>
                                          )}
                                        </div>
                                        
                                        {/* 5. 已使用: xxx */}
                                        <div className="text-slate-600 dark:text-slate-400">
                                          {token.used_quota !== undefined ? (
                                            <>
                                              已使用: <span className="text-orange-600 dark:text-orange-400 font-semibold">${(token.used_quota / 500000).toFixed(2)}</span>
                                            </>
                                          ) : (
                                            <span className="text-slate-400 dark:text-slate-500">已使用: --</span>
                                          )}
                                        </div>
                                        
                                        {/* 6. API Key（头尾显示更多字符）*/}
                                        <div className="font-mono text-blue-600 dark:text-blue-400 truncate pl-[100px]">
                                          {(() => {
                                            const fullKey = addSkPrefix(token.key);
                                            const isVisible = showTokens[`${site.name}_key_${idx}`] || false;
                                            if (isVisible) {
                                              return fullKey;
                                            }
                                            // 显示更多头尾字符：前12位 + ... + 后8位
                                            if (fullKey.length > 25) {
                                              return `${fullKey.slice(0, 12)}...${fullKey.slice(-8)}`;
                                            }
                                            return fullKey;
                                          })()}
                                        </div>
                                        
                                        {/* 7. 操作 */}
                                        <div className="flex items-center gap-0.5 justify-end">
                                          <button
                                            onClick={() => toggleTokenVisibility(`${site.name}_key_${idx}`)}
                                            className="p-0.5 hover:bg-white/10 rounded transition-all"
                                          >
                                            {showTokens[`${site.name}_key_${idx}`] ? (
                                              <EyeOff className="w-3 h-3 text-gray-400" />
                                            ) : (
                                              <Eye className="w-3 h-3 text-gray-400" />
                                            )}
                                          </button>
                                          <button
                                            onClick={() => copyToClipboard(addSkPrefix(token.key), `API Key: ${token.name}`)}
                                            className="p-0.5 hover:bg-white/10 rounded transition-all"
                                          >
                                            <Copy className="w-3 h-3 text-gray-400" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteToken(site, token, idx)}
                                            disabled={deletingTokenKey === `${site.name}_${token.id ?? token.key ?? idx}`}
                                            className="p-0.5 hover:bg-red-500/20 rounded transition-all disabled:opacity-60"
                                            title="删除该 API Key"
                                          >
                                            {deletingTokenKey === `${site.name}_${token.id ?? token.key ?? idx}` ? (
                                              <Loader2 className="w-3 h-3 text-red-500 animate-spin" />
                                            ) : (
                                              <Trash2 className="w-3 h-3 text-red-500" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                        
                        {/* 可用模型列表 - 添加搜索框 */}
                        {(() => {
                          if (!siteResult) {
                            return null;
                          }
                          
                          // 优先使用定价数据中的模型列表（更完整），如果没有则使用API返回的模型列表
                          const pricing = modelPricing[site.name];
                          let allModels = siteResult.models || [];
                          
                          console.log(`🔍 [App] ${site.name} 模型数据检查:`, {
                            apiModels: allModels.length,
                            hasPricing: !!pricing,
                            hasPricingData: !!pricing?.data,
                            pricingDataType: typeof pricing?.data,
                            pricingDataIsObject: typeof pricing?.data === 'object',
                            pricingModelsCount: pricing?.data ? Object.keys(pricing.data).length : 0,
                            pricingDataKeys: pricing?.data ? Object.keys(pricing.data).slice(0, 5) : []
                          });
                          
                          if (pricing?.data && typeof pricing.data === 'object') {
                            const pricingModels = Object.keys(pricing.data);
                            console.log(`📦 [App] ${site.name} 定价数据模型数: ${pricingModels.length}, API模型数: ${allModels.length}`);
                            if (pricingModels.length > allModels.length) {
                              console.log(`📊 [App] ${site.name}: 使用定价数据中的模型列表 (${pricingModels.length}个) 替代API返回的模型列表 (${allModels.length}个)`);
                              allModels = pricingModels;
                            }
                          }
                          
                          return allModels.length > 0 && (
                            <div className="space-y-0.5">
                              <div className="flex items-center justify-between gap-1">
                                <div className="flex items-center gap-1 flex-1">
                                  <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold whitespace-nowrap">
                                    可用模型 ({getFilteredModels(site.name, allModels).length}/{allModels.length})
                                    {selectedModels.size > 0 && (
                                      <span className="ml-1 text-primary-400">· 已选{selectedModels.size}</span>
                                    )}
                                    {selectedGroup[site.name] && (
                                      <span className="ml-1 text-primary-400">· {selectedGroup[site.name]}</span>
                                    )}
                                  </span>
                                {/* 搜索框（整体右移，略小于原先偏移） */}
                                <div className="ml-7">
                                  <input
                                    type="text"
                                    placeholder="搜索..."
                                    value={modelSearch[site.name] || ''}
                                    onChange={(e) => setModelSearch(prev => ({ ...prev, [site.name]: e.target.value }))}
                                    className="px-1.5 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-400 transition-colors w-[100px]"
                                  />
                                </div>
                              </div>
                              {selectedModels.size > 0 && (
                                <button
                                  onClick={copySelectedModels}
                                  className="px-1.5 py-0.5 bg-green-500 hover:bg-green-600 text-white rounded text-xs flex items-center gap-0.5 whitespace-nowrap font-medium shadow-sm"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                  复制
                                </button>
                              )}
                            </div>
                            <div className="max-h-32 overflow-y-auto p-1 bg-slate-50 dark:bg-slate-900/80 rounded border border-slate-200/50 dark:border-slate-700/50">
                              <div className="flex flex-wrap gap-0.5">
                                {getFilteredModels(site.name, allModels).map((model, idx) => {
                                  const pricing = modelPricing[site.name];
                                  const pricingData = pricing?.data?.[model] || pricing?.[model];
                                  
                                  // 调试日志
                                  if (idx === 0) {
                                    console.log('🔍 [App] 模型定价调试:', {
                                      siteName: site.name,
                                      modelName: model,
                                      hasPricing: !!pricing,
                                      hasPricingData: !!pricing?.data,
                                      pricingKeys: pricing ? Object.keys(pricing) : [],
                                      pricingDataKeys: pricing?.data ? Object.keys(pricing.data) : [],
                                      pricingData,
                                      rawPricing: pricing
                                    });
                                  }
                                  
                                  // 获取计费类型：优先使用 quota_type（数字），否则从 type 字符串转换
                                  let quotaType = pricingData?.quota_type;
                                  if (quotaType === undefined && pricingData?.type) {
                                    // 如果没有 quota_type，从 type 字符串转换：'times' = 1, 'tokens' = 0
                                    quotaType = pricingData.type === 'times' ? 1 : 0;
                                  }
                                  // 注意：不使用 || 运算符，因为 0 是有效值
                                  if (quotaType === undefined || quotaType === null) {
                                    quotaType = 0;  // 默认为 0（按量）
                                  }
                                  const quotaInfo = pricingData ? getQuotaTypeInfo(quotaType) : null;
                                  
                                  // 计算价格（参考 all-api-hub 的 calculateModelPrice）
                                  let inputPrice: number | undefined;
                                  let outputPrice: number | undefined;
                                  const completionRatio = pricingData?.completion_ratio || 1;
                                  const enableGroups = pricingData?.enable_groups || [];
                                  
                                  // 获取用户分组倍率（默认为1）
                                  const groupRatio = userGroups[siteResult?.name || site.name] || {};
                                  const currentGroup = selectedGroup[site.name] || 'default';
                                  const groupMultiplier = groupRatio[currentGroup]?.ratio || 1;
                                  
                                  if (pricingData) {
                                    // 调试日志（仅第一个模型）
                                    if (idx === 0) {
                                      console.log('💰 [App] 价格计算调试:', {
                                        siteName: site.name,
                                        model,
                                        quotaType,
                                        modelPriceType: typeof pricingData.model_price,
                                        modelPrice: pricingData.model_price,
                                        modelRatio: pricingData.model_ratio,
                                        completionRatio,
                                        currentGroup,
                                        groupMultiplier,
                                        allPricingData: pricingData
                                      });
                                    }
                                    
                                    // Done Hub/One Hub: model_price 总是对象 { input, output }
                                    if (typeof pricingData.model_price === 'object' && pricingData.model_price !== null) {
                                      // Done Hub 返回的价格已经包含用户分组倍率，不需要再乘以 groupMultiplier
                                      const DONE_HUB_TOKEN_TO_CALL_RATIO = 0.001;  // Done Hub 按次计费系数
                                      
                                      if (quotaType === 1) {
                                        // 按次计费：价格已包含分组倍率，只需 × 0.001 转换单位
                                        inputPrice = pricingData.model_price.input * DONE_HUB_TOKEN_TO_CALL_RATIO;
                                        outputPrice = pricingData.model_price.output * DONE_HUB_TOKEN_TO_CALL_RATIO;
                                        
                                        if (idx === 0) {
                                          console.log(`   按次计费(Done Hub): ${pricingData.model_price.input} × ${DONE_HUB_TOKEN_TO_CALL_RATIO} = ${inputPrice} (不乘以groupMultiplier)`);
                                        }
                                      } else {
                                        // 按量计费：价格已包含分组倍率，直接使用（$/1M tokens）
                                        inputPrice = pricingData.model_price.input;
                                        outputPrice = pricingData.model_price.output;
                                        
                                        if (idx === 0) {
                                          console.log(`   按量计费(Done Hub): 直接使用 input=${pricingData.model_price.input}, output=${pricingData.model_price.output}`);
                                          console.log(`   最终显示: ↑$${inputPrice !== undefined ? formatPrice(inputPrice) : '?'} ↓$${outputPrice !== undefined ? formatPrice(outputPrice) : '?'}`);
                                        }
                                      }
                                    } 
                                    // New API: model_price 是数字（按次计费）或使用 model_ratio（按量计费）
                                    else if (quotaType === 1 && typeof pricingData.model_price === 'number') {
                                      // New API 按次计费
                                      inputPrice = pricingData.model_price * groupMultiplier;
                                      outputPrice = pricingData.model_price * groupMultiplier;
                                      
                                      if (idx === 0) {
                                        console.log(`   按次计费(New API): ${pricingData.model_price} × ${groupMultiplier} = ${inputPrice}`);
                                      }
                                    } 
                                    else {
                                      // New API 按量计费：使用 model_ratio 计算
                                      const modelRatio = pricingData.model_ratio || 1;
                                      inputPrice = modelRatio * 2 * groupMultiplier;
                                      outputPrice = modelRatio * completionRatio * 2 * groupMultiplier;
                                      
                                      if (idx === 0) {
                                        console.log(`   按量计费(New API): ${modelRatio} × 2 × ${groupMultiplier} = ${inputPrice}`);
                                      }
                                    }
                                  }
                                  
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => toggleModelSelection(model)}
                                      className={`px-1.5 py-0.5 rounded border transition-all flex flex-col items-start gap-0 ${
                                        selectedModels.has(model)
                                          ? "bg-primary-100 dark:bg-primary-900/40 border-primary-500 dark:border-primary-400"
                                          : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-750"
                                      }`}
                                      title={model}
                                    >
                                      {/* 第一行：模型名称 */}
                                      <div className="flex items-center gap-0.5 w-full">
                                        <span className="text-xs font-mono text-slate-900 dark:text-slate-50 truncate flex-1 font-medium">
                                          {model}
                                        </span>
                                      </div>
                                      
                                      {/* 第二行：用户分组图标 + 计费类型 + 价格 */}
                                      <div className="flex items-center gap-0.5 text-xs w-full mt-0.5">
                                        {/* 用户分组图标 */}
                                        {enableGroups && enableGroups.length > 0 && (
                                          <div className="flex items-center gap-0.5">
                                            {enableGroups.map((group: string, gidx: number) => (
                                              <span
                                                key={gidx}
                                                className={getGroupTextColor(group)}
                                              >
                                                {getGroupIcon(group, true)}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        
                                        {/* 计费类型图标 */}
                                        {quotaInfo && (
                                          <span className={`p-0.5 rounded border ${quotaInfo.color}`} title={quotaInfo.text}>
                                            {quotaInfo.icon}
                                          </span>
                                        )}
                                        
                                        {/* 价格信息 */}
                                        {(inputPrice !== undefined || outputPrice !== undefined) && (
                                          <>
                                            {quotaType === 1 ? (
                                              // 按次计费：显示单次价格
                                              <span className="text-yellow-700 dark:text-yellow-400 font-semibold" title="单次调用价格">
                                                ${typeof inputPrice === 'number' ? formatPrice(inputPrice) : '0'}/次
                                              </span>
                                            ) : (
                                              // 按量计费：显示每1M tokens价格
                                              <>
                                                {inputPrice !== undefined && (
                                                  <span className="text-green-700 dark:text-green-400 font-semibold" title="输入价格(/1M tokens)">
                                                    ↑${formatPrice(inputPrice)}
                                                  </span>
                                                )}
                                                {outputPrice !== undefined && (
                                                  <span className="text-orange-700 dark:text-orange-400 font-semibold" title={`输出价格(/1M tokens) ×${completionRatio}`}>
                                                    ↓${formatPrice(outputPrice)}
                                                  </span>
                                                )}
                                              </>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          );
                        })()}
                        
                        {/* 错误信息 */}
                        {(siteResult?.error) && (
                          <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <p className="text-xs text-red-400">❌ {siteResult.error}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* 关闭 relative z-10 h-full flex flex-col 的 div */}
      </div>

      {showSiteEditor && (
        <SiteEditor
          site={editingSite !== null ? config.sites[editingSite] : undefined}
          onSave={(site) => {
            if (editingSite !== null) {
              updateSite(editingSite, site);
            } else {
              addSite(site);
            }
            setShowSiteEditor(false);
          }}
          onCancel={() => setShowSiteEditor(false)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={config.settings}
          onSave={async (settings) => {
            await saveConfig({ ...config, settings });
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
        />
      )}

      {/* 创建 API Key 弹窗 */}
      {creatingTokenSite && (
        <div
          key={tokenDialogVersion}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
        >
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                为「{creatingTokenSite.name}」创建 API Key
              </h2>
              <button
                onClick={closeCreateTokenDialog}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="关闭"
              >
                <XCircle className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            <div className="space-y-3">
              {/* 名称 */}
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  名称
                </label>
                <input
                  type="text"
                  ref={nameInputRef}
                  value={newTokenForm.name}
                  onChange={(e) => setNewTokenForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="请输入令牌名称"
                />
              </div>

              {/* 分组 */}
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  分组
                </label>
                {(() => {
                  const siteResult = results.find(r => r.name === creatingTokenSite.name);
                  const siteKey = siteResult?.name || creatingTokenSite.name;
                  const groups = userGroups[siteKey] || {};
                  const groupNames = Object.keys(groups);

                  if (groupNames.length === 0) {
                    return (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          未获取到分组信息，默认使用 <span className="font-mono">default</span>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <select
                      value={newTokenForm.group}
                      onChange={(e) => setNewTokenForm(prev => ({ ...prev, group: e.target.value }))}
                      className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    >
                      {groupNames.map((groupName) => (
                        <option key={groupName} value={groupName}>
                          {groupName} {groups[groupName]?.desc ? `- ${groups[groupName].desc}` : ''}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>

              {/* 过期时间 */}
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  过期时间（默认永不过期）
                </label>
                <input
                  type="datetime-local"
                  value={newTokenForm.expiredTime}
                  onChange={(e) => setNewTokenForm(prev => ({ ...prev, expiredTime: e.target.value }))}
                  className="w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  留空表示永不过期。
                </p>
              </div>

              {/* 额度设置 */}
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  额度设置
                </label>
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={newTokenForm.unlimitedQuota}
                      onChange={(e) => setNewTokenForm(prev => ({ ...prev, unlimitedQuota: e.target.checked }))}
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                    <span>无限额度</span>
                  </label>
                </div>
                {!newTokenForm.unlimitedQuota && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newTokenForm.quota}
                      onChange={(e) => setNewTokenForm(prev => ({ ...prev, quota: e.target.value }))}
                      className="flex-1 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                      placeholder="输入额度（单位：美元）"
                    />
                    <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      单位：美元
                    </span>
                  </div>
                )}
                {newTokenForm.unlimitedQuota && (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    勾选后表示不限制额度，后端会忽略具体额度数值。
                  </p>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeCreateTokenDialog}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                disabled={creatingToken}
              >
                取消
              </button>
              <button
                onClick={handleCreateTokenSubmit}
                disabled={creatingToken}
                className="px-3 py-1.5 rounded bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-xs text-white flex items-center gap-1 transition-colors"
              >
                {creatingToken ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>创建中...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3 h-3" />
                    <span>提交创建</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
