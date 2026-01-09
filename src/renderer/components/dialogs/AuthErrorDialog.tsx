/**
 * @file src/renderer/components/dialogs/AuthErrorDialog.tsx
 * @description 认证错误对话框 - 使用 IOSModal 重构
 *
 * 输入: AuthErrorDialogProps (认证错误站点列表、回调函数)
 * 输出: React 组件 (认证错误对话框 UI)
 * 定位: 展示层 - 认证错误对话框，分析并展示 Session/Token 过期等问题
 *
 * @version 2.1.11
 * @updated 2025-01-08 - 使用 IOSModal 重构
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/dialogs/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { Key } from 'lucide-react';
import type { SiteConfig } from '../../App';
import { IOSModal } from '../IOSModal';
import { IOSButton } from '../IOSButton';

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
    <IOSModal
      isOpen={sites.length > 0}
      onClose={onClose}
      title="站点认证需要更新"
      titleIcon={<Key className="w-5 h-5" />}
      size="md"
      contentClassName="!p-0"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={onClose}>
            稍后处理
          </IOSButton>
          {sites.length > 1 && (
            <IOSButton variant="primary" onClick={onProcessAll}>
              逐个处理
            </IOSButton>
          )}
        </>
      }
    >
      {/* 提示信息 */}
      <div className="px-[var(--spacing-2xl)] py-[var(--spacing-md)] bg-[var(--ios-orange)]/10 border-b border-[var(--ios-separator)]">
        <p className="text-xs text-[var(--ios-text-secondary)]">
          {sites.length === 1
            ? '检测到 1 个站点的登录已过期或凭证失效'
            : `检测到 ${sites.length} 个站点的登录已过期或凭证失效`}
        </p>
      </div>

      {/* 站点列表 */}
      <div className="px-[var(--spacing-2xl)] py-[var(--spacing-lg)] max-h-80 overflow-y-auto">
        <div className="space-y-3">
          {sites.map((site, index) => {
            const siteIndex = configSites.findIndex(s => s.name === site.name);
            const errorAnalysis = analyzeErrorType(site.error);
            return (
              <div
                key={index}
                className="px-4 py-3 bg-[var(--ios-bg-tertiary)] rounded-[var(--radius-md)]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{errorAnalysis.icon}</span>
                    <p className="text-sm font-medium text-[var(--ios-text-primary)]">
                      {site.name}
                    </p>
                    <span className="px-2 py-0.5 text-xs font-medium bg-[var(--ios-orange)]/20 text-[var(--ios-orange)] rounded-[var(--radius-sm)]">
                      {errorAnalysis.type}
                    </span>
                  </div>
                  {siteIndex !== -1 && (
                    <div className="flex items-center gap-1.5">
                      <IOSButton
                        size="sm"
                        variant="secondary"
                        onClick={() => onForceRefresh(siteIndex, site.name)}
                        className="!px-2.5 !py-1.5 !text-xs bg-[var(--ios-orange)]/10 text-[var(--ios-orange)] hover:bg-[var(--ios-orange)]/20"
                        title="确认站点数据确实为空，强制更新（不重新登录）"
                      >
                        真·空数据
                      </IOSButton>
                      <IOSButton
                        size="sm"
                        variant="primary"
                        onClick={() => onEditSite(siteIndex, site.name)}
                        className="!px-2.5 !py-1.5 !text-xs"
                      >
                        重新获取
                      </IOSButton>
                    </div>
                  )}
                </div>
                <p className="text-xs text-[var(--ios-text-secondary)] flex items-center gap-1 flex-wrap">
                  <span>💡 请先</span>
                  <button
                    onClick={() => onOpenSite(site.url)}
                    className="text-[var(--ios-blue)] hover:underline font-medium"
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
    </IOSModal>
  );
}
