/**
 * 输入: 站点 URL、HTTP 客户端
 * 输出: 检测到的站点类型与命中依据
 * 定位: 服务层 - 在站点初始化前自动识别 site_type，供智能添加和多账户初始化复用
 *
 * 检测顺序:
 * 1. URL hint
 * 2. 首页文档（title / HTML marker）
 * 3. /api/status
 * 4. sub2api 管理面包络
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { httpGet, httpRequest } from './utils/http-client';
import Logger from './utils/logger';
import { DEFAULT_SITE_TYPE, type SiteType } from '../shared/types/site';

export type SiteTypeDetectionMethod =
  | 'url-hint'
  | 'title'
  | 'html-marker'
  | 'api-status'
  | 'sub2api-envelope'
  | 'fallback';

export interface SiteTypeDetectionResult {
  siteType: SiteType;
  detectionMethod: SiteTypeDetectionMethod;
  matchedValue?: string;
}

type SiteTypeRule = {
  siteType: SiteType;
  pattern: RegExp;
};

const log = Logger.scope('SiteTypeDetector');

const URL_HINT_RULES: SiteTypeRule[] = [
  { siteType: 'sub2api', pattern: /sub2api/i },
  { siteType: 'veloera', pattern: /veloera/i },
  { siteType: 'onehub', pattern: /one[-_ ]?hub/i },
  { siteType: 'donehub', pattern: /done[-_ ]?hub/i },
  { siteType: 'voapi', pattern: /\bvo[-_ ]?api\b/i },
  { siteType: 'superapi', pattern: /\bsuper[-_ ]?api\b/i },
  { siteType: 'newapi', pattern: /\bnew[-_ ]?api\b/i },
  { siteType: 'oneapi', pattern: /\bone[-_ ]?api\b/i },
];

const TITLE_RULES: SiteTypeRule[] = [
  { siteType: 'sub2api', pattern: /\bsub2api\b/i },
  { siteType: 'veloera', pattern: /\bveloera\b/i },
  { siteType: 'onehub', pattern: /\bone[-_ ]?hub\b/i },
  { siteType: 'donehub', pattern: /\bdone[-_ ]?hub\b/i },
  { siteType: 'voapi', pattern: /\bvo[-_ ]?api\b/i },
  { siteType: 'superapi', pattern: /\bsuper[-_ ]?api\b/i },
  { siteType: 'newapi', pattern: /\bnew[-_ ]?api\b/i },
  { siteType: 'oneapi', pattern: /\bone[-_ ]?api\b/i },
];

const SUB2API_HTML_MARKERS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'window.__APP_CONFIG__', pattern: /window\.__APP_CONFIG__\s*=/i },
  { label: 'site_subtitle', pattern: /"site_subtitle"\s*:/i },
  { label: 'custom_menu_items', pattern: /"custom_menu_items"\s*:/i },
  {
    label: 'purchase_subscription_enabled',
    pattern: /"purchase_subscription_enabled"\s*:/i,
  },
  { label: 'linuxdo_oauth_enabled', pattern: /"linuxdo_oauth_enabled"\s*:/i },
  { label: 'backend_mode_enabled', pattern: /"backend_mode_enabled"\s*:/i },
];

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = new URL(baseUrl).toString();
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function findMatchingRule(value: string, rules: SiteTypeRule[]): SiteType | null {
  for (const rule of rules) {
    if (rule.pattern.test(value)) {
      return rule.siteType;
    }
  }

  return null;
}

function extractTitle(html: unknown): string {
  if (typeof html !== 'string') {
    return '';
  }

  const match = html.match(/<title>(.*?)<\/title>/i);
  return match?.[1]?.trim() || '';
}

function detectSiteTypeFromHtml(html: unknown): SiteTypeDetectionResult | null {
  if (typeof html !== 'string' || !html.trim()) {
    return null;
  }

  const title = extractTitle(html);
  const siteTypeFromTitle = title ? findMatchingRule(title, TITLE_RULES) : null;
  if (siteTypeFromTitle) {
    return {
      siteType: siteTypeFromTitle,
      detectionMethod: 'title',
      matchedValue: title,
    };
  }

  const matchedMarkers = SUB2API_HTML_MARKERS.filter(marker => marker.pattern.test(html)).map(
    marker => marker.label
  );
  const hasSub2ApiSignature =
    matchedMarkers.includes('window.__APP_CONFIG__') && matchedMarkers.length >= 3;

  if (!hasSub2ApiSignature) {
    return null;
  }

  return {
    siteType: 'sub2api',
    detectionMethod: 'html-marker',
    matchedValue: matchedMarkers.join(', '),
  };
}

function getStatusMetadata(payload: unknown): string {
  if (!isRecord(payload)) {
    return '';
  }

  const data = isRecord(payload.data) ? payload.data : payload;
  return [data.system_name, data.systemName, data.site_name, data.siteName, data.name, data.version]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .join(' ');
}

function detectSiteTypeFromStatus(payload: unknown): SiteType | null {
  if (!isRecord(payload)) {
    return null;
  }

  const metadata = getStatusMetadata(payload);
  const hintedType = metadata ? findMatchingRule(metadata, TITLE_RULES) : null;
  if (hintedType) {
    return hintedType;
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const hasSystemName =
    !!data &&
    ['system_name', 'systemName', 'site_name', 'siteName'].some(
      key => typeof data[key] === 'string' && data[key].trim().length > 0
    );

  if (payload.success === true && hasSystemName) {
    return 'newapi';
  }

  if (payload.success === true) {
    return 'oneapi';
  }

  return null;
}

function isSub2ApiEnvelope(payload: unknown): boolean {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.code === 'number' &&
    typeof payload.message === 'string' &&
    ('data' in payload || 'error' in payload)
  );
}

async function detectFromHomeDocument(baseUrl: string): Promise<SiteTypeDetectionResult | null> {
  try {
    const response = await httpRequest<string>({
      method: 'GET',
      url: `${baseUrl}/`,
      responseType: 'text',
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });

    return detectSiteTypeFromHtml(response.data);
  } catch (error: any) {
    log.debug('首页文档探测失败，继续后续探测', error?.message || error);
    return null;
  }
}

async function detectFromApiStatus(baseUrl: string): Promise<SiteTypeDetectionResult | null> {
  try {
    const response = await httpGet(`${baseUrl}/api/status`, {
      timeout: 10000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });

    const siteType = detectSiteTypeFromStatus(response.data);
    if (!siteType) {
      return null;
    }

    return {
      siteType,
      detectionMethod: 'api-status',
      matchedValue: getStatusMetadata(response.data) || `/api/status:${response.status}`,
    };
  } catch (error: any) {
    log.debug('/api/status 探测失败，继续后续探测', error?.message || error);
    return null;
  }
}

async function detectSub2ApiEnvelope(baseUrl: string): Promise<SiteTypeDetectionResult | null> {
  try {
    const response = await httpGet(`${baseUrl}/api/v1/auth/me`, {
      timeout: 10000,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    });

    if (!isSub2ApiEnvelope(response.data)) {
      return null;
    }

    return {
      siteType: 'sub2api',
      detectionMethod: 'sub2api-envelope',
      matchedValue: `/api/v1/auth/me:${response.status}`,
    };
  } catch (error: any) {
    log.debug('sub2api 包络探测失败，继续回退', error?.message || error);
    return null;
  }
}

export async function detectSiteType(baseUrl: string): Promise<SiteTypeDetectionResult> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  const hintedByUrl = findMatchingRule(normalizedBaseUrl, URL_HINT_RULES);
  if (hintedByUrl) {
    return {
      siteType: hintedByUrl,
      detectionMethod: 'url-hint',
      matchedValue: normalizedBaseUrl,
    };
  }

  const homeDocumentResult = await detectFromHomeDocument(normalizedBaseUrl);
  if (homeDocumentResult) {
    return homeDocumentResult;
  }

  const apiStatusResult = await detectFromApiStatus(normalizedBaseUrl);
  if (apiStatusResult) {
    return apiStatusResult;
  }

  const sub2apiResult = await detectSub2ApiEnvelope(normalizedBaseUrl);
  if (sub2apiResult) {
    return sub2apiResult;
  }

  return {
    siteType: DEFAULT_SITE_TYPE,
    detectionMethod: 'fallback',
    matchedValue: DEFAULT_SITE_TYPE,
  };
}
