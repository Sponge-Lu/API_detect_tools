import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
} from "lucide-react";
import { SiteEditor } from "./components/SiteEditor";
import { SettingsPanel } from "./components/SettingsPanel";

export interface SiteConfig {
  name: string;
  url: string;
  api_key: string;
  system_token?: string;
  user_id?: string;
  enabled: boolean;
  has_checkin?: boolean;  // 用户自定义是否有签到功能
}

export interface Settings {
  timeout: number;
  concurrent: boolean;
  show_disabled: boolean;
  auto_refresh: boolean;
  refresh_interval: number; // 分钟
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
  error?: string;
  has_checkin: boolean;
}

// CheckinResult已删除，签到改为跳转到站点页面

function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectingSite, setDetectingSite] = useState<string | null>(null); // 正在检测的单个站点
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [showSiteEditor, setShowSiteEditor] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingSite, setEditingSite] = useState<number | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set()); // 选中的模型

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const cfg = await invoke<Config>("load_config");
      setConfig(cfg);
    } catch (error) {
      console.error("加载配置失败:", error);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveConfig = async (newConfig: Config) => {
    try {
      await invoke("save_config", { config: newConfig });
      setConfig(newConfig);
    } catch (error) {
      console.error("保存配置失败:", error);
      alert("保存配置失败: " + error);
    }
  };

  // 添加站点
  const addSite = (site: SiteConfig) => {
    if (!config) return;
    const newConfig = {
      ...config,
      sites: [...config.sites, site],
    };
    saveConfig(newConfig);
  };

  // 更新站点
  const updateSite = (index: number, site: SiteConfig) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = site;
    const newConfig = {
      ...config,
      sites: newSites,
    };
    saveConfig(newConfig);
  };

  // 删除站点
  const deleteSite = (index: number) => {
    if (!config) return;
    if (!confirm("确定要删除这个站点吗？")) return;
    const newSites = config.sites.filter((_, i) => i !== index);
    const newConfig = {
      ...config,
      sites: newSites,
    };
    saveConfig(newConfig);
  };

  // 切换站点启用状态
  const toggleSite = (index: number) => {
    if (!config) return;
    const newSites = [...config.sites];
    newSites[index] = { ...newSites[index], enabled: !newSites[index].enabled };
    const newConfig = {
      ...config,
      sites: newSites,
    };
    saveConfig(newConfig);
  };

  // 检测所有站点
  const detectAllSites = async () => {
    if (!config) return;
    setDetecting(true);
    setResults([]);
    try {
      const results = await invoke<DetectionResult[]>("detect_all_sites", {
        config,
      });
      setResults(results);
    } catch (error) {
      console.error("检测失败:", error);
      alert("检测失败: " + error);
    } finally {
      setDetecting(false);
    }
  };

  // 单独检测某个站点
  const detectSingle = async (site: SiteConfig) => {
    if (!config) return;
    setDetectingSite(site.name);
    try {
      const result = await invoke<DetectionResult>("detect_site", {
        site,
        timeout: config.settings.timeout,
      });
      // 更新results中对应站点的结果
      setResults((prev) => {
        const filtered = prev.filter((r) => r.name !== site.name);
        return [...filtered, result];
      });
    } catch (error) {
      console.error("检测失败:", error);
      alert("检测失败: " + error);
    } finally {
      setDetectingSite(null);
    }
  };

  // 打开签到页面
  const openCheckinPage = async (site: SiteConfig) => {
    try {
      // 使用Tauri的shell插件打开浏览器
      await open(site.url);
    } catch (error) {
      console.error("打开浏览器失败:", error);
      alert("打开浏览器失败: " + error);
    }
  };

  // 切换模型选中状态
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

  // 复制选中的模型
  const copySelectedModels = async () => {
    if (selectedModels.size === 0) {
      alert("请先选择要复制的模型");
      return;
    }
    
    const modelsText = Array.from(selectedModels).join(",");
    try {
      await writeText(modelsText);
      alert(`已复制 ${selectedModels.size} 个模型到剪贴板`);
    } catch (error) {
      console.error("复制失败:", error);
      alert("复制失败: " + error);
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
      {/* 头部 */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10 px-3 py-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Logo图标 - 蓝粉渐变L */}
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-pink-500 flex items-center justify-center shadow-lg">
              <span className="text-white text-3xl font-bold tracking-tight">L</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">API Detect Tool</h1>
              <p className="text-sm text-gray-400">
                检测公益站可用模型和账户余额
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
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

      {/* 主内容区 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 站点列表 */}
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
                <p className="text-sm mt-2">点击右上角"添加站点"按钮开始</p>
              </div>
            ) : (
              config.sites.map((site, index) => {
                const siteResult = results.find(r => r.name === site.name);
                return (
                  <div
                    key={index}
                    className={`bg-white/5 backdrop-blur-sm rounded-lg border transition-all hover:bg-white/10 ${
                      site.enabled
                        ? "border-white/20"
                        : "border-white/10 opacity-60"
                    }`}
                  >
                    <div className="px-2 py-0.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 flex-1">
                          {/* 站点名称和状态图标 */}
                          <div className="flex items-center gap-1">
                            {site.enabled ? (
                              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            )}
                            <button
                              onClick={() => openCheckinPage(site)}
                              className="font-semibold text-base hover:text-primary-400 transition-colors cursor-pointer w-32 text-left truncate"
                              title={site.name}
                            >
                              {site.name}
                            </button>
                          </div>
                          
                          {/* 状态、余额、模型数 - 同一行 */}
                          <div className="flex items-center gap-2 text-sm">
                            {/* 状态 */}
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">状态:</span>
                              {siteResult ? (
                                siteResult.status === "成功" ? (
                                  <span className="text-green-400 font-semibold">✓ 正常</span>
                                ) : (
                                  <span className="text-red-400 font-semibold">✗ 失败</span>
                                )
                              ) : (
                                <span className="text-gray-500">未检测</span>
                              )}
                            </div>
                            
                            {/* 余额 */}
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">余额:</span>
                              {siteResult && siteResult.balance !== undefined && siteResult.balance !== null ? (
                                siteResult.balance === -1 ? (
                                  <span className="text-purple-400 font-semibold" title="无限配额">
                                    ∞ 无限
                                  </span>
                                ) : (
                                  <span className="text-primary-400 font-semibold">
                                    ${siteResult.balance.toFixed(2)}
                                  </span>
                                )
                              ) : siteResult && siteResult.status === "成功" ? (
                                <span className="text-yellow-400 text-xs cursor-help" title="该站点API未开放余额查询">
                                  需登录网页查看
                                </span>
                              ) : (
                                <span className="text-gray-500">--</span>
                              )}
                            </div>
                            
                            {/* 模型数 */}
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">模型:</span>
                              {siteResult && siteResult.models.length > 0 ? (
                                <span className="text-gray-300 font-semibold">
                                  {siteResult.models.length} 个
                                </span>
                              ) : (
                                <span className="text-gray-500">--</span>
                              )}
                            </div>
                            
                            {/* 下拉箭头 */}
                            {siteResult && siteResult.models.length > 0 && (
                              <button
                                onClick={() => setExpandedSite(expandedSite === site.name ? null : site.name)}
                                className="p-1 hover:bg-white/10 rounded-lg transition-all"
                                title="查看模型"
                              >
                                <svg
                                  className={`w-4 h-4 transition-transform ${expandedSite === site.name ? 'rotate-180' : ''}`}
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        {/* 操作按钮 */}
                        <div className="flex items-center gap-2">
                          {/* 签到提醒图标（不可点击） */}
                          {site.has_checkin && (
                            <div
                              className="p-2"
                              title="该站点支持签到"
                            >
                              <Gift className="w-4 h-4 text-yellow-400" />
                            </div>
                          )}
                          
                          {/* 单独检测按钮 */}
                          <button
                            onClick={() => detectSingle(site)}
                            disabled={detectingSite === site.name}
                            className="p-2 hover:bg-primary-500/20 rounded-lg transition-all disabled:opacity-50"
                            title="检测此站点"
                          >
                            <RefreshCw className={`w-4 h-4 ${detectingSite === site.name ? 'animate-spin' : ''}`} />
                          </button>
                          
                          <button
                            onClick={() => toggleSite(index)}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            title={site.enabled ? "禁用" : "启用"}
                          >
                            <CheckCircle
                              className={`w-4 h-4 ${
                                site.enabled ? "text-green-500" : "text-gray-500"
                              }`}
                            />
                          </button>
                          <button
                            onClick={() => {
                              setEditingSite(index);
                              setShowSiteEditor(true);
                            }}
                            className="p-2 hover:bg-white/10 rounded-lg transition-all"
                            title="编辑"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deleteSite(index)}
                            className="p-2 hover:bg-red-500/20 rounded-lg transition-all"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* 展开显示模型列表 */}
                    {expandedSite === site.name && siteResult && siteResult.models.length > 0 && (
                      <div className="px-2 pb-0.5 border-t border-white/10 pt-0.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <p className="text-xs text-gray-400">
                            可用模型列表 ({siteResult.models.length}个)
                            {selectedModels.size > 0 && (
                              <span className="ml-2 text-primary-400">
                                已选 {selectedModels.size} 个
                              </span>
                            )}
                          </p>
                          {selectedModels.size > 0 && (
                            <button
                              onClick={copySelectedModels}
                              className="px-2 py-1 bg-primary-600 hover:bg-primary-700 rounded text-xs transition-all flex items-center gap-1"
                              title="复制选中的模型"
                            >
                              <Copy className="w-3 h-3" />
                              复制选中
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
                          {siteResult.models.map((model, idx) => (
                            <button
                              key={idx}
                              onClick={() => toggleModelSelection(model)}
                              className={`px-1.5 py-0.5 rounded text-xs font-mono border transition-all ${
                                selectedModels.has(model)
                                  ? "bg-primary-600 border-primary-400 text-white"
                                  : "bg-white/5 border-white/10 hover:bg-white/10"
                              }`}
                              title={selectedModels.has(model) ? "点击取消选中" : "点击选中"}
                            >
                              {model}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* 错误信息 */}
                    {siteResult && siteResult.error && (
                      <div className="px-2 pb-0.5 border-t border-red-500/20 pt-0.5">
                        <p className="text-xs text-red-400">
                          ❌ {siteResult.error}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 站点编辑对话框 */}
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

      {/* 设置对话框 */}
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

