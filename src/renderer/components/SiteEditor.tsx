/**
 * 输入: SiteEditorProps (站点数据、分组列表、保存/取消回调)
 * 输出: React 组件 (站点编辑器 UI)
 * 定位: 展示层 - 站点编辑器组件，支持智能添加和手动添加模式
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 *
 * @version 2.1.23
 * @updated 2026-02-27 - 移除自动刷新配置卡片，自动刷新统一由 SitesPage + AutoRefreshDialog 管理
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Globe, CheckCircle } from 'lucide-react';
import { SiteConfig } from '../App';
import { toast } from '../store/toastStore';
import { AppInput } from './AppInput';
import {
  DEFAULT_SITE_TYPE,
  SITE_TYPE_LABELS,
  SITE_TYPES,
  type SiteType,
} from '../../shared/types/site';

interface EditingAccountInfo {
  id: string;
  account_name?: string;
  user_id?: string;
  access_token?: string;
}

interface Props {
  site?: SiteConfig;
  editingAccount?: EditingAccountInfo | null;
  onSave: (
    site: SiteConfig,
    auth: { systemToken: string; userId: string; accountName?: string }
  ) => void | Promise<void>;
  onCancel: () => void;
  // 站点分组列表（来自 config.siteGroups）
  groups: { id: string; name: string }[];
  // 默认分组 ID（例如 "default"）
  defaultGroupId: string;
}

type Step = 'input-url' | 'fetching' | 'confirm';
// 新增：添加方式模式，auto=智能添加，manual=手动添加
type Mode = 'auto' | 'manual';

function buildInitialAutoInfo(site?: SiteConfig, editingAccount?: EditingAccountInfo | null) {
  return {
    name: site?.name || '',
    accountName: editingAccount?.account_name || '',
    apiKey: site?.api_key || '',
    systemToken: editingAccount?.access_token || site?.system_token || '',
    userId: editingAccount?.user_id || site?.user_id || '',
    balance: null as number | null,
    extraLinks: site?.extra_links || '',
    enableCheckin: site?.force_enable_checkin || false,
  };
}

function extractDetectedApiKey(payload: any): string {
  const directApiKey = typeof payload?.api_key === 'string' ? payload.api_key.trim() : '';
  if (directApiKey) {
    return directApiKey;
  }

  if (!Array.isArray(payload?.api_keys)) {
    return '';
  }

  for (const item of payload.api_keys) {
    const candidate =
      (typeof item?.key === 'string' ? item.key.trim() : '') ||
      (typeof item?.token === 'string' ? item.token.trim() : '');
    if (candidate) {
      return candidate;
    }
  }

  return '';
}

export function SiteEditor({
  site,
  editingAccount,
  onSave,
  onCancel,
  groups,
  defaultGroupId,
}: Props) {
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
  const [autoInfo, setAutoInfo] = useState(() => buildInitialAutoInfo(site, editingAccount));
  // 站点分组选择
  const [selectedGroupId, setSelectedGroupId] = useState<string>(site?.group || defaultGroupId);
  const [selectedSiteType, setSelectedSiteType] = useState<SiteType>(
    site?.site_type || DEFAULT_SITE_TYPE
  );
  const [hasDetectedSiteType, setHasDetectedSiteType] = useState<boolean>(!!site?.site_type);
  const [isSiteTypeEditing, setIsSiteTypeEditing] = useState<boolean>(false);

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

      const { user_id, site_name, access_token, supportsCheckIn, site_type } =
        siteAccountResult.data;
      const detectedApiKey = extractDetectedApiKey(siteAccountResult.data);
      if (!user_id) {
        throw new Error('初始化站点返回的数据中缺少用户ID');
      }

      // 保留原有的 extraLinks（重新获取信息时不丢失）
      setAutoInfo(prev => ({
        name: site_name || extractDomainName(finalUrl),
        accountName: prev.accountName,
        apiKey: detectedApiKey || prev.apiKey,
        systemToken: access_token || '',
        userId: String(user_id),
        balance: null,
        extraLinks: prev.extraLinks, // 保留原有加油站链接
        enableCheckin: supportsCheckIn === true,
      }));
      if (site_type) {
        setSelectedSiteType(site_type);
        setHasDetectedSiteType(true);
        setIsSiteTypeEditing(false);
      }

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

  const handleSave = async () => {
    // 构建站点配置，包含签到与加油站配置
    const newSite: SiteConfig = {
      name: autoInfo.name || extractDomainName(url),
      url: url.trim(),
      site_type: selectedSiteType,
      api_key: autoInfo.apiKey,
      system_token: autoInfo.systemToken,
      user_id: autoInfo.userId,
      enabled: site?.enabled ?? true,
      has_checkin: site?.has_checkin ?? false,
      extra_links: autoInfo.extraLinks, // 加油站链接
      force_enable_checkin: autoInfo.enableCheckin, // 用户勾选的签到功能
      // 分组信息（如果用户未选择则归入默认分组）
      group: selectedGroupId || defaultGroupId,
    };
    await onSave(newSite, {
      systemToken: autoInfo.systemToken,
      userId: autoInfo.userId,
      ...(editingAccount
        ? {
            accountName: autoInfo.accountName.trim() || editingAccount.account_name || '',
          }
        : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--overlay-mask)] backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-1)] shadow-[var(--shadow-xl)] md:max-w-3xl">
        {/* 头部：标题 + 添加方式切换 */}
        <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              {site ? '编辑站点' : mode === 'manual' ? '手动添加站点' : '智能添加站点'}
            </h2>
            {/* 新增站点时提供模式切换：智能添加（默认） / 手动添加 */}
            {!site && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="font-medium">添加方式：</span>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === 'auto'
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line-soft)] bg-transparent text-[var(--text-secondary)]'
                  }`}
                  onClick={() => {
                    // 切换回智能添加：回到浏览器引导流程
                    setMode('auto');
                    setStep('input-url');
                    setError('');
                    setIsSiteTypeEditing(false);
                  }}
                >
                  智能添加（默认）
                </button>
                <button
                  className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                    mode === 'manual'
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line-soft)] bg-transparent text-[var(--text-secondary)]'
                  }`}
                  onClick={() => {
                    // 切换为手动添加：直接进入确认/手动填写步骤
                    setMode('manual');
                    setStep('confirm');
                    setError('');
                    setIsSiteTypeEditing(true);
                  }}
                >
                  手动添加站点
                </button>
              </div>
            )}
          </div>
          <button
            onClick={onCancel}
            className="rounded-[var(--radius-md)] p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* 输入URL（仅智能添加模式使用） */}
          {mode === 'auto' && step === 'input-url' && (
            <div className="space-y-4">
              <div>
                <AppInput
                  type="url"
                  label="站点URL"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  error={!!error}
                  errorMessage={error}
                />
              </div>
              <button
                onClick={handleUrlSubmit}
                disabled={loading || !url.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--accent)] px-6 py-3 font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="space-y-5 rounded-[var(--radius-xl)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-6 py-10 text-center shadow-[var(--shadow-md)]">
                {/* 动态状态显示 */}
                <div className="flex items-center justify-center gap-3">
                  {statusMessage.startsWith('✅') ? (
                    <CheckCircle className="h-8 w-8 text-[var(--success)]" />
                  ) : (
                    <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                  )}
                  <span className="text-lg font-semibold text-[var(--text-primary)]">
                    {statusMessage || '准备中...'}
                  </span>
                </div>

                {/* 站点URL显示 */}
                <div className="text-sm text-[var(--text-secondary)]">
                  <span className="font-medium text-[var(--accent)]">{url}</span>
                </div>

                {/* 提示信息 */}
                {!statusMessage.startsWith('✅') && (
                  <p className="rounded-[var(--radius-md)] bg-[var(--surface-3)] px-4 py-2 text-xs text-[var(--text-secondary)]">
                    💡 如果账号未登录，请在浏览器中完成登录，系统会自动检测
                  </p>
                )}
              </div>
              {error && (
                <div className="rounded-[var(--radius-lg)] border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger)]">
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
                <div className="whitespace-pre-line rounded-[var(--radius-md)] border border-[var(--danger)]/35 bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    站点名称
                  </div>
                  <input
                    type="text"
                    value={autoInfo.name}
                    onChange={e => setAutoInfo({ ...autoInfo, name: e.target.value })}
                    className="flex-1 bg-transparent text-right text-sm font-medium text-[var(--text-primary)] outline-none"
                    placeholder="输入站点名称"
                  />
                </div>

                {site && editingAccount && (
                  <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                    <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                      账户名称
                    </div>
                    <input
                      type="text"
                      value={autoInfo.accountName}
                      onChange={e => setAutoInfo({ ...autoInfo, accountName: e.target.value })}
                      className="flex-1 bg-transparent text-right text-sm font-medium text-[var(--text-primary)] outline-none"
                      placeholder="输入账户名称"
                    />
                  </div>
                )}

                {/* 站点分组选择 */}
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    站点分组
                  </div>
                  <div className="flex-1 flex justify-end">
                    <select
                      value={selectedGroupId}
                      onChange={e => setSelectedGroupId(e.target.value)}
                      className="w-32 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
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

                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    站点类型
                  </div>
                  <div className="flex flex-1 justify-end">
                    {mode === 'manual' || !hasDetectedSiteType || isSiteTypeEditing ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedSiteType}
                          onChange={e => setSelectedSiteType(e.target.value as SiteType)}
                          className="w-36 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
                        >
                          {SITE_TYPES.map(siteType => (
                            <option key={siteType} value={siteType}>
                              {SITE_TYPE_LABELS[siteType]}
                            </option>
                          ))}
                        </select>
                        {hasDetectedSiteType && (
                          <button
                            type="button"
                            onClick={() => setIsSiteTypeEditing(false)}
                            className="text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                          >
                            使用识别结果
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2.5 py-1 text-sm font-medium text-[var(--accent)]">
                          {SITE_TYPE_LABELS[selectedSiteType]}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsSiteTypeEditing(true)}
                          className="text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                        >
                          修改类型
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    站点URL
                  </div>
                  {isEditing || mode === 'manual' ? (
                    <input
                      type="url"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      className="flex-1 bg-transparent text-right text-sm font-medium text-[var(--text-primary)] outline-none"
                      placeholder="https://api.example.com"
                    />
                  ) : (
                    <div className="flex-1 break-all text-right text-sm font-medium text-[var(--text-primary)]">
                      {url}
                    </div>
                  )}
                </div>
                {site && editingAccount && (
                  <div className="rounded-[var(--radius-md)] border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--accent)]">
                    当前优先编辑账户级凭证：{editingAccount.account_name || editingAccount.id}
                  </div>
                )}
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    用户ID
                  </div>
                  <input
                    type="text"
                    value={autoInfo.userId}
                    onChange={e => setAutoInfo({ ...autoInfo, userId: e.target.value })}
                    className="flex-1 bg-transparent text-right font-mono text-sm font-semibold text-[var(--text-primary)] outline-none"
                    placeholder="输入用户ID"
                  />
                </div>
                <div className="rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                      Access Token
                    </span>
                    <div className="flex-1 flex justify-end">
                      {autoInfo.systemToken ? (
                        <div className="flex items-center gap-1.5 w-full justify-end">
                          <div className="flex-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-right font-mono text-sm text-[var(--text-primary)]">
                            {showToken ? autoInfo.systemToken : maskToken(autoInfo.systemToken)}
                          </div>
                          <button
                            onClick={() => setShowToken(!showToken)}
                            className="whitespace-nowrap px-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-strong)]"
                          >
                            {showToken ? '隐藏' : '显示'}
                          </button>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(autoInfo.systemToken);
                              toast.success('Access Token 已复制到剪贴板');
                            }}
                            className="rounded-[var(--radius-sm)] p-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
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
                          className="w-full bg-transparent text-right text-sm font-medium text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                        />
                      )}
                    </div>
                  </div>
                  {/* 仅在智能添加模式下提示自动获取失败，手动添加模式不再显示此提醒 */}
                  {!autoInfo.systemToken && mode === 'auto' && (
                    <div className="mt-1.5 rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-2 py-1 text-xs font-medium text-[var(--warning)]">
                      ⚠️ 无法自动获取 Access Token，请点击"重新获取"或手动填入
                    </div>
                  )}
                </div>

                {/* 加油站链接输入区域 */}
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    加油站链接
                    <span className="ml-1 font-normal text-[var(--text-tertiary)]">(可选)</span>
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
                    className="flex-1 bg-transparent text-right font-mono text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none"
                    placeholder="https://example.com/lottery"
                  />
                </div>

                {/* 签到功能开关 */}
                <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2">
                  <div className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    启用签到功能
                    <span className="ml-1 font-normal text-[var(--text-tertiary)]">(可选)</span>
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
                      className="w-20 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
                    >
                      <option value="disabled">禁用</option>
                      <option value="enabled">启用</option>
                    </select>
                  </div>
                </div>

                {/* 仅在智能添加模式下展示自动获取状态提示，手动添加模式不显示此文案 */}
                {!site && mode === 'auto' && (
                  <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--success)]/30 bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
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
                    className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--warning)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-92"
                  >
                    <Globe className="w-4 h-4" />
                    重新获取信息
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={!autoInfo.name || !url || !autoInfo.systemToken || !autoInfo.userId}
                  className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
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
