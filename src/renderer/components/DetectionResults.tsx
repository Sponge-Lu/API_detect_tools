/**
 * 输入: DetectionResultsProps (检测结果数组、检测状态)
 * 输出: React 组件 (检测结果展示 UI)
 * 定位: 展示层 - 显示站点检测结果，包含状态图标和详细信息
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/components/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { CheckCircle, XCircle, Loader2, Server, DollarSign, Box } from 'lucide-react';
import { DetectionResult } from '../App';

interface DetectionResultsProps {
  results: DetectionResult[];
  detecting: boolean;
}

export function DetectionResults({ results, detecting }: DetectionResultsProps) {
  if (detecting) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-[var(--accent)]" />
          <p className="text-[var(--text-secondary)]">正在检测站点...</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-[var(--text-secondary)]">
          <Server className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <p>暂无检测结果</p>
          <p className="text-sm mt-2">点击左上角"检测所有站点"开始</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-[var(--line-soft)] bg-[var(--surface-1)]/88 px-6 py-4 backdrop-blur-sm">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">检测结果</h2>
        <p className="text-sm text-[var(--text-secondary)]">共检测 {results.length} 个站点</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {results.map((result, index) => (
          <div
            key={index}
            className={`rounded-[var(--radius-lg)] border bg-[var(--surface-1)]/82 p-4 backdrop-blur-sm transition-colors ${
              result.status === '成功'
                ? 'border-[var(--success)]/28 hover:border-[var(--success)]/45'
                : 'border-[var(--danger)]/28 hover:border-[var(--danger)]/45'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {result.status === '成功' ? (
                  <CheckCircle className="h-5 w-5 text-[var(--success)]" />
                ) : (
                  <XCircle className="h-5 w-5 text-[var(--danger)]" />
                )}
                <div>
                  <h3 className="font-semibold text-[var(--text-primary)]">{result.name}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">{result.url}</p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  result.status === '成功'
                    ? 'bg-[var(--success-soft)] text-[var(--success)]'
                    : 'bg-[var(--danger-soft)] text-[var(--danger)]'
                }`}
              >
                {result.status}
              </span>
            </div>

            {result.error && (
              <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--danger)]/22 bg-[var(--danger-soft)] p-3">
                <p className="text-sm text-[var(--danger)]">{result.error}</p>
              </div>
            )}

            {result.balance !== undefined && result.balance !== null && (
              <div className="mb-3 flex items-center gap-2 text-[var(--accent)]">
                <DollarSign className="h-4 w-4" />
                <span className="font-semibold">余额: ${result.balance.toFixed(2)}</span>
              </div>
            )}

            {result.models.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2 text-[var(--text-secondary)]">
                  <Box className="h-4 w-4" />
                  <span className="text-sm font-medium">可用模型 ({result.models.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.models.slice(0, 10).map((model, idx) => (
                    <span
                      key={idx}
                      className="rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
                    >
                      {model}
                    </span>
                  ))}
                  {result.models.length > 10 && (
                    <span className="px-2 py-1 text-xs text-[var(--text-secondary)]">
                      +{result.models.length - 10} 更多...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
