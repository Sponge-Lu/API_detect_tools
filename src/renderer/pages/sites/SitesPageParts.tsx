import { AccountInfo } from './site-projections';

import React from 'react';

import {
  type SiteConfig,
  type DetectionResult,
  type AnyRouterAccountConfig,
} from '../../../shared/types/site';

import type { CustomCliConfig } from '../../../shared/types/custom-cli-config';
export interface BackupInfo {
  filename: string;
  path: string;
  timestamp: Date;
  size: number;
  kind?: 'legacy-config' | 'storage-bundle';
}

export interface AddedAccountInfo {
  id?: string;
  account_name?: string;
  user_id?: string;
}

export interface EditingAccountInfo {
  id: string;
  account_name?: string;
  user_id?: string;
  access_token?: string;
  api_key?: string;
  anyRouterConfig?: AnyRouterAccountConfig;
}

export interface CardOperationContext {
  cardKey: string;
  accountId?: string;
  accountName?: string;
  accessToken?: string;
  userId?: string;
}

export type ManagedCardItem = {
  type: 'managed';
  site: SiteConfig;
  index: number;
  siteResult?: DetectionResult;
  account: AccountInfo | null;
  cardKey: string;
};

export type CustomCliCardItem = {
  type: 'custom-cli';
  config: CustomCliConfig;
  index: number;
  cardKey: string;
  site: SiteConfig;
  account: AccountInfo;
  siteResult: DetectionResult;
};

export type FlattenedCardItem = ManagedCardItem | CustomCliCardItem;

export type SelectedSiteItem =
  | { type: 'managed'; site: SiteConfig; account: AccountInfo | null }
  | { type: 'custom-cli'; config: CustomCliConfig };

export interface SitesPageProps {
  setPageHeaderActions?: (actions: React.ReactNode | null) => void;
}
