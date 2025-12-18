import type { SiteConfig } from '../../App';

interface AuthErrorSite {
  name: string;
  url: string;
  error: string;
}

/**
 * 分析错误类型，帮助用户理解问题根源
 *
 * 三种典型情况：
 * 1. Session 过期：API 返回成功但无数据，说明 token 被接受但 session 失效
 * 2. Access Token 失效：API 返回 401，说明 token 本身已过期或被撤销
 * 3. 权限不足：API 返回 403，说明账号状态异常
 */
function analyzeErrorType(error: string): { type: string; icon: string; description: string } {
  // Session 过期（API 返回成功但无数据）
  // 这说明 access_token 仍有效（API 接受了请求），但服务端 Session 已失效
  if (error.includes('返回成功但无数据') || error.includes('登录可能已过期')) {
    return {
      type: '会话过期',
      icon: '⏰',
      description: 'Token 有效但服务端会话(Session)已过期，重新登录即可恢复',
    };
  }

  // Access Token 失效
  if (
    error.includes('status code 401') ||
    error.includes('登录已过期') ||
    error.includes('未登录')
  ) {
    return {
      type: 'Token 失效',
      icon: '🔑',
      description: 'Access Token 已过期或被撤销，需要重新登录获取新 Token',
    };
  }

  // 权限不足
  if (error.includes('status code 403') || error.includes('权限不足')) {
    return {
      type: '权限不足',
      icon: '🚫',
      description: '账号权限受限或状态异常，请在浏览器中检查站点账号情况',
    };
  }

  // 默认情况
  return {
    type: '认证异常',
    icon: '⚠️',
    description: '认证信息可能已失效，请重新登录站点',
  };
}

interface AuthErrorDialogProps {
  sites: AuthErrorSite[];
  configSites: SiteConfig[];
  onClose: () => void;
  onEditSite: (siteIndex: number, siteName: string) => void;
  onProcessAll: () => void;
  onForceRefresh: (siteIndex: number, siteName: string) => void;
  onOpenSite: (url: string) => void;
}

export function AuthErrorDialog({
  sites,
  configSites,
  onClose,
  onEditSite,
  onProcessAll,
  onForceRefresh,
  onOpenSite,
}: AuthErrorDialogProps) {
  if (sites.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 标题栏 */}
        <div className="px-5 py-4 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <span className="text-xl">🔑</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                站点认证需要更新
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {sites.length === 1
                  ? '检测到 1 个站点的登录已过期或凭证失效'
                  : `检测到 ${sites.length} 个站点的登录已过期或凭证失效`}
              </p>
            </div>
          </div>
        </div>

        {/* 站点列表 */}
        <div className="px-5 py-4 max-h-80 overflow-y-auto">
          <div className="space-y-3">
            {sites.map((site, index) => {
              const siteIndex = configSites.findIndex(s => s.name === site.name);
              const errorAnalysis = analyzeErrorType(site.error);
              return (
                <div key={index} className="px-3 py-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{errorAnalysis.icon}</span>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {site.name}
                      </p>
                      <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
                        {errorAnalysis.type}
                      </span>
                    </div>
                    {siteIndex !== -1 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => onForceRefresh(siteIndex, site.name)}
                          className="px-2.5 py-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors whitespace-nowrap"
                          title="确认站点数据确实为空，强制更新（不重新登录）"
                        >
                          真·空数据
                        </button>
                        <button
                          onClick={() => onEditSite(siteIndex, site.name)}
                          className="px-2.5 py-1.5 text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors whitespace-nowrap"
                        >
                          重新获取
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 flex-wrap">
                    <span>💡 请先</span>
                    <button
                      onClick={() => onOpenSite(site.url)}
                      className="text-primary-500 hover:text-primary-600 underline font-medium"
                    >
                      打开站点
                    </button>
                    <span>确认数据状态，再选择操作</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3 bg-slate-50 dark:bg-slate-800/30 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            稍后处理
          </button>
          {sites.length > 1 && (
            <button
              onClick={onProcessAll}
              className="px-4 py-2 text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors"
            >
              逐个处理
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
