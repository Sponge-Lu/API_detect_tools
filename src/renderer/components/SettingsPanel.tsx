/**
 * 输入: SettingsPanelProps (设置数据、配置、回调函数)
 * 输出: React 组件 (设置面板 UI - 左右分栏布局)
 * 定位: 展示层 - 应用设置面板，左侧分类导航 + 右侧内容区
 */

import { useState, useRef, useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  X,
  Sun,
  Moon,
  Monitor,
  Download,
  Upload,
  Cloud,
  Loader2,
  Check,
  AlertCircle,
  FolderOpen,
  RefreshCw,
  Info,
  Database,
} from 'lucide-react';
import { Settings, Config } from '../App';
import { useTheme } from '../hooks/useTheme';
import { useUpdate, UpdateCheckResult } from '../hooks/useUpdate';
import { toast } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';
import { WebDAVConfig, DEFAULT_WEBDAV_CONFIG } from '../../shared/types/site';
import { WebDAVBackupDialog } from './dialogs';
import { IOSInput } from './IOSInput';

// 设置分类定义
type SettingsSection = 'general' | 'detection' | 'sync' | 'update' | 'data';

const sections: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: '外观与行为', icon: Sun },
  { id: 'detection', label: '检测设置', icon: Monitor },
  { id: 'sync', label: '云端备份', icon: Cloud },
  { id: 'update', label: '软件更新', icon: Info },
  { id: 'data', label: '数据管理', icon: Database },
];

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
  config?: Config;
  onImport?: (config: Config) => void;
  initialUpdateInfo?: UpdateCheckResult | null;
  asPage?: boolean;
}

const EXPORT_VERSION = '1.0';

