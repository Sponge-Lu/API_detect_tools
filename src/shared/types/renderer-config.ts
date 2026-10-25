import type { SiteConfig, AccountCredential } from './site';
import type { StateVersion } from './app-storage-contract';
export interface Settings {
  timeout: number;
  concurrent: boolean;
  max_concurrent?: number;
  show_disabled: boolean;
  browser_path?: string;
  webdav?: {
    enabled: boolean;
    serverUrl: string;
    username: string;
    password: string;
    remotePath: string;
    maxBackups: number;
  };
  sort?: {
    field: string | null;
    order: 'asc' | 'desc';
  };
}

export interface SiteGroup {
  id: string;
  name: string;
}

export interface Config {
  storageVersion?: StateVersion;
  sites: SiteConfig[];
  accounts?: AccountCredential[];
  settings: Settings;
  siteGroups?: SiteGroup[];
}

export type { SiteConfig, DetectionResult } from './site';
