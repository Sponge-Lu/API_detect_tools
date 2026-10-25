import type { SiteType } from '../../shared/types/site';

export type CreateApiTokenPayload = {
  name: string;
  remain_quota: number;
  expired_time: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips: string;
  group: string;
};
export type TokenRequestContext = {
  browserSlot?: number;
  allowBrowserFallback?: boolean;
  challengeWaitMs?: number;
  siteType?: SiteType;
  /** 上游代理地址：站点级代理，检测类 HTTP 请求透传使用 */
  proxyUrl?: string;
};
export type BrowserProfileLaunchOptions = {
  userDataDir?: string;
  profileDirectory?: string;
};
export type InitializeSiteAccountOptions = {
  loginMode?: boolean;
  siteType?: SiteType;
};
export type RefreshAccountBasicInfoOptions = {
  profileOptions?: BrowserProfileLaunchOptions;
};
