/**
 * 输入: 自定义 CLI 配置 ID（CustomCliConfig.id）
 * 输出: 路由分析里识别自定义 CLI 通道用的合成 site/account/apiKey ID 与反向解析 helper
 * 定位: 共享工具层 - 跨进程统一自定义 CLI 路由 ID 命名约定
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/shared/utils/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

const CUSTOM_CLI_ROUTE_ID_PREFIX = 'custom-cli';

export const CUSTOM_CLI_ROUTE_SITE_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-site-`;
export const CUSTOM_CLI_ROUTE_ACCOUNT_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-account-`;
export const CUSTOM_CLI_ROUTE_API_KEY_PREFIX = `${CUSTOM_CLI_ROUTE_ID_PREFIX}-key-`;

export const CUSTOM_CLI_ROUTE_GROUP = CUSTOM_CLI_ROUTE_ID_PREFIX;

function encodeCustomCliConfigId(configId: string): string {
  const normalized = configId.trim();
  return encodeURIComponent(normalized || 'unknown');
}

function decodeCustomCliConfigId(encoded: string): string | null {
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.trim() || null;
  } catch {
    return null;
  }
}

export function buildCustomCliRouteSiteId(configId: string): string {
  return `${CUSTOM_CLI_ROUTE_SITE_PREFIX}${encodeCustomCliConfigId(configId)}`;
}

export function buildCustomCliRouteAccountId(configId: string): string {
  return `${CUSTOM_CLI_ROUTE_ACCOUNT_PREFIX}${encodeCustomCliConfigId(configId)}`;
}

export function buildCustomCliRouteApiKeyId(configId: string, keyId?: string): string {
  const configPart = encodeCustomCliConfigId(configId);
  const normalizedKeyId = keyId?.trim();
  return `${CUSTOM_CLI_ROUTE_API_KEY_PREFIX}${configPart}${normalizedKeyId ? `:${encodeURIComponent(normalizedKeyId)}` : ''}`;
}

export function parseCustomCliRouteApiKeyId(
  apiKeyId: string
): { configId: string; keyId?: string } | null {
  if (!apiKeyId.startsWith(CUSTOM_CLI_ROUTE_API_KEY_PREFIX)) return null;
  const encoded = apiKeyId.slice(CUSTOM_CLI_ROUTE_API_KEY_PREFIX.length);
  const separatorIndex = encoded.indexOf(':');
  const encodedConfigId = separatorIndex >= 0 ? encoded.slice(0, separatorIndex) : encoded;
  const configId = decodeCustomCliConfigId(encodedConfigId);
  if (!configId) return null;
  if (separatorIndex < 0) return { configId };

  const keyId = decodeCustomCliConfigId(encoded.slice(separatorIndex + 1));
  return keyId ? { configId, keyId } : null;
}

export function parseCustomCliRouteConfigId(siteId: string): string | null {
  if (!siteId.startsWith(CUSTOM_CLI_ROUTE_SITE_PREFIX)) {
    return null;
  }
  return decodeCustomCliConfigId(siteId.slice(CUSTOM_CLI_ROUTE_SITE_PREFIX.length));
}

export function isCustomCliRouteSiteId(siteId: string | null | undefined): boolean {
  return typeof siteId === 'string' && siteId.startsWith(CUSTOM_CLI_ROUTE_SITE_PREFIX);
}

export function isCustomCliRouteChannel(
  siteId: string,
  accountId: string,
  apiKeyId: string
): boolean {
  const configId = parseCustomCliRouteConfigId(siteId);
  const parsedApiKey = parseCustomCliRouteApiKeyId(apiKeyId);
  if (!configId) {
    return false;
  }
  return (
    accountId === buildCustomCliRouteAccountId(configId) && parsedApiKey?.configId === configId
  );
}
