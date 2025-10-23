import { useEffect, useState } from "react";
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
  Hash,
} from "lucide-react";
import { SiteEditor } from "./components/SiteEditor";
import { SettingsPanel } from "./components/SettingsPanel";
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
  has_checkin: boolean;
  // 新增：缓存的扩展数据
  apiKeys?: any[];
  userGroups?: Record<string, { desc: string; ratio: number }>;
  modelPricing?: any;
}

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectingSite, setDetectingSite] = useState<string | null>(null);
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [showSiteEditor, setShowSiteEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
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

  // 获取分组的颜色样式
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

  // 获取分组对应的图标（API Key分组显示）
  const getGroupIcon = (groupName: string, isApiKeyGroup: boolean = false) => {
    const lowerGroup = groupName.toLowerCase();
    
    // API Key分组使用不同的图标集（带颜色）
    if (isApiKeyGroup) {
      if (lowerGroup.includes('vip')) return <Crown className="w-3 h-3 text-yellow-400" />;
      if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return <Star className="w-3 h-3 text-purple-400" />;
      if (lowerGroup.includes('free') || lowerGroup.includes('公益')) return <Users className="w-3 h-3 text-blue-400" />;
      if (lowerGroup.includes('default') || lowerGroup.includes('默认')) return <Hash className="w-3 h-3 text-gray-400" />;
      if (lowerGroup.includes('translate') || lowerGroup.includes('翻译')) return <RefreshCw className="w-3 h-3 text-cyan-400" />;
      return <Zap className="w-3 h-3 text-green-400" />; // 默认图标
    }
    
    // 普通分组图标（用于选择器和模型）- 为每个分组分配不同图标
    if (lowerGroup.includes('vip')) return <Crown className="w-3 h-3 text-yellow-500" />;
    if (lowerGroup.includes('premium') || lowerGroup.includes('pro')) return <Star className="w-3 h-3 text-purple-500" />;
    if (lowerGroup.includes('free') || lowerGroup.includes('公益')) return <Users className="w-3 h-3 text-blue-500" />;
    if (lowerGroup.includes('default') || lowerGroup.includes('默认')) return <Server className="w-3 h-3 text-gray-500" />;
    if (lowerGroup.includes('translate') || lowerGroup.includes('翻译')) return <RefreshCw className="w-3 h-3 text-cyan-500" />;
    
    // 根据首字母hash分配不同图标
    const charCode = groupName.charCodeAt(0);
    const iconIndex = charCode % 5;
    const icons = [
      <Zap className="w-3 h-3 text-green-500" />,
      <DollarSign className="w-3 h-3 text-orange-500" />,
      <CheckCircle className="w-3 h-3 text-teal-500" />,
      <Gift className="w-3 h-3 text-pink-500" />,
      <Play className="w-3 h-3 text-indigo-500" />
    ];
    return icons[iconIndex];
  };

  // 获取计费模式图标和文本
  const getQuotaTypeInfo = (quotaType: number): { icon: JSX.Element; text: string; color: string } => {
    if (quotaType === 1) {
      return {
        icon: <Hash className="w-3 h-3" />,
        text: '按次',
        color: 'bg-orange-500/20 text-orange-300 border-orange-500/30'
      };
    }
    return {
      icon: <DollarSign className="w-3 h-3" />,
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
        const modelData = pricing[modelName];
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
      await loadConfig();
      await loadCachedData();
    };
    init();
  }, []);

  // 当expandedSite改变时，确保UI能正确显示
  useEffect(() => {
    console.log('📊 [App] State更新:');
    console.log('   - apiKeys:', Object.keys(apiKeys).length, '个站点的数据');
    console.log('   - expandedSite:', expandedSite);
    if (expandedSite && apiKeys[expandedSite]) {
      console.log('   - 当前展开站点的apiKeys:', apiKeys[expandedSite].length, '个');
    }
  }, [apiKeys, expandedSite]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const cfg = await window.electronAPI.loadConfig();
      setConfig(cfg);
    } catch (error) {
      console.error("加载配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 启动时加载缓存的显示数据
   */
  const loadCachedData = async () => {
    try {
      console.log('📂 [App] 加载缓存的显示数据...');
      const accounts = await window.electronAPI.getAllAccounts();
      
      console.log('📊 [App] 从token-storage.json获取到账号数据:', accounts?.length || 0);
      
      if (accounts && accounts.length > 0) {
        // 构建站点账号映射表（用于显示最后更新时间）
        const accountsMap: Record<string, any> = {};
        accounts.forEach((account: any) => {
          // 使用URL作为key而非站点名（更准确）
          const urlKey = new URL(account.site_url).origin;
          accountsMap[urlKey] = account;
          // 同时保存站点名作为key（兼容）
          accountsMap[account.site_name] = account;
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
            const result = {
              name: account.site_name,
              url: account.site_url,
              status: '成功',
              models: account.cached_display_data?.models || [],
              balance: account.cached_display_data?.quota !== undefined 
                ? (account.cached_display_data.quota > 1000 
                    ? account.cached_display_data.quota / 500000 
                    : account.cached_display_data.quota)
                : undefined,
              todayUsage: account.cached_display_data?.today_quota_consumption !== undefined
                ? (account.cached_display_data.today_quota_consumption > 1000
                    ? account.cached_display_data.today_quota_consumption / 500000
                    : account.cached_display_data.today_quota_consumption)
                : undefined,
              has_checkin: account.cached_display_data?.can_check_in || false,
              apiKeys: account.cached_display_data?.apiKeys,
              userGroups: account.cached_display_data?.userGroups,
              modelPricing: account.cached_display_data?.modelPricing
            };
            console.log(`   → 转换 ${account.site_name}:`, {
              models: result.models?.length,
              balance: result.balance,
              apiKeys: result.apiKeys?.length
            });
            return result;
          });
        
        console.log(`✅ [App] 加载了 ${cachedResults.length} 个站点的缓存数据`);
        setResults(cachedResults);
      } else {
        console.log('ℹ️ [App] token-storage.json中没有账号数据');
      }
    } catch (error) {
      console.error('❌ [App] 加载缓存数据失败:', error);
    }
  };

  const saveConfig = async (newConfig: Config) => {
    try {
      await window.electronAPI.saveConfig(newConfig);
      setConfig(newConfig);
    } catch (error) {
      console.error("保存配置失败:", error);
      alert("保存配置失败: " + error);
    }
  };

  const addSite = (site: SiteConfig) => {
    if (!config) return;
    saveConfig({ ...config, sites: [...config.sites, site] });
  };

  const updateSite = (index: number, site: SiteConfig) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = site;
    saveConfig({ ...config, sites: newSites });
  };

  const deleteSite = (index: number) => {
    if (!config) return;
    if (!confirm("确定要删除这个站点吗？")) return;
    const newSites = config.sites.filter((_, i) => i !== index);
    saveConfig({ ...config, sites: newSites });
  };

  const toggleSite = (index: number) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = { ...newSites[index], enabled: !newSites[index].enabled };
    saveConfig({ ...config, sites: newSites });
  };

  const detectAllSites = async () => {
    if (!config) return;
    setDetecting(true);
    setResults([]);
    try {
      const results = await window.electronAPI.detectAllSites(config);
      setResults(results);
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
      // 快速刷新模式：传递现有的缓存数据
      const cachedResult = quickRefresh ? results.find(r => r.name === site.name) : undefined;
      
      const result = await window.electronAPI.detectSite(
        site,
        config.settings.timeout,
        quickRefresh,
        cachedResult
      );
      
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
      
      // 如果当前展开的是这个站点，立即更新缓存
      if (expandedSite === site.name && result) {
        if (result.apiKeys) {
          setApiKeys(prev => ({ ...prev, [site.name]: result.apiKeys! }));
        }
        if (result.userGroups) {
          setUserGroups(prev => ({ ...prev, [site.name]: result.userGroups! }));
        }
        if (result.modelPricing) {
          setModelPricing(prev => ({ ...prev, [site.name]: result.modelPricing! }));
        }
      }
    } catch (error) {
      console.error("检测失败:", error);
      setRefreshMessage({
        site: site.name,
        message: '❌ 刷新失败: ' + error,
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

  // 当展开站点时从缓存中加载数据（所有数据在检测时已获取）
  const handleExpandSite = (siteName: string) => {
    const newExpanded = expandedSite === siteName ? null : siteName;
    setExpandedSite(newExpanded);
    
    // 如果是展开，从 DetectionResult 缓存中加载数据
    if (newExpanded) {
      console.log('🔍 [App] 展开站点:', siteName);
      console.log('📋 [App] results数组:', results.map(r => r.name));
      console.log('📋 [App] results完整:', results);
      const siteResult = results.find(r => r.name === siteName);
      console.log('📦 [App] 找到的结果:', siteResult ? '有' : '无');
      if (siteResult) {
        console.log('🔑 [App] apiKeys:', siteResult.apiKeys ? `${siteResult.apiKeys.length}个` : '无');
        console.log('👥 [App] userGroups:', siteResult.userGroups ? Object.keys(siteResult.userGroups).length + '个' : '无');
        console.log('💰 [App] modelPricing:', siteResult.modelPricing ? '有' : '无');
        
        // 从缓存加载 API Keys（总是更新，确保数据最新）
        if (siteResult.apiKeys) {
          console.log('✅ [App] 设置apiKeys:', siteResult.apiKeys);
          setApiKeys(prev => ({ ...prev, [siteName]: siteResult.apiKeys! }));
        }
        // 从缓存加载用户分组（总是更新）
        if (siteResult.userGroups) {
          console.log('✅ [App] 设置userGroups');
          setUserGroups(prev => ({ ...prev, [siteName]: siteResult.userGroups! }));
        }
        // 从缓存加载模型定价（总是更新）
        if (siteResult.modelPricing) {
          console.log('✅ [App] 设置modelPricing');
          setModelPricing(prev => ({ ...prev, [siteName]: siteResult.modelPricing! }));
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-400" />
          <p className="text-gray-300">加载配置中...</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <XCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-gray-300">配置加载失败</p>
          <button
            onClick={loadConfig}
            className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10 px-3 py-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center shadow-lg">
              <span className="text-white text-3xl font-bold tracking-tight">L</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">API Detect Tool (Electron)</h1>
              <p className="text-sm text-gray-400">
                支持自动Cookie获取的API检测工具
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-all flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              设置
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 flex flex-col">
          <div className="px-3 py-1.5 bg-black/10 backdrop-blur-sm border-b border-white/10 flex items-center justify-between">
            <button
              onClick={() => {
                setEditingSite(null);
                setShowSiteEditor(true);
              }}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              添加站点
            </button>
            <button
              onClick={detectAllSites}
              disabled={detecting || !config || config.sites.length === 0}
              className="px-6 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-all flex items-center gap-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {detecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  检测中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  检测所有站点
                </>
              )}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {config.sites.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>还没有添加任何站点</p>
                <p className="text-sm mt-2">点击"添加站点"按钮开始</p>
              </div>
            ) : (
              config.sites.map((site, index) => {
                const siteResult = results.find(r => r.name === site.name);
                const isExpanded = expandedSite === site.name;
                const showToken = showTokens[site.name] || false;
                const siteAccount = siteAccounts[site.name];  // 获取站点账号信息
                
                return (
                  <div
                    key={index}
                    className={`bg-gradient-to-br from-white/5 to-white/10 backdrop-blur-sm rounded-xl border transition-all shadow-lg ${
                      site.enabled ? "border-white/30 hover:border-primary-400/50" : "border-white/10 opacity-60"
                    }`}
                  >
                    {/* 刷新提示消息 */}
                    {refreshMessage && refreshMessage.site === site.name && (
                      <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        refreshMessage.type === 'success'
                          ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {refreshMessage.message}
                      </div>
                    )}
                    
                    {/* 一级信息 - 紧凑卡片布局 */}
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between">
                        {/* 左侧：站点名称和状态图标 */}
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            onClick={() => openCheckinPage(site)}
                            className="flex items-center gap-2 hover:text-primary-400 transition-colors group min-w-0"
                            title={`打开 ${site.name}`}
                          >
                            {site.enabled ? (
                              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-5 h-5 text-gray-500 flex-shrink-0" />
                            )}
                            <span className="font-bold text-lg truncate max-w-[180px]">
                              {site.name}
                            </span>
                          </button>
                          
                          {/* 关键指标展示 */}
                          <div className="flex items-center gap-4 text-sm flex-wrap">
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
                                    <span className="text-purple-400 font-semibold">∞</span>
                                    <span className="text-gray-400">/</span>
                                    <span className="text-orange-400 font-semibold">$-{siteResult?.todayUsage?.toFixed(2) || '0.00'}</span>
                                  </span>
                                ) : (
                                  <span className="text-xs">
                                    <span className="text-green-400 font-semibold">${siteResult.balance.toFixed(2)}</span>
                                    <span className="text-gray-400">/</span>
                                    <span className="text-orange-400 font-semibold">$-{siteResult?.todayUsage?.toFixed(2) || '0.00'}</span>
                                  </span>
                                )
                              ) : (
                                <span className="text-gray-500 text-xs">--/--</span>
                              )}
                            </div>
                            
                            {/* 可用模型数 - 文字显示 */}
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400 text-xs">模型:</span>
                              <span className={`font-semibold text-xs ${
                                siteResult && siteResult.models.length > 0 ? 'text-blue-400' : 'text-gray-500'
                              }`}>
                                {siteResult?.models.length || 0}
                              </span>
                            </div>
                            
                            {/* 最后更新时间 */}
                            {siteAccount?.last_sync_time && (
                              <div className="flex items-center gap-1">
                                <span className="text-gray-500 text-xs">
                                  更新: {new Date(siteAccount.last_sync_time).toLocaleTimeString('zh-CN', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* 右侧：操作按钮组 */}
                        <div className="flex items-center gap-1">
                          {/* 签到状态显示 */}
                          {siteResult?.has_checkin && (
                            <div className="mr-2 flex items-center gap-1" title={siteAccount?.cached_display_data?.can_check_in ? "今日可签到" : "今日已签到"}>
                              <Gift className={`w-4 h-4 ${siteAccount?.cached_display_data?.can_check_in ? 'text-yellow-400 animate-pulse' : 'text-gray-500'}`} />
                              {siteAccount?.cached_display_data?.can_check_in && (
                                <span className="text-xs text-yellow-400">可签</span>
                              )}
                            </div>
                          )}
                          
                          {/* 展开/收起按钮 */}
                          <button
                            onClick={() => handleExpandSite(site.name)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            title={isExpanded ? "收起详情" : "展开详情"}
                          >
                            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                          
                          <button
                            onClick={() => detectSingle(site)}
                            disabled={detectingSite === site.name}
                            className="p-2 hover:bg-primary-500/20 rounded-lg transition-all disabled:opacity-50"
                            title="刷新检测"
                          >
                            <RefreshCw className={`w-4 h-4 ${detectingSite === site.name ? 'animate-spin' : ''}`} />
                          </button>
                          
                          <button
                            onClick={() => toggleSite(index)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            title={site.enabled ? "禁用站点" : "启用站点"}
                          >
                            <CheckCircle className={`w-4 h-4 ${site.enabled ? "text-green-500" : "text-gray-500"}`} />
                          </button>
                          
                          <button
                            onClick={() => { setEditingSite(index); setShowSiteEditor(true); }}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            title="编辑站点"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          
                          <button
                            onClick={() => deleteSite(index)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-all"
                            title="删除站点"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* 二级展开面板 */}
                    {isExpanded && (
                      <div className="border-t border-white/10 bg-black/20 px-3 py-2 space-y-2">
                        {/* URL */}
                        <div className="flex items-center justify-between py-1">
                          <span className="text-xs text-gray-500">URL</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-300 font-mono max-w-xs truncate">{site.url}</span>
                            <button
                              onClick={() => copyToClipboard(site.url, 'URL')}
                              className="p-0.5 hover:bg-white/10 rounded transition-all"
                              title="复制"
                            >
                              <Copy className="w-3 h-3 text-gray-400" />
                            </button>
                          </div>
                        </div>
                        
                        {/* Access Token */}
                        {site.system_token && (
                          <div className="flex items-center justify-between py-1">
                            <span className="text-xs text-gray-500">Token</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-primary-400 font-mono">
                                {maskToken(site.system_token, showToken)}
                              </span>
                              <button
                                onClick={() => toggleTokenVisibility(site.name)}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title={showToken ? "隐藏" : "显示"}
                              >
                                {showToken ? (
                                  <EyeOff className="w-3 h-3 text-gray-400" />
                                ) : (
                                  <Eye className="w-3 h-3 text-gray-400" />
                                )}
                              </button>
                              <button
                                onClick={() => copyToClipboard(site.system_token!, 'Token')}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title="复制"
                              >
                                <Copy className="w-3 h-3 text-gray-400" />
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* API Key */}
                        {site.api_key && (
                          <div className="flex items-center justify-between py-1">
                            <span className="text-xs text-gray-500">Key</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-blue-400 font-mono">
                                {maskToken(site.api_key, showToken)}
                              </span>
                              <button
                                onClick={() => copyToClipboard(site.api_key, 'Key')}
                                className="p-0.5 hover:bg-white/10 rounded transition-all"
                                title="复制"
                              >
                                <Copy className="w-3 h-3 text-gray-400" />
                              </button>
                            </div>
                          </div>
                        )}
                        
                        {/* 用户分组卡片 */}
                        {userGroups[site.name] && Object.keys(userGroups[site.name]).length > 0 && (
                          <div className="px-3 py-2 bg-black/20 rounded-lg border border-white/5">
                            <div className="text-xs text-gray-400 font-medium mb-2">用户分组</div>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(userGroups[site.name]).map(([groupName, groupData]: [string, any]) => (
                                <button
                                  key={groupName}
                                  onClick={() => toggleGroupFilter(site.name, groupName)}
                                  className={`px-2 py-1 rounded text-xs font-medium border transition-all flex items-center gap-1 ${
                                    selectedGroup[site.name] === groupName
                                      ? 'bg-primary-600 border-primary-400 text-white shadow-lg'
                                      : `${getGroupColor(groupName)} hover:opacity-80`
                                  }`}
                                  title={`${groupData.desc} (倍率: ${groupData.ratio})`}
                                >
                                  {getGroupIcon(groupName, false)}
                                  <span className="font-semibold">{groupName}</span>
                                  <span className="opacity-90">×{groupData.ratio}</span>
                                </button>
                              ))}
                              {selectedGroup[site.name] && (
                                <button
                                  onClick={() => toggleGroupFilter(site.name, null)}
                                  className="px-2 py-1 rounded text-xs font-medium border border-red-500/30 bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all"
                                >
                                  清除筛选
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* API Keys列表 */}
                        {apiKeys[site.name] && apiKeys[site.name].length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 font-medium">
                                API Keys ({getFilteredApiKeys(site.name).length}/{apiKeys[site.name].length})
                                {selectedGroup[site.name] && (
                                  <span className="ml-1 text-primary-400">· {selectedGroup[site.name]}</span>
                                )}
                              </span>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {getFilteredApiKeys(site.name).map((key: any, idx: number) => {
                                const quotaInfo = key.unlimited_quota ? null : getQuotaTypeInfo(key.type || 0);
                                return (
                                  <div
                                    key={idx}
                                    className="px-2 py-1 bg-black/30 rounded-md border border-white/5 hover:border-white/10 transition-all flex items-center justify-between gap-2"
                                  >
                                    {/* 左侧：名称+标签 */}
                                    <div className="flex items-center gap-1 min-w-0 flex-1">
                                      <span className="text-xs font-semibold text-white truncate">
                                        {key.name || `Key #${idx + 1}`}
                                      </span>
                                      {key.group && key.group.trim() && (
                                        <span className={`px-1.5 py-0.5 text-xs rounded border flex items-center gap-0.5 flex-shrink-0 ${getGroupColor(key.group)}`}>
                                          {getGroupIcon(key.group, true)}
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
                                      <span className="font-mono text-blue-300">
                                        {maskToken(addSkPrefix(key.key), showTokens[`${site.name}_key_${idx}`] || false)}
                                      </span>
                                      {!key.unlimited_quota && key.remain_quota !== undefined && (
                                        <span className="text-gray-400">
                                          余<span className={key.remain_quota > 0 ? 'text-green-400' : 'text-red-400'}>
                                            ${(key.remain_quota / 500000).toFixed(2)}
                                          </span>
                                        </span>
                                      )}
                                      {key.used_quota !== undefined && (
                                        <span className="text-gray-400">
                                          用<span className="text-orange-400">${(key.used_quota / 500000).toFixed(2)}</span>
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
                        {siteResult && siteResult.models.length > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 flex-1">
                                <span className="text-xs text-gray-400 font-medium whitespace-nowrap">
                                  模型 ({getFilteredModels(site.name, siteResult.models).length}/{siteResult.models.length})
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
                                  placeholder="搜索模型..."
                                  value={modelSearch[site.name] || ''}
                                  onChange={(e) => setModelSearch(prev => ({ ...prev, [site.name]: e.target.value }))}
                                  className="px-2 py-0.5 text-xs bg-black/30 border border-white/10 rounded text-white placeholder-gray-500 focus:outline-none focus:border-primary-400 transition-colors"
                                />
                              </div>
                              {selectedModels.size > 0 && (
                                <button
                                  onClick={copySelectedModels}
                                  className="px-2 py-0.5 bg-primary-600 hover:bg-primary-700 rounded text-xs flex items-center gap-1 whitespace-nowrap"
                                >
                                  <Copy className="w-3 h-3" />
                                  复制
                                </button>
                              )}
                            </div>
                            <div className="max-h-40 overflow-y-auto p-1 bg-black/30 rounded-md">
                              <div className="flex flex-wrap gap-1">
                                {getFilteredModels(site.name, siteResult.models).map((model, idx) => {
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
                                  
                                  const quotaType = pricingData?.quota_type || pricingData?.type || 0;
                                  const quotaInfo = getQuotaTypeInfo(quotaType);
                                  
                                  // 提取价格信息
                                  const inputPrice = pricingData?.input || pricingData?.model_price || pricingData?.prompt;
                                  const outputPrice = pricingData?.output || pricingData?.completion;
                                  const completionRatio = pricingData?.completion_ratio || 1;
                                  const enableGroups = pricingData?.enable_groups || [];
                                  
                                  return (
                                    <button
                                      key={idx}
                                      onClick={() => toggleModelSelection(model)}
                                      className={`px-2 py-1 rounded-md border transition-all flex flex-col items-start gap-0.5 ${
                                        selectedModels.has(model)
                                          ? "bg-primary-600/30 border-primary-400"
                                          : "bg-white/5 border-white/10 hover:bg-white/10"
                                      }`}
                                      title={model}
                                    >
                                      {/* 第一行：模型名称 */}
                                      <div className="flex items-center gap-1 w-full">
                                        <span className="text-xs font-mono text-white truncate flex-1">
                                          {model}
                                        </span>
                                      </div>
                                      
                                      {/* 第二行：计费类型 + 用户分组图标 + 价格 */}
                                      <div className="flex items-center gap-1 text-xs w-full">
                                        {/* 计费类型图标 */}
                                        {quotaInfo && (
                                          <span className={`p-0.5 rounded border ${quotaInfo.color}`} title={quotaInfo.text}>
                                            {quotaInfo.icon}
                                          </span>
                                        )}
                                        
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
                                        
                                        {/* 价格信息 */}
                                        {(inputPrice !== undefined || outputPrice !== undefined) && (
                                          <>
                                            {inputPrice !== undefined && (
                                              <span className="text-green-400" title="输入价格(/1K tokens)">
                                                ↑${(inputPrice * 1000).toFixed(3)}
                                              </span>
                                            )}
                                            {outputPrice !== undefined && (
                                              <span className="text-orange-400" title={`输出价格(/1K tokens) ×${completionRatio}`}>
                                                ↓${(outputPrice * 1000).toFixed(3)}
                                              </span>
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
                        )}
                        
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
          onSave={(settings) => {
            saveConfig({ ...config, settings });
            setShowSettings(false);
          }}
          onCancel={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;