export function SettingsPanel({
  settings,
  onSave,
  onCancel,
  config,
  onImport,
  initialUpdateInfo,
  asPage = false,
}: SettingsPanelProps) {
  const [formData, setFormData] = useState<Settings>(settings);
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const { themeMode, changeThemeMode } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    currentVersion,
    updateInfo: hookUpdateInfo,
    isChecking,
    error: updateError,
    settings: updateSettings,
    checkForUpdates,
    updateSettings: saveUpdateSettings,
  } = useUpdate();

  const updateInfo = hookUpdateInfo || initialUpdateInfo;
  const { openDownloadPanel } = useUIStore();

  const [webdavConfig, setWebdavConfig] = useState<WebDAVConfig>(DEFAULT_WEBDAV_CONFIG);
  const [testingConnection, setTestingConnection] = useState(false);
  const [savingWebdav, setSavingWebdav] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [showBackupDialog, setShowBackupDialog] = useState(false);

  const [closeBehavior, setCloseBehavior] = useState<'ask' | 'quit' | 'minimize'>('ask');
  const [loadingCloseBehavior, setLoadingCloseBehavior] = useState(true);
  const [savingCloseBehavior, setSavingCloseBehavior] = useState(false);

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
        has_checkin: s.has_checkin ?? false,
        force_enable_checkin: s.force_enable_checkin ?? false,
        extra_links: s.extra_links || '',
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
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  // ===== Section 内容渲染 =====

  const renderGeneralSection = () => (
    <div className="space-y-6">
      {/* 外观主题 */}
      <div className="bg-white dark:bg-dark-card rounded-xl p-5 border border-light-border dark:border-dark-border shadow-sm">
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

      {/* 关闭行为 */}
      <div className="bg-white dark:bg-dark-card rounded-xl p-5 border border-light-border dark:border-dark-border shadow-sm">
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
    </div>
  );

  const renderDetectionSection = () => (
    <div className="bg-white dark:bg-dark-card rounded-xl p-5 space-y-4 border border-light-border dark:border-dark-border shadow-sm">
      <div>
        <IOSInput
          type="number"
          label="请求超时时间 (秒)"
          size="md"
          value={formData.timeout}
          onChange={e => setFormData({ ...formData, timeout: Number(e.target.value) })}
          min={1}
          max={60}
        />
        <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
          每个站点的最大等待时间
        </p>
      </div>

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

      <div>
        <IOSInput
          type="text"
          label="浏览器路径（可选）"
          size="md"
          value={formData.browser_path || ''}
          onChange={e => setFormData({ ...formData, browser_path: e.target.value })}
          placeholder="例如：C:\PortableApps\Chrome\chrome.exe"
        />
        <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
          留空则自动检测 Chrome / Edge
        </p>
      </div>
    </div>
  );

  const renderSyncSection = () => (
    <div className="bg-white dark:bg-dark-card rounded-xl p-5 space-y-4 border border-light-border dark:border-dark-border shadow-sm">
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

      {webdavConfig.enabled && (
        <div className="space-y-4 pl-7 border-l-2 border-primary-200 dark:border-primary-800">
          <div>
            <IOSInput
              type="text"
              label="服务器地址"
              size="md"
              value={webdavConfig.serverUrl}
              onChange={e => setWebdavConfig({ ...webdavConfig, serverUrl: e.target.value })}
              placeholder="https://dav.jianguoyun.com/dav/"
            />
          </div>
          <div>
            <IOSInput
              type="text"
              label="用户名"
              size="md"
              value={webdavConfig.username}
              onChange={e => setWebdavConfig({ ...webdavConfig, username: e.target.value })}
              placeholder="your-email@example.com"
            />
          </div>
          <div>
            <IOSInput
              type="password"
              label="密码 / 应用密码"
              size="md"
              value={webdavConfig.password}
              onChange={e => setWebdavConfig({ ...webdavConfig, password: e.target.value })}
              placeholder="应用专用密码"
              showPasswordToggle
            />
            <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
              建议使用应用专用密码而非账户密码
            </p>
          </div>
          <div>
            <IOSInput
              type="text"
              label="远程备份路径"
              size="md"
              value={webdavConfig.remotePath}
              onChange={e => setWebdavConfig({ ...webdavConfig, remotePath: e.target.value })}
              placeholder="/api-hub-backups"
            />
          </div>
          <div>
            <IOSInput
              type="number"
              label="最大备份数量"
              size="md"
              value={webdavConfig.maxBackups}
              onChange={e =>
                setWebdavConfig({
                  ...webdavConfig,
                  maxBackups: Math.min(100, Math.max(1, Number(e.target.value) || 10)),
                })
              }
              min={1}
              max={100}
              containerClassName="w-32"
            />
            <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
              超过此数量时自动删除最旧的备份
            </p>
          </div>

          {connectionTestResult && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${connectionTestResult.success ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'}`}
            >
              {connectionTestResult.success ? (
                <Check className="w-4 h-4" />
              ) : (
                <AlertCircle className="w-4 h-4" />
              )}
              {connectionTestResult.message}
            </div>
          )}

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
  );

  const renderUpdateSection = () => (
    <div className="bg-white dark:bg-dark-card rounded-xl p-5 space-y-4 border border-light-border dark:border-dark-border shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-light-text dark:text-dark-text">当前版本</span>
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

      {updateError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          {updateError}
        </div>
      )}

      {updateInfo && !updateError && (
        <div className="space-y-2">
          <div
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${updateInfo.hasUpdate ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-slate-100 dark:bg-slate-700/50 text-light-text-secondary dark:text-dark-text-secondary'}`}
          >
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              {updateInfo.hasUpdate
                ? `正式版 v${updateInfo.latestVersion}`
                : `正式版 v${updateInfo.latestVersion} (当前最新)`}
            </div>
            {updateInfo.hasUpdate && updateInfo.releaseInfo && (
              <button
                type="button"
                onClick={() => openDownloadPanel(updateInfo.releaseInfo!)}
                className="text-xs px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
              >
                查看详情
              </button>
            )}
          </div>

          {updateInfo.latestPreReleaseVersion && (
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${updateInfo.hasPreReleaseUpdate ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-700/50 text-light-text-secondary dark:text-dark-text-secondary'}`}
            >
              <div className="flex items-center gap-2">
                {updateInfo.hasPreReleaseUpdate ? (
                  <AlertCircle className="w-4 h-4" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {updateInfo.hasPreReleaseUpdate
                  ? `预发布版 v${updateInfo.latestPreReleaseVersion}`
                  : `预发布版 v${updateInfo.latestPreReleaseVersion} (当前最新)`}
              </div>
              {updateInfo.hasPreReleaseUpdate && updateInfo.preReleaseInfo && (
                <button
                  type="button"
                  onClick={() => openDownloadPanel(updateInfo.preReleaseInfo!)}
                  className="text-xs px-2 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
                >
                  查看详情
                </button>
              )}
            </div>
          )}
        </div>
      )}

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
  );

  const renderDataSection = () => (
    <div className="bg-white dark:bg-dark-card rounded-xl p-5 border border-light-border dark:border-dark-border shadow-sm">
      {config && onImport ? (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="flex-1 px-4 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm shadow-sm"
            >
              <Download className="w-4 h-4" />
              导出配置
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-4 py-2.5 bg-light-bg dark:bg-dark-bg hover:bg-light-border dark:hover:bg-dark-border text-light-text dark:text-dark-text rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm border border-light-border dark:border-dark-border"
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
        </>
      ) : (
        <p className="text-sm text-light-text-secondary dark:text-dark-text-secondary">
          暂无可用的数据管理操作
        </p>
      )}
    </div>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneralSection();
      case 'detection':
        return renderDetectionSection();
      case 'sync':
        return renderSyncSection();
      case 'update':
        return renderUpdateSection();
      case 'data':
        return renderDataSection();
    }
  };

  const getSectionTitle = () => {
    return sections.find(s => s.id === activeSection)?.label || '';
  };

  const dialogs = (
    <WebDAVBackupDialog isOpen={showBackupDialog} onClose={() => setShowBackupDialog(false)} />
  );

  // ===== 页面模式：左右分栏 =====
  if (asPage) {
    return (
      <form onSubmit={handleSubmit} className="flex-1 flex overflow-hidden">
        {/* 左侧导航 */}
        <aside className="w-56 shrink-0 border-r border-light-border dark:border-dark-border bg-white/50 dark:bg-dark-card/30 p-3 space-y-1 overflow-y-auto">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left
                ${
                  activeSection === id
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm border border-primary-200/50 dark:border-primary-700/50'
                    : 'text-light-text-secondary dark:text-dark-text-secondary hover:bg-light-bg dark:hover:bg-dark-bg hover:text-light-text dark:hover:text-dark-text'
                }
              `}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${activeSection === id ? 'text-primary-500' : ''}`}
              />
              <span>{label}</span>
            </button>
          ))}
        </aside>

        {/* 右侧内容 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl">
              <h2 className="text-lg font-bold text-light-text dark:text-dark-text mb-5">
                {getSectionTitle()}
              </h2>
              {renderSectionContent()}
            </div>
          </div>

          {/* 粘性底部操作栏 - 仅在检测设置分类时显示保存/取消 */}
          {activeSection === 'detection' && (
            <div className="shrink-0 border-t border-light-border dark:border-dark-border bg-white/80 dark:bg-dark-card/80 backdrop-blur px-6 py-3 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 bg-light-card dark:bg-dark-card hover:bg-light-bg dark:hover:bg-dark-bg rounded-lg transition-all border border-light-border dark:border-dark-border text-light-text dark:text-dark-text font-medium text-sm"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all font-semibold text-sm shadow-sm"
              >
                保存检测设置
              </button>
            </div>
          )}
        </div>

        {dialogs}
      </form>
    );
  }

  // ===== 弹窗模式（保持旧逻辑） =====
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl max-w-4xl w-full border border-light-border dark:border-dark-border flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-light-border dark:border-dark-border shrink-0">
          <h2 className="text-xl font-bold text-light-text dark:text-dark-text">设置</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 flex overflow-hidden">
          <aside className="w-48 shrink-0 border-r border-light-border dark:border-dark-border bg-light-bg/50 dark:bg-dark-bg/30 p-2 space-y-1 overflow-y-auto">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left
                  ${
                    activeSection === id
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 shadow-sm'
                      : 'text-light-text-secondary dark:text-dark-text-secondary hover:bg-white/60 dark:hover:bg-dark-card/40'
                  }
                `}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </aside>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl">
                <h3 className="text-lg font-bold text-light-text dark:text-dark-text mb-4">
                  {getSectionTitle()}
                </h3>
                {renderSectionContent()}
              </div>
            </div>
            {activeSection === 'detection' && (
              <div className="shrink-0 border-t border-light-border dark:border-dark-border px-6 py-3 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all border border-light-border dark:border-dark-border text-light-text dark:text-dark-text font-medium text-sm"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all font-semibold text-sm"
                >
                  保存
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
      {dialogs}
    </div>
  );
}
