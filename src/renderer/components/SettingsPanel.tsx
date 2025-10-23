import { useState } from "react";
import { X } from "lucide-react";
import { Settings } from "../App";

interface SettingsPanelProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
}

export function SettingsPanel({
  settings,
  onSave,
  onCancel,
}: SettingsPanelProps) {
  const [formData, setFormData] = useState<Settings>(settings);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full border border-white/10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-xl font-bold">设置</h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-white/10 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* 超时设置 */}
          <div>
            <label className="block text-sm font-medium mb-2">
              请求超时时间 (秒)
            </label>
            <input
              type="number"
              min="1"
              max="60"
              value={formData.timeout}
              onChange={(e) =>
                setFormData({ ...formData, timeout: Number(e.target.value) })
              }
              className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all"
            />
            <p className="text-xs text-gray-400 mt-1">
              每个站点的最大等待时间
            </p>
          </div>

          {/* 并发检测 */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="concurrent"
              checked={formData.concurrent}
              onChange={(e) =>
                setFormData({ ...formData, concurrent: e.target.checked })
              }
              className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-primary-600"
            />
            <div className="flex-1">
              <label htmlFor="concurrent" className="text-sm font-medium block">
                并发检测
              </label>
              <p className="text-xs text-gray-400 mt-1">
                同时检测所有站点，速度更快但占用资源更多
              </p>
            </div>
          </div>

          {/* 显示禁用站点 */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="show_disabled"
              checked={formData.show_disabled}
              onChange={(e) =>
                setFormData({ ...formData, show_disabled: e.target.checked })
              }
              className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-primary-600"
            />
            <div className="flex-1">
              <label
                htmlFor="show_disabled"
                className="text-sm font-medium block"
              >
                显示禁用的站点
              </label>
              <p className="text-xs text-gray-400 mt-1">
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
              onChange={(e) =>
                setFormData({ ...formData, auto_refresh: e.target.checked })
              }
              className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-primary-600"
            />
            <div className="flex-1">
              <label
                htmlFor="auto_refresh"
                className="text-sm font-medium block"
              >
                自动刷新
              </label>
              <p className="text-xs text-gray-400 mt-1">
                定时自动检测所有站点
              </p>
            </div>
          </div>

          {/* 刷新间隔 */}
          {formData.auto_refresh && (
            <div>
              <label className="block text-sm font-medium mb-2">
                刷新间隔 (分钟)
              </label>
              <input
                type="number"
                min="1"
                max="1440"
                value={formData.refresh_interval || 30}
                onChange={(e) =>
                  setFormData({ ...formData, refresh_interval: Number(e.target.value) })
                }
                className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all"
              />
              <p className="text-xs text-gray-400 mt-1">
                每 {formData.refresh_interval || 30} 分钟自动检测一次
              </p>
            </div>
          )}

          {/* 按钮 */}
          <div className="flex items-center gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-all border border-white/10"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg transition-all font-semibold"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
