/**
 * 日志过滤工具函数
 * 用于区分模型调用日志和非模型日志
 */

/**
 * 日志条目接口
 */
export interface LogItem {
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  model_name?: string;
}

/**
 * 聚合统计结果接口
 */
export interface AggregatedStats {
  quota: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

/**
 * 判断日志条目是否为模型调用日志
 * @param item 日志条目
 * @returns true 如果是模型调用日志，false 否则
 */
export function isModelLog(item: LogItem): boolean {
  // 检查 model_name 是否存在且非空
  if (!item.model_name) return false;
  // 检查是否为纯空白字符串
  if (typeof item.model_name === 'string' && item.model_name.trim() === '') return false;
  return true;
}

/**
 * 聚合日志数据，计算消费和 Token 统计
 * @param items 日志条目数组
 * @returns 聚合后的统计数据
 */
export function aggregateUsageData(items: LogItem[]): AggregatedStats {
  let quota = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const item of items) {
    quota += item.quota || 0;
    promptTokens += item.prompt_tokens || 0;
    completionTokens += item.completion_tokens || 0;
  }

  return {
    quota,
    promptTokens,
    completionTokens,
    requestCount: items.length,
  };
}

/**
 * 过滤并聚合日志数据
 * 只统计模型调用日志
 * @param items 原始日志条目数组
 * @returns 过滤后的聚合统计数据
 */
export function filterAndAggregateUsageData(items: LogItem[]): AggregatedStats {
  const modelLogs = items.filter(isModelLog);
  return aggregateUsageData(modelLogs);
}
