/**
 * AnyRouter 配置区域组件
 * 用于在账户编辑弹窗中显示 AnyRouter 专用配置
 */

import { useState } from 'react';
import { Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';

interface AnyRouterConfigSectionProps {
  siteId: string;
  accountId: string;
  userHash: string;
  onUserHashChange: (hash: string) => void | Promise<void>;
  onConfigChanged?: () => void | Promise<void>; // 新增：配置变更回调
  variant?: 'card' | 'inline';
  showManualHelp?: boolean;
}

function maskUserHash(hash: string): string {
  if (!hash) return '';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}********${hash.slice(-8)}`;
}

export function AnyRouterConfigSection({
  siteId,
  accountId,
  userHash,
  onUserHashChange,
  onConfigChanged,
  variant = 'card',
  showManualHelp = true,
}: AnyRouterConfigSectionProps) {
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [showHash, setShowHash] = useState(false);

  const handleAutoExtract = async () => {
    setExtracting(true);
    setExtractError(null);

    try {
      const result = await (window.electronAPI as any).anyrouter.extractUserHash({
        siteId,
        accountId,
      });

      await onUserHashChange(result.hash);

      // 触发配置重新加载，以便其他账户也能看到更新
      await onConfigChanged?.();

      // 显示成功提示
      if (result.autoFilledCount > 0) {
        console.log(`成功提取 User Hash！已自动填充到同站点的 ${result.autoFilledCount} 个账户`);
      } else {
        console.log('成功提取 User Hash！');
      }
    } catch (error: any) {
      setExtractError(error.message);
      console.error('提取失败:', error.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleCopy = () => {
    if (userHash) {
      navigator.clipboard.writeText(userHash);
      console.log('已复制到剪贴板');
    }
  };

  const surfaceClassName =
    variant === 'inline'
      ? 'space-y-3'
      : 'rounded-[var(--radius-lg)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 py-2';

  return (
    <div className="space-y-2">
      <div className={surfaceClassName}>
        <div className="grid gap-2 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <div className="flex items-baseline gap-2">
            <span className="whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
              User Hash
            </span>
            <span className="whitespace-nowrap text-xs text-[var(--text-tertiary)]">路由代理</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
            <input
              type="text"
              value={showHash || !userHash ? userHash : maskUserHash(userHash)}
              onChange={e => onUserHashChange(e.target.value)}
              onFocus={() => {
                if (!userHash) {
                  setShowHash(true);
                }
              }}
              placeholder="点击自动提取或手动输入"
              pattern="[a-f0-9]{64}"
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-label="User Hash"
              readOnly={!showHash && !!userHash}
              disabled={extracting}
              className="min-w-[220px] flex-1 rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-1)] px-2 py-1 font-mono text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] placeholder:text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => setShowHash(value => !value)}
              disabled={!userHash || extracting}
              className="rounded-[var(--radius-sm)] p-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={showHash ? '部分显示 User Hash' : '显示完整 User Hash'}
              aria-label={showHash ? '部分显示 User Hash' : '显示完整 User Hash'}
              aria-pressed={showHash}
            >
              {showHash ? (
                <EyeOff className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Eye className="h-3.5 w-3.5" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!userHash || extracting}
              className="rounded-[var(--radius-sm)] p-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
              title="复制"
              aria-label="复制 User Hash"
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={handleAutoExtract}
              disabled={extracting}
              className="inline-flex items-center gap-1 whitespace-nowrap px-2 text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extracting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  提取中
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  自动提取
                </>
              )}
            </button>
          </div>
        </div>
        {extracting && (
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-2 text-xs text-[var(--warning)]">
            <div className="font-semibold">正在自动提取 Hash...</div>
            <div className="mt-1">
              提取过程中会临时修改 Claude Code 配置，请勿使用 Claude Code，完成后会自动恢复。
            </div>
          </div>
        )}

        {showManualHelp ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-strong)] transition-colors">
              手动输入方法
            </summary>
            <div className="mt-2 space-y-2 text-xs text-[var(--text-secondary)]">
              <div>
                <h5 className="font-semibold mb-1 text-[var(--text-primary)]">
                  步骤 1: 安装并配置 Fiddler Classic
                </h5>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  <li>下载 Fiddler Classic</li>
                  <li>Tools → Options → HTTPS</li>
                  <li>勾选 "Decrypt HTTPS traffic"</li>
                </ul>
              </div>

              <div>
                <h5 className="font-semibold mb-1 text-[var(--text-primary)]">
                  步骤 2: 设置代理并启动 Claude Code
                </h5>
                <pre className="rounded-[var(--radius-sm)] bg-[var(--surface-1)] p-2 overflow-x-auto font-mono text-[10px] text-[var(--text-primary)]">
                  {`$env:HTTP_PROXY="http://127.0.0.1:8888"
$env:HTTPS_PROXY="http://127.0.0.1:8888"
$env:NODE_TLS_REJECT_UNAUTHORIZED="0"
claude`}
                </pre>
              </div>

              <div>
                <h5 className="font-semibold mb-1 text-[var(--text-primary)]">
                  步骤 3: 在 Claude Code 中发送消息
                </h5>
                <p>发送任意一条消息（如 "hello"）</p>
              </div>

              <div>
                <h5 className="font-semibold mb-1 text-[var(--text-primary)]">
                  步骤 4: 在 Fiddler 中查找请求
                </h5>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                  <li>找到 POST /v1/messages</li>
                  <li>Inspectors → JSON</li>
                  <li>找到 metadata.user_id</li>
                  <li>
                    格式: user_
                    <span className="font-mono bg-[var(--warning-soft)] text-[var(--warning)]">
                      HASH
                    </span>
                    _account__session_UUID
                  </li>
                  <li>复制高亮部分（64 位十六进制）</li>
                </ul>
              </div>

              <div>
                <h5 className="font-semibold mb-1 text-[var(--text-primary)]">
                  步骤 5: 粘贴到输入框
                </h5>
                <p>将复制的哈希值粘贴到上方的 "User Hash" 输入框中</p>
              </div>

              <div className="rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-2">
                <p className="font-semibold text-[var(--warning)]">安全提示</p>
                <p className="mt-1 text-[var(--warning)]">抓包完成后，记得执行：</p>
                <pre className="rounded-[var(--radius-sm)] bg-[var(--surface-1)] p-1 mt-1 font-mono text-[10px] text-[var(--text-primary)]">
                  Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED
                </pre>
              </div>
            </div>
          </details>
        ) : null}
      </div>

      {/* 错误提示 */}
      {extractError && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-xs font-medium text-[var(--warning)]">
          {extractError}
        </div>
      )}
    </div>
  );
}
