/**
 * 输入: SettingsPanelProps (设置数据、配置、回调函数)
 * 输出: React 组件 (设置面板 UI)
 * 定位: 展示层 - 应用设置面板，包含主题、备份、WebDAV 等配置
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { useState, useRef, useEffect } from 'react';
import {
  X,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Cloud,
  Loader2,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  FolderOpen,
  RefreshCw,
  Info,
  Power,
} from 'lucide-react';
import { Settings, Config } from '../App';
import { useTheme } from '../hooks/useTheme';
import { useUpdate, ReleaseInfo, UpdateCheckResult } from '../hooks/useUpdate';
import { toast } from '../store/toastStore';
import { WebDAVConfig, DEFAULT_WEBDAV_CONFIG } from '../../shared/types/site';
import { WebDAVBackupDialog, UpdateDialog } from './dialogs';

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
  config?: Config;
  onImport?: (config: Config) => void;
  // 从 App.tsx 传入的更新信息（启动时自动检查的结果）
  initialUpdateInfo?: UpdateCheckResult | null;
}

// 导出格式版本
const EXPORT_VERSION = '1.0';

export function SettingsPanel({
  settings,
  onSave,
  onCancel,
  config,
  onImport,
  initialUpdateInfo,
}: SettingsPanelProps) {
  const [formData, setFormData] = useState<Settings>(settings);
  const { themeMode, changeThemeMode } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 软件更新相关状态
  const {
    currentVersion,
    updateInfo: hookUpdateInfo,
    isChecking,
    error: updateError,
    settings: updateSettings,
    checkForUpdates,
    updateSettings: saveUpdateSettings,
  } = useUpdate();

  // 优先使用 hook 返回的更新信息，如果没有则使用传入的初始值
  const updateInfo = hookUpdateInfo || initialUpdateInfo;

  // WebDAV 设置状态
  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>(DEFAULT_WEBDAV_CONFIG);
  const [showPassword, setShowPassword] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingWebdav, setSavingWebdav] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [showBackupDialog, setShowBackupDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseInfo | null>(null);

  // 关闭行为设置状态
  const [closeBehavior, setCloseBehavior] = useState<'ask' | 'quit' | 'minimize'>('ask');
  const [loadingCloseBehavior, setLoadingCloseBehavior] = useState(true);
  const [savingCloseBehavior, setSavingCloseBehavior] = useState(false);

  // 加载 WebDAV 配置
  useEffect(() => {
    const loadWebdavConfig = async () => {
      try {
        const result = await window.electronAPI.webdav?.getConfig();
        if (result?.success && result.data) {
          setWebdavConfig(result.data);
        }
      } catch (error) {
        console.error('加载 WebDAV 配置失败:', error);
      }
    };
    loadWebdavConfig();
  }, []);

  // 加载关闭行为设置
  useEffect(() => {
    const loadCloseBehaviorSettings = async () => {
      try {
        const result = await window.electronAPI.closeBehavior?.getSettings();
        if (result?.success && result.data?.behavior) {
          setCloseBehavior(result.data.behavior);
        }
      } catch (error) {
        console.error('加载关闭行为设置失败:', error);
      } finally {
        setLoadingCloseBehavior(false);
      }
    };
    loadCloseBehaviorSettings();
  }, []);

  // 测试 WebDAV 连接
  const handleTestConnection = async () => {
    if (!webdavConfig.serverUrl) {
      setConnectionTestResult({ success: false, message: '请输入服务器地址' });
      return;
    }

    setTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const result = await window.electronAPI.webdav?.testConnection(webdavConfig);
      if (result?.success) {
        setConnectionTestResult({ success: true, message: '连接成功' });
      } else {
        setConnectionTestResult({ success: false, message: result?.error || '连接失败' });
      }
    } catch (error: any) {
      setConnectionTestResult({ success: false, message: error.message || '连接测试失败' });
    } finally {
      setTestingConnection(false);
    }
  };

  // 保存 WebDAV 配置
  const handleSaveWebdavConfig = async () => {
    setSavingWebdav(true);
    try {
      const result = await window.electronAPI.webdav?.saveConfig(webdavConfig);
      if (result?.success) {
        toast.success('WebDAV 配置已保存');
      } else {
        toast.error(result?.error || '保存失败');
      }
    } catch (error: any) {
      toast.error(error.message || '保存 WebDAV 配置失败');
    } finally {
      setSavingWebdav(false);
    }
  };

  // 保存关闭行为设置
  const handleCloseBehaviorChange = async (behavior: 'ask' | 'quit' | 'minimize') => {
    setSavingCloseBehavior(true);
    try {
      await window.electronAPI.closeBehavior?.saveSettings({ behavior });
      setCloseBehavior(behavior);
      toast.success('关闭行为设置已保存');
    } catch (error: any) {
      toast.error(error.message || '保存关闭行为设置失败');
    } finally {
      setSavingCloseBehavior(false);
    }
  };

  // 导出配置（完整导出，包含认证信息）
  const handleExport = () => {
    if (!config) {
      toast.error('无法获取配置');
      return;
    }
    const exportData = {
      version: EXPORT_VERSION,
      exportTime: new Date().toISOString(),
      sites: config.sites.map(s => ({
        name: s.name,
        url: s.url,
        api_key: s.api_key || '',
        enabled: s.enabled,
        group: s.group || 'default',
        // 签到相关配置
        has_checkin: s.has_checkin ?? false,
        force_enable_checkin: s.force_enable_checkin ?? false,
        // 加油站链接
        extra_links: s.extra_links || '',
        // 认证信息
        system_token: s.system_token || '',
        user_id: s.user_id || '',
      })),
      siteGroups: config.siteGroups,
      settings: config.settings,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-hub-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('配置已导出（包含完整认证信息）');
  };

  // 导入配置
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.sites || !Array.isArray(data.sites)) {
          toast.error('无效的配置文件格式');
          return;
        }
        const newConfig: Config = {
          sites: data.sites,
          siteGroups: data.siteGroups || [],
          settings: data.settings || settings,
        };
        onImport(newConfig);
        toast.success(`已导入 ${data.sites.length} 个站点`);
      } catch {
        toast.error('配置文件解析失败');
      }
    };
    reader.readAsText(file);
    // 重置 input 以允许重复选择同一文件
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl max-w-2xl w-full border border-light-border dark:border-dark-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border">
          <h2 className="text-xl font-bold text-light-text dark:text-dark-text">设置</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* ===== 外观设置 ===== */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
              <Sun className="w-4 h-4" />
              外观设置
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-3">
                外观主题
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => changeThemeMode('light')}
                  className={`px-4 py-3 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                    themeMode === 'light'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-light-border dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700'
                  }`}
                >
                  <Sun
                    className={`w-5 h-5 ${themeMode === 'light' ? 'text-primary-500' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  />
                  <span
                    className={`text-sm font-medium ${themeMode === 'light' ? 'text-primary-600 dark:text-primary-400' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  >
                    白天模式
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => changeThemeMode('dark')}
                  className={`px-4 py-3 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                    themeMode === 'dark'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-light-border dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700'
                  }`}
                >
                  <Moon
                    className={`w-5 h-5 ${themeMode === 'dark' ? 'text-primary-500' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  />
                  <span
                    className={`text-sm font-medium ${themeMode === 'dark' ? 'text-primary-600 dark:text-primary-400' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  >
                    夜晚模式
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => changeThemeMode('system')}
                  className={`px-4 py-3 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                    themeMode === 'system'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-light-border dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700'
                  }`}
                >
                  <Monitor
                    className={`w-5 h-5 ${themeMode === 'system' ? 'text-primary-500' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  />
                  <span
                    className={`text-sm font-medium ${themeMode === 'system' ? 'text-primary-600 dark:text-primary-400' : 'text-light-text-secondary dark:text-dark-text-secondary'}`}
                  >
                    跟随系统
                  </span>
                </button>
              </div>
              <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-2">
                选择应用的外观主题，跟随系统将根据操作系统设置自动切换
              </p>
            </div>
          </section>

          {/* ===== 检测设置 ===== */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              检测设置
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 space-y-4 border border-slate-200 dark:border-slate-700">
              {/* 超时设置 */}
              <div>
                <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
                  请求超时时间 (秒)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={formData.timeout}
                  onChange={e => setFormData({ ...formData, timeout: Number(e.target.value) })}
                  className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text"
                />
                <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                  每个站点的最大等待时间
                </p>
              </div>

              {/* 并发检测 */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="concurrent"
                  checked={formData.concurrent}
                  onChange={e => setFormData({ ...formData, concurrent: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="concurrent"
                    className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
                  >
                    并发检测
                  </label>
                  <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    同时检测所有站点，速度更快但占用资源更多
                  </p>
                </div>
              </div>

              {formData.concurrent && (
                <div className="flex items-start gap-3 pl-7">
                  <label
                    htmlFor="max_concurrent"
                    className="text-sm font-medium text-light-text dark:text-dark-text w-32 pt-1"
                  >
                    最大并发数
                  </label>
                  <div className="flex-1">
                    <input
                      id="max_concurrent"
                      type="number"
                      min={1}
                      max={5}
                      value={formData.max_concurrent ?? 1}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          max_concurrent: Math.min(5, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="w-24 rounded-md border border-light-border dark:border-dark-border bg-light-bg dark:bg-dark-bg py-1.5 px-3 text-sm text-light-text dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                      默认 1（串行），可按机器/网络情况调到 2–5。
                    </p>
                  </div>
                </div>
              )}

              {/* 显示禁用站点 */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="show_disabled"
                  checked={formData.show_disabled}
                  onChange={e => setFormData({ ...formData, show_disabled: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="show_disabled"
                    className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
                  >
                    显示禁用的站点
                  </label>
                  <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    在检测时也包含已禁用的站点
                  </p>
                </div>
              </div>

              {/* 浏览器路径设置 */}
              <div>
                <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
                  浏览器路径（可选）
                </label>
                <input
                  type="text"
                  value={formData.browser_path || ''}
                  onChange={e => setFormData({ ...formData, browser_path: e.target.value })}
                  placeholder="例如：C:\PortableApps\Chrome\chrome.exe"
                  className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                />
                <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                  留空则自动检测 Chrome / Edge
                </p>
              </div>
            </div>
          </section>

          {/* ===== WebDAV 云端备份 ===== */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              WebDAV 云端备份
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 space-y-4 border border-slate-200 dark:border-slate-700">
              {/* 启用开关 */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="webdav_enabled"
                  checked={webdavConfig.enabled}
                  onChange={e => setWebdavConfig({ ...webdavConfig, enabled: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="webdav_enabled"
                    className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
                  >
                    启用 WebDAV 备份
                  </label>
                  <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    将配置备份到支持 WebDAV 的云存储（如坚果云、NextCloud）
                  </p>
                </div>
              </div>

              {/* WebDAV 配置表单 - 仅在启用时显示 */}
              {webdavConfig.enabled && (
                <div className="space-y-4 pl-7 border-l-2 border-primary-200 dark:border-primary-800">
                  {/* 服务器地址 */}
                  <div>
                    <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-1">
                      服务器地址
                    </label>
                    <input
                      type="text"
                      value={webdavConfig.serverUrl}
                      onChange={e =>
                        setWebdavConfig({ ...webdavConfig, serverUrl: e.target.value })
                      }
                      placeholder="https://dav.jianguoyun.com/dav/"
                      className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                    />
                  </div>

                  {/* 用户名 */}
                  <div>
                    <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-1">
                      用户名
                    </label>
                    <input
                      type="text"
                      value={webdavConfig.username}
                      onChange={e => setWebdavConfig({ ...webdavConfig, username: e.target.value })}
                      placeholder="your-email@example.com"
                      className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                    />
                  </div>

                  {/* 密码 */}
                  <div>
                    <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-1">
                      密码 / 应用密码
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={webdavConfig.password}
                        onChange={e =>
                          setWebdavConfig({ ...webdavConfig, password: e.target.value })
                        }
                        placeholder="应用专用密码"
                        className="w-full px-4 py-2 pr-10 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-light-text-secondary dark:text-dark-text-secondary hover:text-light-text dark:hover:text-dark-text"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                      建议使用应用专用密码而非账户密码
                    </p>
                  </div>

                  {/* 远程路径 */}
                  <div>
                    <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-1">
                      远程备份路径
                    </label>
                    <input
                      type="text"
                      value={webdavConfig.remotePath}
                      onChange={e =>
                        setWebdavConfig({ ...webdavConfig, remotePath: e.target.value })
                      }
                      placeholder="/api-hub-backups"
                      className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                    />
                  </div>

                  {/* 最大备份数量 */}
                  <div>
                    <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-1">
                      最大备份数量
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={webdavConfig.maxBackups}
                      onChange={e =>
                        setWebdavConfig({
                          ...webdavConfig,
                          maxBackups: Math.min(100, Math.max(1, Number(e.target.value) || 10)),
                        })
                      }
                      className="w-24 px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text text-sm"
                    />
                    <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                      超过此数量时自动删除最旧的备份
                    </p>
                  </div>

                  {/* 连接测试结果 */}
                  {connectionTestResult && (
                    <div
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                        connectionTestResult.success
                          ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                          : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                      }`}
                    >
                      {connectionTestResult.success ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                      {connectionTestResult.message}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testingConnection || !webdavConfig.serverUrl}
                      className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
                    >
                      {testingConnection ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          测试中...
                        </>
                      ) : (
                        '测试连接'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveWebdavConfig}
                      disabled={savingWebdav}
                      className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:disabled:bg-primary-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
                    >
                      {savingWebdav ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          保存中...
                        </>
                      ) : (
                        '保存设置'
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBackupDialog(true)}
                      disabled={!webdavConfig.serverUrl}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-300 dark:disabled:bg-green-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
                    >
                      <FolderOpen className="w-4 h-4" />
                      管理备份
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ===== 软件更新 ===== */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
              <Info className="w-4 h-4" />
              软件更新
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 space-y-4 border border-slate-200 dark:border-slate-700">
              {/* 当前版本显示 */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-light-text dark:text-dark-text">
                    当前版本
                  </span>
                  <span className="ml-2 text-sm text-light-text-secondary dark:text-dark-text-secondary">
                    v{currentVersion || '加载中...'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={checkForUpdates}
                  disabled={isChecking}
                  className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 dark:disabled:bg-primary-700 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
                >
                  {isChecking ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      检查中...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      检查更新
                    </>
                  )}
                </button>
              </div>

              {/* 更新检查结果 */}
              {updateError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  {updateError}
                </div>
              )}

              {updateInfo && !updateError && (
                <div className="space-y-2">
                  {/* 正式版本信息 */}
                  <div
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                      updateInfo.hasUpdate
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                        : 'bg-slate-100 dark:bg-slate-700/50 text-light-text-secondary dark:text-dark-text-secondary'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {updateInfo.hasUpdate ? (
                        <>
                          <Check className="w-4 h-4" />
                          正式版 v{updateInfo.latestVersion}
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          正式版 v{updateInfo.latestVersion} (当前最新)
                        </>
                      )}
                    </div>
                    {updateInfo.hasUpdate && updateInfo.releaseInfo && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRelease(updateInfo.releaseInfo!);
                          setShowUpdateDialog(true);
                        }}
                        className="text-xs px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
                      >
                        查看详情
                      </button>
                    )}
                  </div>

                  {/* 预发布版本信息 */}
                  {updateInfo.latestPreReleaseVersion && (
                    <div
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                        updateInfo.hasPreReleaseUpdate
                          ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-700/50 text-light-text-secondary dark:text-dark-text-secondary'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {updateInfo.hasPreReleaseUpdate ? (
                          <>
                            <AlertCircle className="w-4 h-4" />
                            预发布版 v{updateInfo.latestPreReleaseVersion}
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4" />
                            预发布版 v{updateInfo.latestPreReleaseVersion} (当前最新)
                          </>
                        )}
                      </div>
                      {updateInfo.hasPreReleaseUpdate && updateInfo.preReleaseInfo && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRelease(updateInfo.preReleaseInfo!);
                            setShowUpdateDialog(true);
                          }}
                          className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                        >
                          查看详情
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 自动检查更新开关 */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="auto_check_update"
                  checked={updateSettings.autoCheckEnabled}
                  onChange={e => saveUpdateSettings({ autoCheckEnabled: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="auto_check_update"
                    className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
                  >
                    启动时自动检查更新
                  </label>
                  <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    应用启动时自动在后台检查是否有新版本
                  </p>
                </div>
              </div>

              {/* 包含预发布版本开关 */}
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="include_pre_release"
                  checked={updateSettings.includePreRelease}
                  onChange={e => saveUpdateSettings({ includePreRelease: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <label
                    htmlFor="include_pre_release"
                    className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
                  >
                    包含预发布版本
                  </label>
                  <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                    检查更新时包含 Beta、Alpha 等预发布版本
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ===== 关闭行为 ===== */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
              <Power className="w-4 h-4" />
              关闭行为
            </h3>
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
              <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-3">
                点击关闭按钮时
              </label>
              {loadingCloseBehavior ? (
                <div className="flex items-center gap-2 text-light-text-secondary dark:text-dark-text-secondary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">加载中...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="closeBehavior"
                      value="ask"
                      checked={closeBehavior === 'ask'}
                      onChange={() => handleCloseBehaviorChange('ask')}
                      disabled={savingCloseBehavior}
                      className="mt-1 w-4 h-4 border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-light-text dark:text-dark-text">
                        每次询问
                      </span>
                      <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-0.5">
                        每次关闭窗口时询问是退出还是最小化到托盘
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="closeBehavior"
                      value="quit"
                      checked={closeBehavior === 'quit'}
                      onChange={() => handleCloseBehaviorChange('quit')}
                      disabled={savingCloseBehavior}
                      className="mt-1 w-4 h-4 border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-light-text dark:text-dark-text">
                        直接退出
                      </span>
                      <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-0.5">
                        关闭窗口时直接退出应用程序
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="closeBehavior"
                      value="minimize"
                      checked={closeBehavior === 'minimize'}
                      onChange={() => handleCloseBehaviorChange('minimize')}
                      disabled={savingCloseBehavior}
                      className="mt-1 w-4 h-4 border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-light-text dark:text-dark-text">
                        最小化到托盘
                      </span>
                      <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-0.5">
                        关闭窗口时最小化到系统托盘，可通过托盘图标恢复
                      </p>
                    </div>
                  </label>
                </div>
              )}
              {savingCloseBehavior && (
                <div className="flex items-center gap-2 mt-3 text-primary-600 dark:text-primary-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">保存中...</span>
                </div>
              )}
            </div>
          </section>

          {/* ===== 数据管理 ===== */}
          {config && onImport && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-primary-600 dark:text-primary-400 uppercase tracking-wide flex items-center gap-2">
                <Download className="w-4 h-4" />
                数据管理
              </h3>
              <div className="bg-slate-50 dark:bg-slate-800/80 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleExport}
                    className="flex-1 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <Download className="w-4 h-4" />
                    导出配置
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    导入配置
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImport}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-2">
                  导出包含完整配置（含认证信息），请妥善保管导出文件
                </p>
              </div>
            </section>
          )}

          {/* 按钮 */}
          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all border border-light-border dark:border-dark-border text-light-text dark:text-dark-text font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all font-semibold shadow-md hover:shadow-lg"
            >
              保存
            </button>
          </div>
        </form>
      </div>

      {/* WebDAV 备份管理对话框 */}
      <WebDAVBackupDialog isOpen={showBackupDialog} onClose={() => setShowBackupDialog(false)} />

      {/* 软件更新对话框 */}
      {selectedRelease && (
        <UpdateDialog
          isOpen={showUpdateDialog}
          onClose={() => {
            setShowUpdateDialog(false);
            setSelectedRelease(null);
          }}
          currentVersion={currentVersion}
          releaseInfo={selectedRelease}
          onDownload={() => {
            if (selectedRelease?.downloadUrl) {
              window.electronAPI?.update?.openDownload(selectedRelease.downloadUrl);
            }
          }}
        />
      )}
    </div>
  );
}
