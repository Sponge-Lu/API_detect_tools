/**
 * 输入: URL 字符串、站点列表
 * 输出: 匹配结果、规范化 URL
 * 定位: 工具层 - 站点匹配器
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import {
  ConfigSourceType,
  CliType,
  SiteInfo,
  AuthType,
  OFFICIAL_API_URLS,
} from '../../shared/types/config-detection';

/**
 * 站点匹配结果
 */
export interface MatchResult {
  matched: boolean;
  siteId?: string;
  siteName?: string;
}

/**
 * 规范化 URL
 * - 移除协议 (http://, https://)
 * - 移除尾部斜杠
 * - 转换为小写
 * - 移除默认端口 (80, 443)
 *
 * @param url 原始 URL
 * @returns 规范化后的 URL
 */
export function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    return '';
  }

  let normalized = url.trim().toLowerCase();

  // 移除协议
  normalized = normalized.replace(/^https?:\/\//, '');

  // 移除默认端口
  normalized = normalized.replace(/:80(\/|$)/, '$1');
  normalized = normalized.replace(/:443(\/|$)/, '$1');

  // 移除尾部斜杠
  normalized = normalized.replace(/\/+$/, '');

  return normalized;
}

/**
 * 比较两个 URL 是否相等（规范化后比较）
 *
 * @param url1 第一个 URL
 * @param url2 第二个 URL
 * @returns 是否相等
 */
export function urlsEqual(url1: string, url2: string): boolean {
  return normalizeUrl(url1) === normalizeUrl(url2);
}

/**
 * 判断是否为官方 API URL
 *
 * @param url 要检查的 URL
 * @param cliType CLI 类型
 * @returns 是否为官方 URL
 */
export function isOfficialUrl(url: string, cliType: CliType): boolean {
  if (!url) {
    return false;
  }

  const officialUrls = OFFICIAL_API_URLS[cliType];
  const normalizedUrl = normalizeUrl(url);

  return officialUrls.some(officialUrl => {
    const normalizedOfficial = normalizeUrl(officialUrl);
    // 检查是否完全匹配或以官方 URL 开头
    return (
      normalizedUrl === normalizedOfficial || normalizedUrl.startsWith(normalizedOfficial + '/')
    );
  });
}

/**
 * 匹配站点
 *
 * @param configUrl 配置中的 URL
 * @param sites 站点列表
 * @returns 匹配结果
 */
export function matchSite(configUrl: string, sites: SiteInfo[]): MatchResult {
  if (!configUrl || !sites || sites.length === 0) {
    return { matched: false };
  }

  const normalizedConfigUrl = normalizeUrl(configUrl);

  for (const site of sites) {
    if (!site.url) {
      continue;
    }

    const normalizedSiteUrl = normalizeUrl(site.url);

    // 检查是否匹配（完全匹配或配置 URL 以站点 URL 开头）
    if (
      normalizedConfigUrl === normalizedSiteUrl ||
      normalizedConfigUrl.startsWith(normalizedSiteUrl + '/')
    ) {
      return {
        matched: true,
        siteId: site.id,
        siteName: site.name,
      };
    }
  }

  return { matched: false };
}

/**
 * 确定配置来源类型
 *
 * @param options 检测选项
 * @returns 配置来源类型
 *
 * Requirements: 2.1, 2.2, 2.3
 */
export function determineSourceType(options: {
  baseUrl?: string;
  hasApiKey: boolean;
  authType?: AuthType;
  isSubscription?: boolean;
  isOfficialApiKey?: boolean;
  cliType: CliType;
  sites: SiteInfo[];
}): {
  sourceType: ConfigSourceType;
  siteName?: string;
  siteId?: string;
} {
  const { baseUrl, hasApiKey, authType, isSubscription, isOfficialApiKey, cliType, sites } =
    options;

  // 1. 优先检查认证类型（订阅账号）
  if (isSubscription) {
    return { sourceType: 'subscription' };
  }

  // 2. 检查 ChatGPT OAuth（Codex 特有）
  if (authType === 'chatgpt-oauth') {
    return { sourceType: 'official' };
  }

  // 3. 检查官方 API Key（优先于站点配置）
  // Requirements 2.1, 2.2: 官方 API Key 优先返回 official
  if (isOfficialApiKey) {
    return { sourceType: 'official' };
  }

  // 4. 如果有 base URL，进行匹配
  if (baseUrl) {
    // 4.1 检查是否匹配管理的站点
    // Requirements 2.3: 非官方 API Key 且有站点配置时返回 managed
    const matchResult = matchSite(baseUrl, sites);
    if (matchResult.matched) {
      return {
        sourceType: 'managed',
        siteName: matchResult.siteName,
        siteId: matchResult.siteId,
      };
    }

    // 4.2 检查是否为官方 URL
    if (isOfficialUrl(baseUrl, cliType)) {
      return { sourceType: 'official' };
    }

    // 4.3 其他中转站
    return { sourceType: 'other' };
  }

  // 5. 没有 base URL，但有 API Key，视为使用官方 API
  if (hasApiKey) {
    return { sourceType: 'official' };
  }

  // 6. 无法确定
  return { sourceType: 'unknown' };
}
