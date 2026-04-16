import { DEFAULT_SITE_TYPE, type SiteType } from '../shared/types/site';

export interface SiteTypeProfile {
  siteType: SiteType;
  includeUserIdHeaders: boolean;
  modelEndpoints: string[];
  apiKeyModelEndpoints: string[];
  balanceEndpoints: string[];
  initializationUserEndpoints: string[];
  usageMode: 'logs' | 'sub2api-usage-stats';
  accessTokenMode: 'create-if-missing' | 'local-storage-only';
  apiTokenListEndpoints: string[];
  userGroupEndpoints: string[];
  modelPricingEndpoints: string[];
  supportsModelPricing: boolean;
}

const LEGACY_TOKEN_LIST_ENDPOINTS = [
  '/api/token/?page=1&size=100&keyword=&order=-id',
  '/api/token/?p=1&size=100',
  '/api/token/?p=0&size=100',
  '/api/token/',
];

const SITE_TYPE_PROFILES: Record<SiteType, SiteTypeProfile> = {
  oneapi: {
    siteType: 'oneapi',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/user/available_models'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: ['/api/token/'],
    userGroupEndpoints: ['/api/group'],
    modelPricingEndpoints: [],
    supportsModelPricing: false,
  },
  newapi: {
    siteType: 'newapi',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/user/models'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user/self/groups', '/api/user/groups'],
    modelPricingEndpoints: ['/api/pricing'],
    supportsModelPricing: true,
  },
  veloera: {
    siteType: 'veloera',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/user/models'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user/self/groups', '/api/user/groups'],
    modelPricingEndpoints: ['/api/pricing'],
    supportsModelPricing: true,
  },
  onehub: {
    siteType: 'onehub',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/available_model'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user_group_map'],
    modelPricingEndpoints: ['/api/available_model'],
    supportsModelPricing: true,
  },
  donehub: {
    siteType: 'donehub',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/available_model'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user_group_map'],
    modelPricingEndpoints: ['/api/available_model'],
    supportsModelPricing: true,
  },
  voapi: {
    siteType: 'voapi',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/available_model', '/api/user/models'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user_group_map', '/api/user/self/groups'],
    modelPricingEndpoints: ['/api/available_model', '/api/pricing'],
    supportsModelPricing: true,
  },
  superapi: {
    siteType: 'superapi',
    includeUserIdHeaders: true,
    modelEndpoints: ['/api/user/models'],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/user/self', '/api/user/dashboard'],
    initializationUserEndpoints: ['/api/user/self', '/api/user/dashboard', '/api/user'],
    usageMode: 'logs',
    accessTokenMode: 'create-if-missing',
    apiTokenListEndpoints: LEGACY_TOKEN_LIST_ENDPOINTS,
    userGroupEndpoints: ['/api/user/self/groups', '/api/user/groups'],
    modelPricingEndpoints: ['/api/pricing'],
    supportsModelPricing: true,
  },
  sub2api: {
    siteType: 'sub2api',
    includeUserIdHeaders: false,
    modelEndpoints: [],
    apiKeyModelEndpoints: ['/v1/models'],
    balanceEndpoints: ['/api/v1/auth/me'],
    initializationUserEndpoints: ['/api/v1/auth/me'],
    usageMode: 'sub2api-usage-stats',
    accessTokenMode: 'local-storage-only',
    apiTokenListEndpoints: [
      '/api/v1/keys?page=1&page_size=100',
      '/api/v1/keys?page=1&page_size=20',
      '/api/v1/keys?page=1&page_size=20&timezone=Asia%2FShanghai',
      '/api/v1/keys',
    ],
    userGroupEndpoints: ['/api/v1/groups/available'],
    modelPricingEndpoints: [],
    supportsModelPricing: false,
  },
};

export function resolveSiteType(site?: { site_type?: SiteType } | null): SiteType {
  return site?.site_type || DEFAULT_SITE_TYPE;
}

export function getSiteTypeProfile(siteType?: SiteType): SiteTypeProfile {
  return SITE_TYPE_PROFILES[siteType || DEFAULT_SITE_TYPE];
}
