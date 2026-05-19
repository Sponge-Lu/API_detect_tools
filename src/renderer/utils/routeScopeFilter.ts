/**
 * 输入: RouteAnalyticsBucket[] + Scope (all / site / customCli) + 自定义 CLI 配置 ID 列表
 * 输出: 过滤后的 RouteAnalyticsBucket[]
 * 定位: 工具层 - 路由数据子页 scope 下拉过滤分析桶
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import type { RouteAnalyticsBucket } from '../../shared/types/route-proxy';
import { buildCustomCliRouteSiteId } from '../../shared/utils/customCliRouteId';

export type RouteScope =
  | { kind: 'all' }
  | { kind: 'site'; siteId: string }
  | { kind: 'customCli'; customCliId: string };

export const ROUTE_SCOPE_ALL: RouteScope = { kind: 'all' };

export function isSameRouteScope(a: RouteScope, b: RouteScope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'all') return true;
  if (a.kind === 'site' && b.kind === 'site') return a.siteId === b.siteId;
  if (a.kind === 'customCli' && b.kind === 'customCli') return a.customCliId === b.customCliId;
  return false;
}

export function resolveScopeSiteId(scope: RouteScope): string | null {
  if (scope.kind === 'site') return scope.siteId;
  if (scope.kind === 'customCli') return buildCustomCliRouteSiteId(scope.customCliId);
  return null;
}

export function filterBucketsByScope(
  buckets: RouteAnalyticsBucket[],
  scope: RouteScope
): RouteAnalyticsBucket[] {
  if (scope.kind === 'all') return buckets;
  const targetSiteId = resolveScopeSiteId(scope);
  if (!targetSiteId) return buckets;
  return buckets.filter(bucket => bucket.siteId === targetSiteId);
}
