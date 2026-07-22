/**
 * 输入: SettingsPanelProps (应用配置、导入与关闭回调)
 * 输出: React 组件 (设置面板 UI - 左右分栏布局)
 * 定位: 展示层 - 应用设置面板，左侧分类导航 + 右侧内容区
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  X,
  Sun,
  Moon,
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
import type { Config } from '../App';
import { useTheme } from '../hooks/useTheme';
import { useUpdate, UpdateCheckResult } from '../hooks/useUpdate';
import { toast } from '../store/toastStore';
import { useUIStore, type SettingsSection } from '../store/uiStore';
import { WebDAVConfig, DEFAULT_WEBDAV_CONFIG } from '../../shared/types/site';
import { WebDAVBackupDialog } from './dialogs';
import { AppInput } from './AppInput';
import { THEME_PRESETS, type ThemeMode } from '../../shared/theme/themePresets';

function isSameWebdavConfig(left: WebDAVConfig, right: WebDAVConfig): boolean {
  return (
    left.enabled === right.enabled &&
    left.serverUrl === right.serverUrl &&
    left.username === right.username &&
    left.password === right.password &&
    left.remotePath === right.remotePath &&
    left.maxBackups === right.maxBackups
  );
}

const WEBDAV_SAVE_DIRTY_CLASS =
  'px-3 py-1.5 bg-[var(--danger)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed';
const WEBDAV_SAVE_CLEAN_CLASS =
  'px-3 py-1.5 bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed';

// 设置分类定义
const sections: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: '外观与行为', icon: Sun },
  { id: 'sync', label: '云端备份', icon: Cloud },
  { id: 'update', label: '软件更新', icon: Info },
  { id: 'data', label: '数据管理', icon: Database },
];

const themeIcons: Record<ThemeMode, LucideIcon> = {
  'light-b': Sun,
  dark: Moon,
};

interface SettingsPanelProps {
  onCancel: () => void;
  config?: Config;
  onImport?: (config: Config) => void;
  initialUpdateInfo?: UpdateCheckResult | null;
  asPage?: boolean;
}

export function SettingsPanel({
  onCancel,
  config,
  onImport,
  initialUpdateInfo,
  asPage = false,
}: SettingsPanelProps) {
  const requestedActiveSection = useUIStore(state => state.activeSettingsSection);
  const setActiveSection = useUIStore(state => state.setActiveSettingsSection);
  const activeSection = sections.some(section => section.id === requestedActiveSection)
    ? requestedActiveSection
    : 'general';
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
  const [savedWebdavConfig, setSavedWebdavConfig] = useState<WebDAVConfig>(DEFAULT_WEBDAV_CONFIG);
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

  const isWebdavDirty = useMemo(
    () => !isSameWebdavConfig(webdavConfig, savedWebdavConfig),
    [savedWebdavConfig, webdavConfig]
  );

  useEffect(() => {
    if (activeSection !== requestedActiveSection) {
      setActiveSection(activeSection);
    }
  }, [activeSection, requestedActiveSection, setActiveSection]);

  useEffect(() => {
    const loadWebdavConfig = async () => {
      try {
        const result = await window.electronAPI.webdav?.getConfig();
        if (result?.success && result.data) {
          setWebdavConfig(result.data);
          setSavedWebdavConfig(result.data);
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
        setSavedWebdavConfig(webdavConfig);
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

  const handleExport = async () => {
    try {
      const result = await window.electronAPI.backup?.exportPackage?.();
      if (!result?.success || !result.data?.content) {
        toast.error(result?.error || '导出配置包失败');
        return;
      }

      const blob = new Blob([result.data.content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.data.filename || `config_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('可迁移配置包已导出（config.json + 直连配置；隔离浏览器登录态需在新机重建）');
    } catch (error: any) {
      toast.error(error?.message || '导出配置包失败');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const content = event.target?.result;
        if (typeof content !== 'string') {
          toast.error('配置包读取失败');
          return;
        }

        const result = await window.electronAPI.backup?.importPackage?.(content);
        if (!result?.success) {
          toast.error(result?.error || '导入配置包失败');
          return;
        }

        const importedConfig = await window.electronAPI.loadConfig();
        onImport?.(importedConfig);
        const restoredCount = result.data?.restoredFiles.length ?? 0;
        const rebound = result.data?.reconcile?.reboundAccounts ?? 0;
        toast.success(
          rebound > 0
            ? `配置包已导入（恢复 ${restoredCount} 个文件，已为 ${rebound} 个隔离账户重建浏览器目录）`
            : `配置包已导入（恢复 ${restoredCount} 个文件）`
        );
      } catch (error: any) {
        toast.error(error?.message || '配置包解析失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ===== Section 内容渲染 =====

  const renderGeneralSection = () => (
    <div className="space-y-6">
      {/* 外观主题 */}
      <div className="bg-[var(--surface-1)] rounded-xl p-5 border border-[var(--line-soft)] shadow-sm">
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-3">
          外观主题
        </label>
        <div className="grid grid-cols-2 gap-3">
          {THEME_PRESETS.map(preset => {
            const selected = themeMode === preset.id;
            const ThemeIcon = themeIcons[preset.id];

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => changeThemeMode(preset.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  selected
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent-soft)]'
                    : 'border-[var(--line-soft)] hover:border-[var(--accent)]/45'
                }`}
                style={
                  selected
                    ? {
                        backgroundColor: preset.softAccent,
                        borderColor: preset.accentColor,
                      }
                    : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ThemeIcon
                        className="h-4 w-4 shrink-0"
                        style={{ color: selected ? preset.accentColor : undefined }}
                      />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {preset.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {preset.description}
                    </p>
                  </div>
                  {selected ? (
                    <Check className="h-4 w-4 shrink-0" style={{ color: preset.accentColor }} />
                  ) : null}
                </div>
                <div className="mt-3 flex gap-2">
                  {[preset.appBackground, preset.panelBackground, preset.panelRaised].map(color => (
                    <span
                      key={`${preset.id}-${color}`}
                      className="h-2.5 flex-1 rounded-full border border-[var(--line-soft)]"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 关闭行为 */}
      <div className="bg-[var(--surface-1)] rounded-xl p-5 border border-[var(--line-soft)] shadow-sm">
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-3">
          点击关闭按钮时
        </label>
        {loadingCloseBehavior ? (
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
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
                className="mt-1 h-4 w-4 border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">每次询问</span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
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
                className="mt-1 h-4 w-4 border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">直接退出</span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
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
                className="mt-1 h-4 w-4 border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-[var(--text-primary)]">最小化到托盘</span>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  关闭窗口时最小化到系统托盘，可通过托盘图标恢复
                </p>
              </div>
            </label>
          </div>
        )}
        {savingCloseBehavior && (
          <div className="flex items-center gap-2 mt-3 text-[var(--accent)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">保存中...</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderSyncSection = () => (
    <div className="bg-[var(--surface-1)] rounded-xl p-5 space-y-4 border border-[var(--line-soft)] shadow-sm">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="webdav_enabled"
          checked={webdavConfig.enabled}
          onChange={e => setWebdavConfig({ ...webdavConfig, enabled: e.target.checked })}
          className="mt-1 h-4 w-4 rounded border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
        />
        <div className="flex-1">
          <label
            htmlFor="webdav_enabled"
            className="text-sm font-medium block text-[var(--text-primary)] cursor-pointer"
          >
            启用 WebDAV 备份
          </label>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            将配置备份到支持 WebDAV 的云存储（如坚果云、NextCloud）
          </p>
        </div>
      </div>

      {webdavConfig.enabled && (
        <div className="space-y-4 pl-7 border-l-2 border-[var(--accent)]/20">
          <div>
            <AppInput
              type="text"
              label="服务器地址"
              size="md"
              value={webdavConfig.serverUrl}
              onChange={e => setWebdavConfig({ ...webdavConfig, serverUrl: e.target.value })}
              placeholder="https://dav.jianguoyun.com/dav/"
            />
          </div>
          <div>
            <AppInput
              type="text"
              label="用户名"
              size="md"
              value={webdavConfig.username}
              onChange={e => setWebdavConfig({ ...webdavConfig, username: e.target.value })}
              placeholder="your-email@example.com"
            />
          </div>
          <div>
            <AppInput
              type="password"
              label="密码 / 应用密码"
              size="md"
              value={webdavConfig.password}
              onChange={e => setWebdavConfig({ ...webdavConfig, password: e.target.value })}
              placeholder="应用专用密码"
              showPasswordToggle
            />
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              建议使用应用专用密码而非账户密码
            </p>
          </div>
          <div>
            <AppInput
              type="text"
              label="远程备份路径"
              size="md"
              value={webdavConfig.remotePath}
              onChange={e => setWebdavConfig({ ...webdavConfig, remotePath: e.target.value })}
              placeholder="/api-hub-backups"
            />
          </div>
          <div>
            <AppInput
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
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              超过此数量时自动删除最旧的备份
            </p>
          </div>

          {connectionTestResult && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${connectionTestResult.success ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--danger-soft)] text-[var(--danger)]'}`}
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
              className="px-3 py-1.5 border border-[var(--line-soft)] bg-[var(--surface-3)] text-[var(--text-primary)] hover:bg-[var(--surface-2)] disabled:opacity-50 rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
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
              data-testid="webdav-save-button"
              data-dirty={isWebdavDirty ? 'true' : 'false'}
              className={isWebdavDirty ? WEBDAV_SAVE_DIRTY_CLASS : WEBDAV_SAVE_CLEAN_CLASS}
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
              className="px-3 py-1.5 bg-[var(--success)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
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
    <div className="bg-[var(--surface-1)] rounded-xl p-5 space-y-4 border border-[var(--line-soft)] shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-[var(--text-primary)]">当前版本</span>
          <span className="ml-2 text-sm text-[var(--text-secondary)]">
            v{currentVersion || '加载中...'}
          </span>
        </div>
        <button
          type="button"
          onClick={checkForUpdates}
          disabled={isChecking}
          className="px-3 py-1.5 bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed"
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
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-[var(--danger-soft)] text-[var(--danger)]">
          <AlertCircle className="w-4 h-4" />
          {updateError}
        </div>
      )}

      {updateInfo && !updateError && (
        <div className="space-y-2">
          <div
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${updateInfo.hasUpdate ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}
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
                className="text-xs px-2 py-1 bg-[var(--success)] hover:opacity-90 text-white rounded transition-colors"
              >
                查看详情
              </button>
            )}
          </div>

          {updateInfo.latestPreReleaseVersion && (
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${updateInfo.hasPreReleaseUpdate ? 'bg-[var(--warning-soft)] text-[var(--warning)]' : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'}`}
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
                  className="text-xs px-2 py-1 bg-[var(--warning)] hover:opacity-90 text-white rounded transition-colors"
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
          className="mt-1 h-4 w-4 rounded border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
        />
        <div className="flex-1">
          <label
            htmlFor="auto_check_update"
            className="text-sm font-medium block text-[var(--text-primary)] cursor-pointer"
          >
            启动时自动检查更新
          </label>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
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
          className="mt-1 h-4 w-4 rounded border-[var(--line-soft)] text-[var(--accent)] focus:ring-[var(--accent)]"
        />
        <div className="flex-1">
          <label
            htmlFor="include_pre_release"
            className="text-sm font-medium block text-[var(--text-primary)] cursor-pointer"
          >
            包含预发布版本
          </label>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            检查更新时包含 Beta、Alpha 等预发布版本
          </p>
        </div>
      </div>
    </div>
  );

  const renderDataSection = () => (
    <div className="bg-[var(--surface-1)] rounded-xl p-5 border border-[var(--line-soft)] shadow-sm">
      {config ? (
        <>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleExport}
              className="flex-1 px-4 py-2.5 bg-[var(--accent)] hover:opacity-90 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm shadow-sm"
            >
              <Download className="w-4 h-4" />
              导出配置
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-4 py-2.5 bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-primary)] rounded-lg transition-all flex items-center justify-center gap-2 font-medium text-sm border border-[var(--line-soft)]"
            >
              <Upload className="w-4 h-4" />
              导入配置
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.ahubpkg"
              onChange={handleImport}
              className="hidden"
            />
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-2">
            导出为可迁移配置包（config.json + custom-cli-configs.json，敏感字段保持字段级加密）。
            导入后会自动为隔离账户重建本机浏览器目录，但不会迁移登录会话。
          </p>
        </>
      ) : (
        <p className="text-sm text-[var(--text-secondary)]">暂无可用的数据管理操作</p>
      )}
    </div>
  );

  const renderSectionContent = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneralSection();
      case 'sync':
        return renderSyncSection();
      case 'update':
        return renderUpdateSection();
      case 'data':
        return renderDataSection();
      default:
        return renderGeneralSection();
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
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧导航 */}
        <aside className="w-56 shrink-0 border-r border-[var(--line-soft)] bg-[var(--surface-2)]/72 p-3 space-y-1 overflow-y-auto">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left
                ${
                  activeSection === id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm border border-[var(--accent)]/25'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]'
                }
              `}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${activeSection === id ? 'text-[var(--accent)]' : ''}`}
              />
              <span>{label}</span>
            </button>
          ))}
        </aside>

        {/* 右侧内容 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-4xl">
              <h2 className="text-lg font-bold text-[var(--text-primary)] mb-5">
                {getSectionTitle()}
              </h2>
              {renderSectionContent()}
            </div>
          </div>
        </div>

        {dialogs}
      </div>
    );
  }

  // ===== 弹窗模式（保持旧逻辑） =====
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-[var(--surface-1)] rounded-2xl shadow-2xl max-w-4xl w-full border border-[var(--line-soft)] flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--line-soft)] shrink-0">
          <h2 className="text-xl font-bold text-[var(--text-primary)]">设置</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-[var(--surface-2)] rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <aside className="w-48 shrink-0 border-r border-[var(--line-soft)] bg-[var(--surface-2)]/72 p-2 space-y-1 overflow-y-auto">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left
                  ${
                    activeSection === id
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-3)]'
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
                <h3 className="text-lg font-bold text-[var(--text-primary)] mb-4">
                  {getSectionTitle()}
                </h3>
                {renderSectionContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
      {dialogs}
    </div>
  );
}
