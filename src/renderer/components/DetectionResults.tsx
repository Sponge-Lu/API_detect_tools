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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary-400" />
          <p className="text-gray-300">正在检测站点...</p>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-gray-400">
          <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>暂无检测结果</p>
          <p className="text-sm mt-2">点击左上角"检测所有站点"开始</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="px-6 py-4 bg-black/10 backdrop-blur-sm border-b border-white/10">
        <h2 className="text-lg font-semibold">检测结果</h2>
        <p className="text-sm text-gray-400">共检测 {results.length} 个站点</p>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {results.map((result, index) => (
          <div
            key={index}
            className={`bg-white/5 backdrop-blur-sm rounded-lg p-4 border transition-all ${
              result.status === '成功'
                ? 'border-green-500/30 hover:border-green-500/50'
                : 'border-red-500/30 hover:border-red-500/50'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {result.status === '成功' ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                <div>
                  <h3 className="font-semibold">{result.name}</h3>
                  <p className="text-sm text-gray-400">{result.url}</p>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  result.status === '成功'
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-red-500/20 text-red-500'
                }`}
              >
                {result.status}
              </span>
            </div>

            {result.error && (
              <div className="mb-3 p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <p className="text-sm text-red-400">{result.error}</p>
              </div>
            )}

            {result.balance !== undefined && result.balance !== null && (
              <div className="mb-3 flex items-center gap-2 text-primary-400">
                <DollarSign className="w-4 h-4" />
                <span className="font-semibold">余额: ${result.balance.toFixed(2)}</span>
              </div>
            )}

            {result.models.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-gray-400">
                  <Box className="w-4 h-4" />
                  <span className="text-sm font-medium">可用模型 ({result.models.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {result.models.slice(0, 10).map((model, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-white/5 rounded text-xs font-mono border border-white/10"
                    >
                      {model}
                    </span>
                  ))}
                  {result.models.length > 10 && (
                    <span className="px-2 py-1 text-xs text-gray-400">
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
