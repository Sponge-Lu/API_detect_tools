import { useState } from "react";
import { X, Copy, Check } from "lucide-react";
import { SiteConfig } from "../App";

interface SiteEditorProps {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
}

export function SiteEditor({ site, onSave, onCancel }: SiteEditorProps) {
  const [formData, setFormData] = useState<SiteConfig>(
    site || {
      name: "",
      url: "",
      api_key: "",
      system_token: "",
      user_id: "",
      enabled: true,
      has_checkin: false,
    }
  );
  
  const [copiedApiKey, setCopiedApiKey] = useState(false);
  const [copiedSystemToken, setCopiedSystemToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // 复制到剪贴板
  const copyToClipboard = async (text: string, type: 'api' | 'system' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'api') {
        setCopiedApiKey(true);
        setTimeout(() => setCopiedApiKey(false), 2000);
      } else if (type === 'system') {
        setCopiedSystemToken(true);
        setTimeout(() => setCopiedSystemToken(false), 2000);
      } else {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      }
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  // 显示头尾的格式化函数
  const maskToken = (token: string) => {
    if (!token || token.length <= 16) return token;
    return `${token.substring(0, 8)}...${token.substring(token.length - 8)}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.url || !formData.api_key) {
      alert("请填写必填项");
      return;
    }
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full border border-white/10">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-xl font-bold">
            {site ? "编辑站点" : "添加站点"}
          </h2>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-white/10 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 站点名称 */}
          <div>
            <label className="block text-sm font-medium mb-2">
              站点名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all"
              placeholder="例如: OpenAI 公益站"
              required
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium mb-2">
              站点 URL <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="url"
                value={formData.url}
                onChange={(e) =>
                  setFormData({ ...formData, url: e.target.value })
                }
                className="w-full px-4 py-2 pr-12 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all"
                placeholder="https://api.example.com"
                required
              />
              {formData.url && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(formData.url, 'url')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded transition-all"
                  title="复制URL"
                >
                  {copiedUrl ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              )}
            </div>
          </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium mb-2">
                API Key <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.api_key ? maskToken(formData.api_key) : ''}
                  onChange={(e) => {
                    // 只有在输入的不是masked版本时才更新
                    const input = e.target.value;
                    if (!input.includes('...')) {
                      setFormData({ ...formData, api_key: input });
                    }
                  }}
                  onFocus={(e) => {
                    // 聚焦时显示完整内容
                    if (formData.api_key) {
                      e.target.value = formData.api_key;
                    }
                  }}
                  onBlur={(e) => {
                    // 失焦时显示masked版本
                    if (formData.api_key) {
                      e.target.value = maskToken(formData.api_key);
                    }
                  }}
                  className="w-full px-4 py-2 pr-12 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all font-mono text-sm"
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  required
                />
                {formData.api_key && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(formData.api_key, 'api')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded transition-all"
                    title="复制API Key"
                  >
                    {copiedApiKey ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* System Token (可选) */}
            <div>
              <label className="block text-sm font-medium mb-2">
                System Token (可选)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.system_token ? maskToken(formData.system_token) : ''}
                  onChange={(e) => {
                    const input = e.target.value;
                    if (!input.includes('...')) {
                      setFormData({ ...formData, system_token: input });
                    }
                  }}
                  onFocus={(e) => {
                    if (formData.system_token) {
                      e.target.value = formData.system_token;
                    }
                  }}
                  onBlur={(e) => {
                    if (formData.system_token) {
                      e.target.value = maskToken(formData.system_token);
                    }
                  }}
                  className="w-full px-4 py-2 pr-12 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all font-mono text-sm"
                  placeholder="sat-xxxxxxxxxxxxxxxxxxxxxxxx"
                />
                {formData.system_token && formData.system_token.length > 16 && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(formData.system_token!, 'system')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-white/10 rounded transition-all"
                    title="复制System Token"
                  >
                    {copiedSystemToken ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                用于系统管理员查询账户总信息
              </p>
            </div>

          {/* User ID (可选) */}
          <div>
            <label className="block text-sm font-medium mb-2">
              User ID (可选)
            </label>
            <input
              type="text"
              value={formData.user_id || ""}
              onChange={(e) =>
                setFormData({ ...formData, user_id: e.target.value })
              }
              className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/50 outline-none transition-all"
              placeholder="123"
            />
            <p className="text-xs text-gray-400 mt-1">
              使用System Token时需要指定用户ID
            </p>
          </div>

          {/* 启用状态 */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) =>
                setFormData({ ...formData, enabled: e.target.checked })
              }
              className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-primary-600"
            />
            <label htmlFor="enabled" className="text-sm font-medium">
              启用此站点
            </label>
          </div>

          {/* 签到功能 */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="has_checkin"
              checked={formData.has_checkin || false}
              onChange={(e) =>
                setFormData({ ...formData, has_checkin: e.target.checked })
              }
              className="w-4 h-4 rounded border-white/20 bg-white/5 checked:bg-yellow-600"
            />
            <label htmlFor="has_checkin" className="text-sm font-medium">
              该站点支持签到功能（勾选后会显示提醒图标）
            </label>
          </div>

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

