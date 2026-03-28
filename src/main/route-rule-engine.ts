/**
 * 路由规则引擎
 * 负责：路径→CLI类型识别，pattern 匹配，规则排序
 */

import type { RouteRule, RouteCliType, RoutePatternType } from '../shared/types/route-proxy';
import { CLI_TYPE_PATH_MAP } from '../shared/types/route-proxy';

/**
 * 从请求路径识别 CLI 类型
 * /v1/messages  -> claudeCode
 * /v1/responses -> codex
 * /v1beta/...   -> geminiCli
 */
export function detectCliTypeFromPath(pathname: string): RouteCliType | null {
  for (const [cliType, paths] of Object.entries(CLI_TYPE_PATH_MAP) as [RouteCliType, string[]][]) {
    for (const prefix of paths) {
      if (pathname === prefix || pathname.startsWith(prefix)) {
        return cliType;
      }
    }
  }
  return null;
}

/**
 * 从请求 body 中提取 model 名称
 */
export function extractModelFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.model === 'string') return b.model;
  return null;
}

/** pattern specificity 数值（越高越具体） */
function patternSpecificity(rule: RouteRule): number {
  switch (rule.patternType) {
    case 'exact':
      return 3;
    case 'wildcard':
      return 2;
    case 'regex':
      return 1;
    default:
      return 0;
  }
}

/**
 * 对规则列表排序：priority DESC > specificity DESC > pattern长度 DESC > createdAt ASC
 */
export function sortRules(rules: RouteRule[]): RouteRule[] {
  return [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const sd = patternSpecificity(b) - patternSpecificity(a);
    if (sd !== 0) return sd;
    if (b.pattern.length !== a.pattern.length) return b.pattern.length - a.pattern.length;
    return a.createdAt - b.createdAt;
  });
}

/**
 * 判断 model 是否匹配 pattern
 */
export function matchPattern(model: string, pattern: string, type: RoutePatternType): boolean {
  if (!model || !pattern) return false;
  switch (type) {
    case 'exact':
      return model === pattern;
    case 'wildcard': {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp('^' + escaped + '$').test(model);
    }
    case 'regex': {
      try {
        return new RegExp(pattern).test(model);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * 找出第一条匹配的规则
 * @param rules   已排序的规则列表
 * @param cliType 已识别的 CLI 类型
 * @param model   请求中的 model 字段（可为空）
 */
export function findMatchingRule(
  rules: RouteRule[],
  cliType: RouteCliType,
  model: string | null
): RouteRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.cliType !== cliType) continue;
    if (!model || rule.pattern === '*') return rule;
    if (matchPattern(model, rule.pattern, rule.patternType)) return rule;
  }
  return null;
}
