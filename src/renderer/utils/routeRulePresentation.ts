import type {
  RoutePatternType,
  RouteRule,
  RouteSourceProtocol,
} from '../../shared/types/route-proxy';

export interface RouteRuleLookupContext {
  siteNamesById?: Record<string, string>;
  accountNamesById?: Record<string, string>;
}

const PROTOCOL_LABELS: Record<RouteSourceProtocol, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-responses': 'OpenAI Responses',
  'openai-chat-completions': 'OpenAI Chat Completions',
};

const PATTERN_TYPE_LABELS: Record<RoutePatternType, string> = {
  exact: '精确匹配',
  wildcard: '通配匹配',
  regex: '正则匹配',
};

function formatNamedScope(
  ids: string[] | undefined,
  lookup: Record<string, string> | undefined,
  entityLabel: string
): string | null {
  if (!ids || ids.length === 0) {
    return null;
  }

  if (ids.length === 1) {
    return lookup?.[ids[0]] || `1 个${entityLabel}`;
  }

  if (ids.length <= 2) {
    const labels = ids.map(id => lookup?.[id] || id);
    return labels.join(' / ');
  }

  return `${ids.length} 个${entityLabel}`;
}

export function getRouteProtocolLabel(sourceProtocol: RouteSourceProtocol): string {
  return PROTOCOL_LABELS[sourceProtocol];
}

export function getRoutePatternTypeLabel(patternType: RoutePatternType): string {
  return PATTERN_TYPE_LABELS[patternType];
}

export function buildRouteRuleScopeSummary(
  rule: RouteRule,
  context: RouteRuleLookupContext = {}
): string {
  const parts = [
    formatNamedScope(rule.allowedSiteIds, context.siteNamesById, '站点'),
    formatNamedScope(rule.allowedAccountIds, context.accountNamesById, '账户'),
    rule.allowedApiKeyGroups && rule.allowedApiKeyGroups.length > 0
      ? rule.allowedApiKeyGroups.length === 1
        ? `分组 ${rule.allowedApiKeyGroups[0]}`
        : `${rule.allowedApiKeyGroups.length} 个分组`
      : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' / ') : '全部站点';
}

export function buildRouteRuleSummary(
  rule: RouteRule,
  context: RouteRuleLookupContext = {}
): string {
  const protocolLabel = getRouteProtocolLabel(rule.sourceProtocol);
  const matchText =
    rule.pattern === '*'
      ? '匹配全部模型'
      : `${getRoutePatternTypeLabel(rule.patternType)} ${rule.pattern}`;

  return `${protocolLabel} 请求 ${matchText} 时生效；范围：${buildRouteRuleScopeSummary(rule, context)}`;
}

export function buildRouteRuleSelectionReason(rule: RouteRule): string {
  return `优先级 ${rule.priority}，${getRoutePatternTypeLabel(rule.patternType)}，pattern 长度 ${rule.pattern.length}`;
}

export function buildRouteRuleTags(
  rule: RouteRule,
  context: RouteRuleLookupContext = {}
): string[] {
  const tags = [getRouteProtocolLabel(rule.sourceProtocol), getRoutePatternTypeLabel(rule.patternType)];
  if (rule.pattern === '*') {
    tags.push('全部模型');
  } else {
    tags.push(rule.pattern);
  }
  tags.push(buildRouteRuleScopeSummary(rule, context));
  return tags;
}
