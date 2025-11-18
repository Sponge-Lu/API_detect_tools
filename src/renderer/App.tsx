import { useEffect, useState } from "react";
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
  error?: string;
  has_checkin: boolean;  // 是否支持签到功能
  can_check_in?: boolean;  // 今日是否可签到（true=可签到, false=已签到）
  // 新增：缓存的扩展数据
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: any;
}

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

  // 切换令牌显示/隐藏
  const toggleTokenVisibility = (siteName: string) => {
    setShowTokens(prev => ({ ...prev, [siteName]: !prev[siteName] }));
  };

  // 脱敏显示令牌
  const maskToken = (token: string | undefined, show: boolean): string => {
    if (!token) return '未设置';
    if (show) return token;
    if (token.length <= 8) return '***';
    return `${token.substring(0, 3)}...${token.substring(token.length - 4)}`;
  };

  // 为API Key添加sk-前缀（如果没有）
  const addSkPrefix = (key: string): string => {
    if (!key) return '';
    return key.startsWith('sk-') ? key : `sk-${key}`;
  };

  // 获取分组的颜色样式（API Key 使用，包含背景色）
  const getGroupColor = (groupName: string): string => {
    const colors: Record<string, string> = {
      'default': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      'vip': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      'premium': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
      'free': 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    };
    
    // 尝试匹配关键词
    const lowerGroup = groupName.toLowerCase();
    if (lowerGroup.includes('vip')) return colors.vip;
    if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return colors.premium;
    if (lowerGroup.includes('free')) return colors.free;
    
    // 默认颜色
    return colors.default;
  };

  // 获取分组的文字颜色（用户分组选择器使用，仅文字颜色）
  const getGroupTextColor = (groupName: string): string => {
    // 尝试匹配关键词
    const lowerGroup = groupName.toLowerCase();
    if (lowerGroup.includes('vip')) return 'text-purple-400';
    if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return 'text-yellow-400';
    if (lowerGroup.includes('free') || lowerGroup.includes('公益')) return 'text-gray-400';
    if (lowerGroup.includes('default') || lowerGroup.includes('默认')) return 'text-blue-400';
    if (lowerGroup.includes('translate') || lowerGroup.includes('翻译')) return 'text-cyan-400';
    
    // 为其他分组根据首字母hash动态生成颜色
    const charCode = groupName.charCodeAt(0);
    const colorIndex = charCode % 6;
    const dynamicColors = [
      'text-green-400',
      'text-orange-400',
      'text-teal-400',
      'text-pink-400',
      'text-indigo-400',
      'text-rose-400'
    ];
    
    return dynamicColors[colorIndex];
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

  // 获取分组对应的图标
  // inheritColor: 是否继承父元素颜色（用于用户分组选择器）
  const getGroupIcon = (groupName: string, inheritColor: boolean = false) => {
    const lowerGroup = groupName.toLowerCase();
    
    // 如果继承颜色，图标使用 currentColor（继承父元素的文字颜色）
    if (inheritColor) {
      if (lowerGroup.includes('vip')) return <Crown className="w-3 h-3" />;
      if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return <Star className="w-3 h-3" />;
      if (lowerGroup.includes('free') || lowerGroup.includes('公益')) return <Users className="w-3 h-3" />;
      if (lowerGroup.includes('default') || lowerGroup.includes('默认')) return <Server className="w-3 h-3" />;
      if (lowerGroup.includes('translate') || lowerGroup.includes('翻译')) return <RefreshCw className="w-3 h-3" />;
      
      // 根据首字母hash分配不同图标（无颜色）
      const charCode = groupName.charCodeAt(0);
      const iconIndex = charCode % 5;
      const icons = [
        <Zap className="w-3 h-3" />,
        <DollarSign className="w-3 h-3" />,
        <CheckCircle className="w-3 h-3" />,
        <Gift className="w-3 h-3" />,
        <Play className="w-3 h-3" />
      ];
      return icons[iconIndex];
    }
    
    // API Key和模型卡片使用固定颜色的图标
    if (lowerGroup.includes('vip')) return <Crown className="w-3 h-3 text-yellow-400" />;
    if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return <Star className="w-3 h-3 text-purple-400" />;
    if (lowerGroup.includes('free') || lowerGroup.includes('公益')) return <Users className="w-3 h-3 text-blue-400" />;
    if (lowerGroup.includes('default') || lowerGroup.includes('默认')) return <Server className="w-3 h-3 text-gray-400" />;
    if (lowerGroup.includes('translate') || lowerGroup.includes('翻译')) return <RefreshCw className="w-3 h-3 text-cyan-400" />;
    
    // 根据首字母hash分配不同图标（带颜色）
    const charCode = groupName.charCodeAt(0);
    const iconIndex = charCode % 5;
    const icons = [
      <Zap className="w-3 h-3 text-green-400" />,
      <DollarSign className="w-3 h-3 text-orange-400" />,
      <CheckCircle className="w-3 h-3 text-teal-400" />,
      <Gift className="w-3 h-3 text-pink-400" />,
      <Play className="w-3 h-3 text-indigo-400" />
    ];
    return icons[iconIndex];
  };

  // 获取计费模式图标和文本
  const getQuotaTypeInfo = (quotaType: number): { icon: JSX.Element; text: string; color: string } => {
    if (quotaType === 1) {
      return {
        icon: <span className="text-xs font-bold text-orange-800 dark:text-orange-200">次</span>,
        text: '按次',
        color: 'bg-orange-500/20 text-orange-300 border-orange-500/30'
      };
    }
    return {
      icon: <span className="text-xs font-bold text-blue-800 dark:text-blue-200">量</span>,
      text: '按量',
      color: 'bg-blue-500/20 text-blue-300 border-blue-500/30'
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
    <div className="h-screen flex flex-col bg-light-bg dark:bg-dark-bg text-light-text dark:text-dark-text relative overflow-hidden">
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

      <div className="flex-1 overflow-hidden flex">
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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {config.sites.length === 0 ? (
              <div className="text-center py-16 text-light-text-secondary dark:text-dark-text-secondary">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-30" strokeWidth={1.5} />
                <p className="text-lg font-medium mb-2">还没有添加任何站点</p>
                <p className="text-sm">点击"添加站点"按钮开始</p>
              </div>
            ) : (
              config.sites.map((site, index) => {
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
                const showToken = showTokens[site.name] || false;
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
                
                // 计算最后更新时间显示（格式：月/日 时:分）
                let lastSyncDisplay: string | null = null;
                if (siteAccount?.last_sync_time) {
                  const dt = new Date(siteAccount.last_sync_time);
                  const month = String(dt.getMonth() + 1).padStart(2, '0');
                  const day = String(dt.getDate()).padStart(2, '0');
                  const hour = String(dt.getHours()).padStart(2, '0');
                  const minute = String(dt.getMinutes()).padStart(2, '0');
                  lastSyncDisplay = `${month}/${day} ${hour}:${minute}`;
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
                    
                    {/* 一级信息 - 紧凑卡片布局 */}
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        {/* 左侧：站点名称和状态图标 */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <button
                            onClick={() => openCheckinPage(site)}
                            className="flex items-center gap-1.5 hover:text-primary-400 transition-colors group min-w-0"
                            title={`打开 ${site.name}`}
                          >
                            {site.enabled ? (
                              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            )}
                            <span className="font-bold text-base truncate max-w-[150px]">
                              {site.name}
                            </span>
                          </button>
                          
                          {/* 关键指标展示 */}
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            {/* 网站状态 - 仅显示图标 */}
                            <div className="flex items-center">
                              {siteResult ? (
                                siteResult.status === "成功" ? (
                                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="在线" />
                                ) : (
                                  <div className="w-2 h-2 rounded-full bg-red-500" title="离线" />
                                )
                              ) : (
                                <div className="w-2 h-2 rounded-full bg-gray-500" title="未检测" />
                              )}
                            </div>
                            
                            {/* 余额/消费 - 合并显示 */}
                            <div className="flex items-center gap-1">
                              {siteResult && siteResult.balance !== undefined && siteResult.balance !== null ? (
                                siteResult.balance === -1 ? (
                                  <span className="text-xs">
                                    <span className="text-purple-600 dark:text-purple-400 font-bold">∞</span>
                                    <span className="text-slate-400 dark:text-slate-500">/</span>
                                    <span className="text-orange-600 dark:text-orange-400 font-bold">$-{siteResult?.todayUsage?.toFixed(2) || '0.00'}</span>
                                  </span>
                                ) : (
                                  <span className="text-xs">
                                    <span className="text-green-600 dark:text-green-400 font-bold">${siteResult.balance.toFixed(2)}</span>
                                    <span className="text-slate-400 dark:text-slate-500">/</span>
                                    <span className="text-orange-600 dark:text-orange-400 font-bold">$-{siteResult?.todayUsage?.toFixed(2) || '0.00'}</span>
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500 text-xs">--/--</span>
                              )}
                            </div>
                            
                            {/* 可用模型数 - 文字显示 */}
                            <div className="flex items-center gap-1">
                              <span className="text-slate-500 dark:text-slate-400 text-xs">模型:</span>
                              <span className={`font-semibold text-xs ${
                                (() => {
                                  // 优先使用定价数据中的模型数量
                                  const key = siteResult?.name || site.name;
                                  const pricing = modelPricing[key];
                                  const apiModelCount = siteResult?.models?.length || 0;
                                  const pricingModelCount = pricing?.data ? Object.keys(pricing.data).length : 0;
                                  const actualCount = Math.max(apiModelCount, pricingModelCount);
                                  return actualCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500';
                                })()
                              }`}>
                                {(() => {
                                  // 优先使用定价数据中的模型数量
                                  const key = siteResult?.name || site.name;
                                  const pricing = modelPricing[key];
                                  const apiModelCount = siteResult?.models?.length || 0;
                                  const pricingModelCount = pricing?.data ? Object.keys(pricing.data).length : 0;
                                  return Math.max(apiModelCount, pricingModelCount);
                                })()}
                              </span>
                            </div>
                            
                            {/* 最后更新时间 + 错误码 / Timeout */}
                            {lastSyncDisplay && (
                              <div className="flex items-center gap-1">
                                <span className="text-slate-500 dark:text-slate-400 text-xs">
                                  更新: {lastSyncDisplay}
                                </span>
                                {errorCode && (
                                  <span className="text-red-500 dark:text-red-400 text-xs font-bold">
                                    Error Code: {errorCode}
                                  </span>
                                )}
                                {!errorCode && timeoutSeconds !== null && (
                                  <span className="text-red-500 dark:text-red-400 text-xs font-bold">
                                    Timeout {timeoutSeconds}s
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* 右侧：操作按钮组 */}
                        <div className="flex items-center gap-1">
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
                      <div className="border-t border-slate-200/50 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-900/60 px-3 py-1.5 space-y-1">
                        {/* URL */}
                        <div className="flex items-center justify-between py-0">
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">URL</span>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-slate-700 dark:text-slate-300 font-mono max-w-xs truncate">{site.url}</span>
                            <button
                              onClick={() => copyToClipboard(site.url, 'URL')}
                              className="p-0.5 hover:bg-white/10 rounded transition-all"
                              title="复制"
                            >
                              <Copy className="w-2.5 h-2.5 text-gray-400" />
                            </button>
                          </div>
                        </div>
                        
                        {/* Access Token */}
                        {site.system_token && (
                          <div className="flex items-center justify-between py-0">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Token</span>
                            <div className="flex items-center gap-0.5">
                              <span className="text-xs text-primary-600 dark:text-primary-400 font-mono">
                                {maskToken(site.system_token, showToken)}
                              </span>
                              <button
                                onClick={() => toggleTokenVisibility(site.name)}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title={showToken ? "隐藏" : "显示"}
                              >
                                {showToken ? (
                                  <EyeOff className="w-2.5 h-2.5 text-gray-400" />
                                ) : (
                                  <Eye className="w-2.5 h-2.5 text-gray-400" />
                                )}
                              </button>
                              <button
                                onClick={() => copyToClipboard(site.system_token!, 'Token')}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title="复制"
                              >
                                <Copy className="w-2.5 h-2.5 text-gray-400" />
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* API Key */}
                        {site.api_key && (
                          <div className="flex items-center justify-between py-0">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Key</span>
                            <div className="flex items-center gap-0.5">
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-mono">
                                {maskToken(site.api_key, showToken)}
                              </span>
                              <button
                                onClick={() => copyToClipboard(site.api_key, 'Key')}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title="复制"
                              >
                                <Copy className="w-2.5 h-2.5 text-gray-400" />
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* 用户分组 */}
                        {(() => {
                          const key = siteResult?.name || site.name;
                          return userGroups[key] && Object.keys(userGroups[key]).length > 0;
                        })() && (
                          <div className="flex items-center gap-1 flex-wrap py-0">
                            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">分组</span>
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
                        
                        {/* API Keys列表 */}
                        {(() => {
                          const key = siteResult?.name || site.name;
                          return apiKeys[key] && apiKeys[key].length > 0;
                        })() && (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                                {(() => {
                                  const key = siteResult?.name || site.name;
                                  return `Keys (${getFilteredApiKeys(key).length}/${apiKeys[key].length})`;
                                })()}
                                {selectedGroup[site.name] && (
                                  <span className="ml-1 text-primary-400">· {selectedGroup[site.name]}</span>
                                )}
                              </span>
                            </div>
                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                              {getFilteredApiKeys(siteResult?.name || site.name).map((key: any, idx: number) => {
                                const quotaInfo = key.unlimited_quota ? null : getQuotaTypeInfo(key.type || 0);
                                return (
                                  <div
                                    key={idx}
                                    className="px-1.5 py-0.5 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700 transition-all flex items-center justify-between gap-1"
                                  >
                                    {/* 左侧：名称+标签 */}
                                    <div className="flex items-center gap-0.5 min-w-0 flex-1">
                                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                                        {key.name || `Key #${idx + 1}`}
                                      </span>
                                      {key.group && key.group.trim() && (
                                        <span className={`px-1.5 py-0.5 text-xs rounded border flex items-center gap-0.5 flex-shrink-0 ${getGroupColor(key.group)}`}>
                                          {getGroupIcon(key.group, false)}
                                          <span className="font-medium">{key.group}</span>
                                        </span>
                                      )}
                                      {quotaInfo && (
                                        <span className={`p-0.5 text-xs rounded border flex items-center flex-shrink-0 ${quotaInfo.color}`} title={quotaInfo.text}>
                                          {quotaInfo.icon}
                                        </span>
                                      )}
                                      {key.unlimited_quota && (
                                        <span className="px-1 py-0.5 text-xs rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 flex-shrink-0">
                                          ∞
                                        </span>
                                      )}
                                      <span className={`p-0.5 text-xs rounded flex-shrink-0 ${
                                        key.status === 1
                                          ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                                          : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                      }`}>
                                        {key.status === 1 ? '✓' : '✕'}
                                      </span>
                                    </div>
                                    
                                    {/* 中间：令牌+数据 */}
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="font-mono text-blue-600 dark:text-blue-400">
                                        {maskToken(addSkPrefix(key.key), showTokens[`${site.name}_key_${idx}`] || false)}
                                      </span>
                                      {!key.unlimited_quota && key.remain_quota !== undefined && (
                                        <span className="text-slate-500 dark:text-slate-400">
                                          余<span className={key.remain_quota > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                            ${(key.remain_quota / 500000).toFixed(2)}
                                          </span>
                                        </span>
                                      )}
                                      {key.used_quota !== undefined && (
                                        <span className="text-slate-500 dark:text-slate-400">
                                          用<span className="text-orange-600 dark:text-orange-400">${(key.used_quota / 500000).toFixed(2)}</span>
                                        </span>
                                      )}
                                    </div>
                                    
                                    {/* 右侧：操作按钮 */}
                                    <div className="flex items-center gap-0.5 flex-shrink-0">
                                      <button
                                        onClick={() => toggleTokenVisibility(`${site.name}_key_${idx}`)}
                                        className="p-0.5 hover:bg-white/10 rounded transition-all"
                                        title={showTokens[`${site.name}_key_${idx}`] ? "隐藏" : "显示"}
                                      >
                                        {showTokens[`${site.name}_key_${idx}`] ? (
                                          <EyeOff className="w-3 h-3 text-gray-400" />
                                        ) : (
                                          <Eye className="w-3 h-3 text-gray-400" />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => copyToClipboard(addSkPrefix(key.key), `API Key: ${key.name}`)}
                                        className="p-0.5 hover:bg-white/10 rounded transition-all"
                                        title="复制"
                                      >
                                        <Copy className="w-3 h-3 text-gray-400" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        
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
                                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                                    模型 ({getFilteredModels(site.name, allModels).length}/{allModels.length})
                                    {selectedModels.size > 0 && (
                                      <span className="ml-1 text-primary-400">· 已选{selectedModels.size}</span>
                                    )}
                                    {selectedGroup[site.name] && (
                                      <span className="ml-1 text-primary-400">· {selectedGroup[site.name]}</span>
                                    )}
                                  </span>
                                {/* 搜索框 */}
                                <input
                                  type="text"
                                  placeholder="搜索..."
                                  value={modelSearch[site.name] || ''}
                                  onChange={(e) => setModelSearch(prev => ({ ...prev, [site.name]: e.target.value }))}
                                  className="px-1.5 py-0.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-primary-400 transition-colors w-20"
                                />
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
                                                className={`p-0.5 rounded ${getGroupColor(group)}`}
                                                title={group}
                                              >
                                                {getGroupIcon(group, false)}
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
                        {siteResult && siteResult.error && (
                          <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <p className="text-xs text-red-400">❌ {siteResult.error}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      </div>
      {/* 关闭 relative z-10 h-full flex flex-col 的 div */}

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
    </div>
  );
}

export default App;
