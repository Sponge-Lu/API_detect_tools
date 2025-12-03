import { useState, useEffect } from 'react';
import { X, Loader2, Globe, CheckCircle } from 'lucide-react';
import { SiteConfig } from '../App';
import { toast } from '../store/toastStore';

interface Props {
  site?: SiteConfig;
  onSave: (site: SiteConfig) => void;
  onCancel: () => void;
  // 站点分组列表（来自 config.siteGroups）
  groups: { id: string; name: string }[];
  // 默认分组 ID（例如 "default"）
  defaultGroupId: string;
}

type Step = 'input-url' | 'fetching' | 'confirm';
// 新增：添加方式模式，auto=智能添加，manual=手动添加
type Mode = 'auto' | 'manual';

export function SiteEditor({ site, onSave, onCancel, groups, defaultGroupId }: Props) {
  // 编辑模式下直接跳到确认步骤，新增模式从输入URL开始
  const [step, setStep] = useState<Step>(site ? 'confirm' : 'input-url');
  const [mode, setMode] = useState<Mode>('auto'); // 当前添加模式
  const [url, setUrl] = useState(site?.url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState(''); // 动态状态消息
  const [showToken, setShowToken] = useState(false); // 控制令牌显示/隐藏
  const isEditing = !!site; // 判断是否为编辑模式
  // 自动/手动共用的信息结构
  const [autoInfo, setAutoInfo] = useState({
    name: site?.name || '',
    apiKey: site?.api_key || '',
    systemToken: site?.system_token || '',
    userId: site?.user_id || '',
    balance: null as number | null,
    extraLinks: site?.extra_links || '', // 加油站链接
    enableCheckin: site?.force_enable_checkin || false, // 启用签到功能
  });
  // 站点分组选择
  const [selectedGroupId, setSelectedGroupId] = useState<string>(site?.group || defaultGroupId);

  // 监听后端发送的状态更新事件
  useEffect(() => {
    const cleanup = (window.electronAPI as any).onSiteInitStatus?.((status: string) => {
      setStatusMessage(status);
    });
    return () => cleanup?.();
  }, []);

  const maskToken = (token: string): string => {
    if (!token) return '';
    if (token.length <= 8) return '***';
    return `${token.substring(0, 3)}...${token.substring(token.length - 4)}`;
  };

  // URL 严格校验与归一化逻辑（保留 PR 中的改动）
  const isValidUrlStrict = (value: string): boolean => {
    try {
      const u = new URL(value.trim());
      if (!u.protocol || !/^https?:$/.test(u.protocol)) return false;
      if (!u.hostname) return false;
      return true;
    } catch {
      return false;
    }
  };

  const normalizeUrl = (value: string): string => {
    let v = (value || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  };

  const handleUrlSubmit = async () => {
    if (!url.trim()) {
      setError('请输入站点URL');
      return;
    }
    const finalUrl = normalizeUrl(url);
    if (!isValidUrlStrict(finalUrl)) {
      setError('URL格式不合法，请输入形如 https://example.com 的地址');
      return;
    }
    setUrl(finalUrl);
    setLoading(true);
    setError('');
    setStatusMessage('正在启动浏览器...');
    setStep('fetching');

    try {
      // 启动浏览器
      const result = await window.electronAPI.launchChromeForLogin(finalUrl);
      if (!result.success) {
        setError(result.message);
        setStatusMessage('');
        setStep('input-url');
        setLoading(false);
        return;
      }

      setStatusMessage('浏览器已启动，正在检测登录状态...');

      // 浏览器启动成功后，直接获取站点信息（系统会自动检测登录状态）
      // 后端会自动等待用户登录
      const siteAccountResult = (await (window.electronAPI as any).token.initializeSite(
        finalUrl
      )) as any;

      if (!siteAccountResult.success) {
        throw new Error(siteAccountResult.error || '初始化站点失败');
      }

      setStatusMessage('✅ 信息获取成功！');

      const { user_id, site_name, access_token, supportsCheckIn } = siteAccountResult.data;
      if (!user_id) {
        throw new Error('初始化站点返回的数据中缺少用户ID');
      }

      // 保留原有的 extraLinks（重新获取信息时不丢失）
      setAutoInfo(prev => ({
        name: site_name || extractDomainName(finalUrl),
        apiKey: prev.apiKey, // 保留原有 apiKey
        systemToken: access_token || '',
        userId: String(user_id),
        balance: null,
        extraLinks: prev.extraLinks, // 保留原有加油站链接
        enableCheckin: supportsCheckIn === true,
      }));

      // 短暂显示成功消息后进入确认页
      setTimeout(() => {
        setStep('confirm');
        setStatusMessage('');
      }, 800);
    } catch (err: any) {
      // 失败时允许用户继续在确认页手动填写
      setError('获取站点信息失败: ' + err.message);
      setStatusMessage('');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  const extractDomainName = (u: string): string => {
    try {
      const urlObj = new URL(u);
      const hostname = urlObj.hostname.replace('www.', '');
      const parts = hostname.split('.');
      if (parts.length >= 2) return parts.length > 2 ? parts[parts.length - 2] : parts[0];
      return hostname;
    } catch {
      return '新站点';
    }
  };

  const handleSave = () => {
    // 构建站点配置，包含签到与加油站配置
    const newSite: SiteConfig = {
      name: autoInfo.name || extractDomainName(url),
      url: url.trim(),
      api_key: autoInfo.apiKey,
      system_token: autoInfo.systemToken,
      user_id: autoInfo.userId,
      enabled: true,
      has_checkin: false,
      extra_links: autoInfo.extraLinks, // 加油站链接
      force_enable_checkin: autoInfo.enableCheckin, // 用户勾选的签到功能
      // 分组信息（如果用户未选择则归入默认分组）
      group: selectedGroupId || defaultGroupId,
    };
    onSave(newSite);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-light-card dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-2xl md:max-w-3xl border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col">
        {/* 头部：标题 + 添加方式切换 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-bold">
              {site ? '编辑站点' : mode === 'manual' ? '手动添加站点' : '智能添加站点'}
            </h2>
            {/* 新增站点时提供模式切换：智能添加（默认） / 手动添加 */}
            {!site && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">添加方式：</span>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === 'auto'
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-transparent text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                  }`}
                  onClick={() => {
                    // 切换回智能添加：回到浏览器引导流程
                    setMode('auto');
                    setStep('input-url');
                    setError('');
                  }}
                >
                  智能添加（默认）
                </button>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === 'manual'
                      ? 'bg-primary-500 text-white border-primary-500'
                      : 'bg-transparent text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                  }`}
                  onClick={() => {
                    // 切换为手动添加：直接进入确认/手动填写步骤
                    setMode('manual');
                    setStep('confirm');
                    setError('');
                  }}
                >
                  手动添加站点
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* 输入URL（仅智能添加模式使用） */}
          {mode === 'auto' && step === 'input-url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-light-text dark:text-dark-text mb-2">
                  站点URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-4 py-3 bg-white dark:bg-dark-bg border-2 border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-light-text dark:text-dark-text placeholder-slate-400 dark:placeholder-slate-500"
                />
              </div>
              {error && (
                <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-600 rounded-lg text-red-700 dark:text-red-300 text-sm font-medium">
                  {error}
                </div>
              )}
              <button
                onClick={handleUrlSubmit}
                disabled={loading || !url.trim()}
                className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                    获取中...
                  </>
                ) : (
                  <>
                    <Globe className="w-5 h-5 text-white" />
                    获取信息
                  </>
                )}
              </button>
            </div>
          )}

          {/* 获取信息中（仅智能添加模式使用） */}
          {mode === 'auto' && step === 'fetching' && (
            <div className="space-y-4">
              <div className="px-6 py-10 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-300 dark:border-slate-600 text-center space-y-5 shadow-md">
                {/* 动态状态显示 */}
                <div className="flex items-center justify-center gap-3">
                  {statusMessage.startsWith('✅') ? (
                    <CheckCircle className="w-8 h-8 text-green-500" />
                  ) : (
                    <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                  )}
                  <span className="text-lg font-semibold text-slate-800 dark:text-white">
                    {statusMessage || '准备中...'}
                  </span>
                </div>

                {/* 站点URL显示 */}
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  <span className="text-primary-600 dark:text-primary-400 font-medium">{url}</span>
                </div>

                {/* 提示信息 */}
                {!statusMessage.startsWith('✅') && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-200/50 dark:bg-slate-700/50 px-4 py-2 rounded-lg">
                    💡 如果账号未登录，请在浏览器中完成登录，系统会自动检测
                  </p>
                )}
              </div>
              {error && (
                <div className="px-4 py-3 bg-red-500/30 border border-red-500/60 rounded-lg text-red-700 dark:text-red-200 text-sm font-medium">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* 步骤4：确认信息（智能添加完成后或手动添加模式下使用） */}
          {step === 'confirm' && (
            <div className="space-y-2">
              {/* 通用错误提示：包括从自动获取流程返回的手动填写提示 */}
              {error && (
                <div className="px-3 py-2 bg-red-500/20 border border-red-500/60 rounded-lg text-red-100 text-xs whitespace-pre-line">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    站点名称
                  </div>
                  <input
                    type="text"
                    value={autoInfo.name}
                    onChange={e => setAutoInfo({ ...autoInfo, name: e.target.value })}
                    className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right text-sm"
                    placeholder="输入站点名称"
                  />
                </div>

                {/* 站点分组选择 */}
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    站点分组
                  </div>
                  <div className="flex-1 flex justify-end">
                    <select
                      value={selectedGroupId}
                      onChange={e => setSelectedGroupId(e.target.value)}
                      className="w-32 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-100"
                    >
                      {(groups && groups.length > 0
                        ? groups
                        : [{ id: defaultGroupId, name: '默认分组' }]
                      ).map(g => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    站点URL
                  </div>
                  {isEditing || mode === 'manual' ? (
                    <input
                      type="url"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-medium text-right text-sm"
                      placeholder="https://api.example.com"
                    />
                  ) : (
                    <div className="flex-1 text-slate-800 dark:text-slate-100 break-all font-medium text-right text-sm">
                      {url}
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    用户ID
                  </div>
                  <input
                    type="text"
                    value={autoInfo.userId}
                    onChange={e => setAutoInfo({ ...autoInfo, userId: e.target.value })}
                    className="flex-1 bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 font-mono text-sm font-semibold text-right"
                    placeholder="输入用户ID"
                  />
                </div>
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                      Access Token
                    </span>
                    <div className="flex-1 flex justify-end">
                      {autoInfo.systemToken ? (
                        <div className="flex items-center gap-1.5 w-full justify-end">
                          <div className="flex-1 text-sm text-slate-800 dark:text-slate-100 font-mono bg-white dark:bg-slate-900 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 text-right">
                            {showToken ? autoInfo.systemToken : maskToken(autoInfo.systemToken)}
                          </div>
                          <button
                            onClick={() => setShowToken(!showToken)}
                            className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors font-medium whitespace-nowrap px-1.5"
                          >
                            {showToken ? '隐藏' : '显示'}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(autoInfo.systemToken);
                              toast.success('Access Token 已复制到剪贴板');
                            }}
                            className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                            title="复制"
                          >
                            📋
                          </button>
                        </div>
                      ) : (
                        <input
                          type="password"
                          value={autoInfo.systemToken}
                          onChange={e =>
                            setAutoInfo({
                              ...autoInfo,
                              systemToken: e.target.value,
                            })
                          }
                          placeholder="请手动填入 Access Token"
                          className="w-full bg-transparent border-none outline-none text-slate-800 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 font-medium text-right text-sm"
                        />
                      )}
                    </div>
                  </div>
                  {/* 仅在智能添加模式下提示自动获取失败，手动添加模式不再显示此提醒 */}
                  {!autoInfo.systemToken && mode === 'auto' && (
                    <div className="text-xs text-yellow-700 dark:text-yellow-400 mt-1.5 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded border border-yellow-200 dark:border-yellow-800 font-medium">
                      ⚠️ 无法自动获取 Access Token，请点击"重新获取"或手动填入
                    </div>
                  )}
                </div>

                {/* 加油站链接输入区域 */}
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    加油站链接
                    <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">
                      (可选)
                    </span>
                  </div>
                  <input
                    type="url"
                    value={autoInfo.extraLinks}
                    onChange={e =>
                      setAutoInfo({
                        ...autoInfo,
                        extraLinks: e.target.value,
                      })
                    }
                    className="flex-1 bg-transparent border-none outline-none text-light-text dark:text-dark-text font-mono text-sm placeholder-slate-400 dark:placeholder-slate-500 text-right"
                    placeholder="https://example.com/lottery"
                  />
                </div>

                {/* 签到功能开关 */}
                <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                  <div className="text-sm text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap">
                    启用签到功能
                    <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">
                      (可选)
                    </span>
                  </div>
                  <div className="flex-1 flex justify-end">
                    <select
                      value={autoInfo.enableCheckin ? 'enabled' : 'disabled'}
                      onChange={e =>
                        setAutoInfo({
                          ...autoInfo,
                          enableCheckin: e.target.value === 'enabled',
                        })
                      }
                      className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm text-slate-800 dark:text-slate-100"
                    >
                      <option value="disabled">禁用</option>
                      <option value="enabled">启用</option>
                    </select>
                  </div>
                </div>

                {/* 仅在智能添加模式下展示自动获取状态提示，手动添加模式不显示此文案 */}
                {!site && mode === 'auto' && (
                  <div className="px-3 py-2 bg-green-500/20 border border-green-500/50 rounded-lg text-green-700 dark:text-green-300 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="font-semibold">
                      {autoInfo.systemToken ? '信息已自动获取' : '请手动填入 Access Token'}
                      ，点击保存即可完成添加
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                {(mode === 'auto' || site) && (
                  <button
                    onClick={() => {
                      // 返回到input-url步骤重新开始流程
                      setStep('input-url');
                      setError('');
                    }}
                    className="flex-1 px-4 py-2.5 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-all text-sm"
                  >
                    <Globe className="w-4 h-4" />
                    重新获取信息
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={!autoInfo.name || !url || !autoInfo.systemToken || !autoInfo.userId}
                  className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm"
                >
                  <CheckCircle className="w-4 h-4" />
                  {site ? '保存修改' : '保存站点'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SiteEditor;
