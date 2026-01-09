/**
 * 输入: HeaderProps (保存状态、更新状态、设置回调、LDC 站点列表、下载更新回调)
 * 输出: React 组件 (应用头部 UI)
 * 定位: 展示层 - 应用头部组件，包含 Logo、标题、Credit 面板、保存状态、下载更新按钮和设置按钮
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/Header/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { Settings, Loader2, Download } from 'lucide-react';
import Logo from '../../assets/logo.svg';
import { CreditPanelCompact, type LdcSiteInfo } from '../CreditPanel';
import type { UpdateCheckResult } from '../../hooks/useUpdate';

interface HeaderProps {
  saving: boolean;
  hasUpdate?: boolean;
  onOpenSettings: () => void;
  /** 支持 LDC 支付的站点列表 */
  ldcSites?: LdcSiteInfo[];
  /** 更新检查结果信息 */
  updateInfo?: UpdateCheckResult | null;
  /** 下载更新回调 */
  onDownloadUpdate?: () => Promise<void>;
  /** 是否正在下载 */
  isDownloading?: boolean;
}

export function Header({
  saving,
  hasUpdate,
  onOpenSettings,
  ldcSites = [],
  updateInfo,
  onDownloadUpdate,
  isDownloading = false,
}: HeaderProps) {
  // 判断是否显示下载按钮：有更新且有下载链接
  const showDownloadButton = updateInfo?.hasUpdate && updateInfo?.releaseInfo?.downloadUrl;
  const newVersion = updateInfo?.releaseInfo?.version || updateInfo?.latestVersion;

  // 处理下载按钮点击
  const handleDownloadClick = async () => {
    if (onDownloadUpdate && !isDownloading) {
      await onDownloadUpdate();
    }
  };

  return (
    <header className="relative z-[100] bg-white/80 dark:bg-dark-card/80 backdrop-blur-md border-b border-light-border dark:border-dark-border px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="relative w-10 h-10 flex items-center justify-center">
            <img
              src={Logo}
              alt="API Hub Management Tools logo"
              className="w-10 h-10 object-contain select-none"
              draggable={false}
            />
          </div>
          <div>
            <h1 className="text-lg font-bold text-light-text dark:text-dark-text">
              API Hub Management Tools
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Credit 面板 - 显示在设置按钮左侧 */}
          <CreditPanelCompact ldcSites={ldcSites} />

          {saving && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-lg text-xs border border-primary-500/20">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>保存中...</span>
            </div>
          )}

          {/* 下载更新按钮 - 当有更新时显示 */}
          {showDownloadButton && (
            <button
              onClick={handleDownloadClick}
              disabled={isDownloading}
              title={newVersion ? `新版本: v${newVersion}` : '下载更新'}
              aria-label={newVersion ? `下载新版本 v${newVersion}` : '下载更新'}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-400 text-white rounded-lg transition-all flex items-center gap-1.5 text-sm shadow-sm disabled:cursor-not-allowed"
            >
              {isDownloading ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              ) : (
                <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              )}
              <span>{isDownloading ? '打开中...' : '下载更新'}</span>
            </button>
          )}

          <button
            onClick={onOpenSettings}
            className="relative px-3 py-1.5 bg-light-card dark:bg-dark-card hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all flex items-center gap-1.5 text-sm border border-light-border dark:border-dark-border shadow-sm"
            aria-label="打开设置"
          >
            <Settings className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            设置
            {hasUpdate && (
              <span
                className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse"
                title="有新版本可用"
                aria-label="有新版本可用"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
