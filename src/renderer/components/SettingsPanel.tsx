import { useState, useRef } from 'react';
import { X, Sun, Moon, Monitor, Download, Upload } from 'lucide-react';
import { Settings, Config } from '../App';
import { useTheme } from '../hooks/useTheme';
import { toast } from '../store/toastStore';

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
  config?: Config;
  onImport?: (config: Config) => void;
}

// 导出格式版本
const EXPORT_VERSION = '1.0';

export function SettingsPanel({
  settings,
  onSave,
  onCancel,
  config,
  onImport,
}: SettingsPanelProps) {
  const [formData, setFormData] = useState<Settings>(settings);
  const { themeMode, changeThemeMode } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        api_key: s.api_key,
        enabled: s.enabled,
        group: s.group,
        has_checkin: s.has_checkin,
        force_enable_checkin: s.force_enable_checkin,
        extra_links: s.extra_links,
        // 新架构：导出完整认证信息
        system_token: s.system_token,
        user_id: s.user_id,
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
          {/* 主题设置 */}
          <div>
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
            <div className="mt-3 flex items-start gap-3">
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

          {/* 自动刷新设置 */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="auto_refresh"
              checked={formData.auto_refresh || false}
              onChange={e => setFormData({ ...formData, auto_refresh: e.target.checked })}
              className="mt-1 w-4 h-4 rounded border-light-border dark:border-dark-border text-primary-600 focus:ring-primary-500"
            />
            <div className="flex-1">
              <label
                htmlFor="auto_refresh"
                className="text-sm font-medium block text-light-text dark:text-dark-text cursor-pointer"
              >
                自动刷新
              </label>
              <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                定时自动检测所有站点
              </p>
            </div>
          </div>

          {/* 刷新间隔 */}
          {formData.auto_refresh && (
            <div>
              <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
                刷新间隔 (分钟)
              </label>
              <input
                type="number"
                min="1"
                max="1440"
                value={formData.refresh_interval || 30}
                onChange={e =>
                  setFormData({ ...formData, refresh_interval: Number(e.target.value) })
                }
                className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text"
              />
              <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
                每 {formData.refresh_interval || 30} 分钟自动检测一次
              </p>
            </div>
          )}

          {/* 浏览器路径设置 */}
          <div>
            <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
              浏览器路径（可选）
            </label>
            <input
              type="text"
              value={formData.browser_path || ''}
              onChange={e => setFormData({ ...formData, browser_path: e.target.value })}
              placeholder="例如：C:\PortableApps\Chrome\chrome.exe，留空则自动检测 Chrome / Edge"
              className="w-full px-4 py-2 bg-light-bg dark:bg-dark-bg border border-light-border dark:border-dark-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 outline-none transition-all text-light-text dark:text-dark-text"
            />
            <p className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-1">
              当需要使用 Edge 或便携版 Chrome 等自定义 Chromium
              浏览器时，可在此填写其可执行文件路径；留空则从系统自动查找 Chrome / Edge。
            </p>
          </div>

          {/* 导入导出 */}
          {config && onImport && (
            <div>
              <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-3">
                数据管理
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex-1 px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium"
                >
                  <Download className="w-4 h-4" />
                  导出配置
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all flex items-center justify-center gap-2 font-medium"
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
    </div>
  );
}
