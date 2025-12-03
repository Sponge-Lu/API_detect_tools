import type { SiteConfig } from '../../App';

interface AuthErrorSite {
  name: string;
  url: string;
  error: string;
}

interface AuthErrorDialogProps {
  sites: AuthErrorSite[];
  configSites: SiteConfig[];
  onClose: () => void;
  onEditSite: (siteIndex: number, siteName: string) => void;
  onProcessAll: () => void;
}

export function AuthErrorDialog({
  sites,
  configSites,
  onClose,
  onEditSite,
  onProcessAll,
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
                Access Token 需要更新
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {sites.length === 1
                  ? '检测到 1 个站点的 Token 已过期或无效'
                  : `检测到 ${sites.length} 个站点的 Token 已过期或无效`}
              </p>
            </div>
          </div>
        </div>

        {/* 站点列表 */}
        <div className="px-5 py-4 max-h-64 overflow-y-auto">
          <div className="space-y-2">
            {sites.map((site, index) => {
              const siteIndex = configSites.findIndex(s => s.name === site.name);
              return (
                <div
                  key={index}
                  className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                >
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {site.name}
                    </p>
                    <p
                      className="text-xs text-red-500 dark:text-red-400 truncate"
                      title={site.error}
                    >
                      {site.error.length > 50 ? site.error.substring(0, 50) + '...' : site.error}
                    </p>
                  </div>
                  {siteIndex !== -1 && (
                    <button
                      onClick={() => onEditSite(siteIndex, site.name)}
                      className="px-3 py-1.5 text-xs font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-colors whitespace-nowrap"
                    >
                      重新获取
                    </button>
                  )}
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
