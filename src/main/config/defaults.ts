import type { Settings, SiteGroup } from '../../shared/types/site';
export const DEFAULT_SETTINGS: Settings = {
  timeout: 30,
  concurrent: true,
  max_concurrent: 3,
  show_disabled: false,
  browser_path: '',
};

export const DEFAULT_GROUP: SiteGroup = { id: 'default', name: '默认分组' };

export const UNAVAILABLE_GROUP: SiteGroup = { id: 'unavailable', name: '不可用' };
