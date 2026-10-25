import type { CliTargetProtocol, CliUpstreamProtocol } from '../../../shared/types/cli-config';

import {
  type SiteConfig,
  type DetectionResult,
  type AnyRouterAccountConfig,
  type AccountAuthSource,
  type RouteAuthScheme,
} from '../../../shared/types/site';

import type { CustomCliConfig } from '../../../shared/types/custom-cli-config';
import {
  buildCustomCliRouteAccountId,
  buildCustomCliRouteSiteId,
} from '../../../shared/utils/customCliRouteId';

// 账户信息（来自 accounts:list IPC）
export interface AccountInfo {
  id: string;
  account_name: string;
  user_id: string;
  username?: string;
  access_token?: string;
  api_key?: string;
  status: string;
  auth_source: AccountAuthSource | 'browser' | 'custom-cli';
  browser_profile_path?: string;
  auto_refresh?: boolean;
  auto_refresh_interval?: number;
  routeTargetProtocol?: CliTargetProtocol;
  routeTargetProtocolNeedsConfirmation?: boolean;
  routeAuthScheme?: RouteAuthScheme;
  supportedProtocols?: CliUpstreamProtocol[];
  anyRouterConfig?: AnyRouterAccountConfig;
}

/** 生成 per-account 复合 key */
export function makeCardKey(siteName: string, accountId?: string): string {
  return accountId ? `${siteName}::${accountId}` : siteName;
}

export function getCustomCliDisplayName(config: CustomCliConfig): string {
  return config.name?.trim() || '未命名直连配置';
}

export function buildCustomCliVirtualSite(
  config: CustomCliConfig,
  defaultGroupId: string
): SiteConfig {
  return {
    id: buildCustomCliRouteSiteId(config.id),
    name: getCustomCliDisplayName(config),
    url: config.baseUrl || '',
    api_key: config.apiKey || '',
    extra_links: config.gasStationUrl,
    enabled: true,
    group: defaultGroupId,
  };
}

export function buildCustomCliVirtualAccount(config: CustomCliConfig): AccountInfo {
  return {
    id: buildCustomCliRouteAccountId(config.id),
    account_name: '直连配置',
    user_id: '',
    access_token: config.apiKey || '',
    status: config.baseUrl ? 'active' : 'incomplete',
    auth_source: 'custom-cli',
  };
}

export function buildCustomCliVirtualResult(config: CustomCliConfig): DetectionResult {
  return {
    name: getCustomCliDisplayName(config),
    url: config.baseUrl || '',
    status: config.baseUrl && config.apiKey ? '成功' : '未配置',
    models: Array.from(
      new Set(
        [...(config.models || []), ...(config.manualModels || [])]
          .map(model => model.trim())
          .filter(model => model.length > 0)
      )
    ),
    has_checkin: false,
    accountId: buildCustomCliRouteAccountId(config.id),
    lastRefresh: config.lastModelFetch,
  };
}
