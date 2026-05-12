/**
 * 路由模型分布聚合工具
 * 输入: RouteAnalyticsBucket[]
 * 输出: ModelDistributionItem[] + squarified treemap 布局
 * 定位: 工具层 - 按 canonicalModel 聚合请求/token/失败
 */

import type { RouteAnalyticsBucket, RouteCliType } from '../../shared/types/route-proxy';

export interface ModelDistributionItem {
  id: string;
  canonicalModel: string;
  cliType: RouteCliType;
  requests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
}

export interface TreemapNode<T> {
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

export function buildModelDistribution(buckets: RouteAnalyticsBucket[]): ModelDistributionItem[] {
  const grouped = new Map<string, ModelDistributionItem>();

  for (const bucket of buckets) {
    const canonicalModel = bucket.canonicalModel || '未标记模型';
    const id = `${bucket.cliType}:${canonicalModel}`;

    const current = grouped.get(id) || {
      id,
      canonicalModel,
      cliType: bucket.cliType,
      requests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
    };

    current.requests += bucket.requestCount;
    current.successCount += bucket.successCount;
    current.failureCount += bucket.failureCount;
    current.totalTokens += bucket.totalTokens;

    grouped.set(id, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.requests - a.requests);
}

function worstRatio(row: number[], length: number): number {
  if (row.length === 0 || length === 0) return Infinity;
  const sum = row.reduce((acc, v) => acc + v, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = sum * sum;
  const l2 = length * length;
  return Math.max((l2 * max) / s2, s2 / (l2 * min));
}

export function squarifiedTreemap<T>(
  items: T[],
  getValue: (item: T) => number,
  width: number,
  height: number
): TreemapNode<T>[] {
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const values = items.map(getValue).map(v => Math.max(v, 0));
  const totalValue = values.reduce((acc, v) => acc + v, 0);
  if (totalValue <= 0) return [];

  const totalArea = width * height;
  const scaled = values.map(v => (v / totalValue) * totalArea);

  const nodes: TreemapNode<T>[] = [];
  let x = 0;
  let y = 0;
  let remainingWidth = width;
  let remainingHeight = height;
  let currentRow: number[] = [];
  let currentRowItems: T[] = [];

  const flushRow = () => {
    if (currentRow.length === 0) return;
    const rowSum = currentRow.reduce((acc, v) => acc + v, 0);
    const shortSide = Math.min(remainingWidth, remainingHeight);
    const isHorizontal = remainingWidth <= remainingHeight;
    const rowThickness = rowSum / shortSide;

    let offset = isHorizontal ? x : y;
    for (let i = 0; i < currentRow.length; i += 1) {
      const itemArea = currentRow[i];
      const itemLength = itemArea / rowThickness;

      if (isHorizontal) {
        nodes.push({
          item: currentRowItems[i],
          x: offset,
          y,
          width: itemLength,
          height: rowThickness,
          value: itemArea,
        });
        offset += itemLength;
      } else {
        nodes.push({
          item: currentRowItems[i],
          x,
          y: offset,
          width: rowThickness,
          height: itemLength,
          value: itemArea,
        });
        offset += itemLength;
      }
    }

    if (isHorizontal) {
      y += rowThickness;
      remainingHeight -= rowThickness;
    } else {
      x += rowThickness;
      remainingWidth -= rowThickness;
    }

    currentRow = [];
    currentRowItems = [];
  };

  for (let i = 0; i < scaled.length; i += 1) {
    const value = scaled[i];
    const shortSide = Math.min(remainingWidth, remainingHeight);
    const nextRow = [...currentRow, value];
    const currentWorst = worstRatio(currentRow, shortSide);
    const nextWorst = worstRatio(nextRow, shortSide);

    if (currentRow.length === 0 || nextWorst <= currentWorst) {
      currentRow.push(value);
      currentRowItems.push(items[i]);
    } else {
      flushRow();
      currentRow.push(value);
      currentRowItems.push(items[i]);
    }
  }

  flushRow();

  return nodes;
}
