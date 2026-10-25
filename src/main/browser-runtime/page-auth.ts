import { Page } from 'puppeteer-core';

import Logger from '../utils/logger';
import type { SiteType } from '../../shared/types/site';

export interface LocalStorageData {
  userId: number | null;
  username: string | null;
  systemName: string | null;
  accessToken: string | null;
  sessionAccessToken?: string | null;
  siteTypeHint?: SiteType | null;
  resolvedBaseUrl?: string | null;
  dataSource?: 'localStorage' | 'api' | 'mixed';
  supportsCheckIn?: boolean; // 站点是否支持签到
  canCheckIn?: boolean; // 当前是否可签到
}
export async function tryGetFromLocalStorage(page: Page): Promise<LocalStorageData> {
  return await page.evaluate(() => {
    const data: LocalStorageData = {
      userId: null,
      username: null,
      systemName: null,
      accessToken: null,
      siteTypeHint: null,
      resolvedBaseUrl: null,
      dataSource: 'localStorage',
    };

    const logParseError = (key: string, error: unknown) => {
      console.debug(`[Browser Context] Failed to parse ${key} JSON`, error);
    };

    try {
      const storage = (globalThis as any).localStorage;

      // ===== User ID 多路径获取 =====
      // 路径1: 从user对象获取
      const userStr = storage.getItem('user');
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          data.userId = user.id || user.user_id || user.userId || user.uid || user.user_ID;
        } catch (error) {
          logParseError('user', error);
        }
      }

      // 路径2: 从siteInfo对象获取
      const siteInfoStr = storage.getItem('siteInfo');
      if (siteInfoStr) {
        try {
          const siteInfo = JSON.parse(siteInfoStr);
          data.userId =
            data.userId || siteInfo.id || siteInfo.user_id || siteInfo.userId || siteInfo.uid;
        } catch (error) {
          logParseError('siteInfo', error);
        }
      }

      // 路径3: 从userInfo对象获取
      const userInfoStr = storage.getItem('userInfo');
      if (userInfoStr) {
        try {
          const userInfo = JSON.parse(userInfoStr);
          data.userId = data.userId || userInfo.id || userInfo.user_id || userInfo.userId;
        } catch (error) {
          logParseError('userInfo', error);
        }
      }

      const authUserStr = storage.getItem('auth_user');
      if (authUserStr) {
        try {
          const authUser = JSON.parse(authUserStr);
          data.userId =
            data.userId || authUser.id || authUser.user_id || authUser.userId || authUser.uid;
          data.username =
            data.username ||
            authUser.username ||
            authUser.name ||
            authUser.display_name ||
            authUser.nickname ||
            authUser.email;
        } catch (error) {
          logParseError('auth_user', error);
        }
      }

      // 路径4: 从独立键获取
      if (!data.userId) {
        const idStr =
          storage.getItem('user_id') ||
          storage.getItem('userId') ||
          storage.getItem('uid') ||
          storage.getItem('id');
        if (idStr) {
          const parsed = parseInt(idStr);
          if (!isNaN(parsed)) data.userId = parsed;
        }
      }

      // ===== Username 多路径获取 =====
      // 从user对象
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          data.username =
            user.username ||
            user.name ||
            user.display_name ||
            user.displayName ||
            user.nickname ||
            user.login;
        } catch (error) {
          logParseError('user', error);
        }
      }

      // 从siteInfo对象
      if (siteInfoStr) {
        try {
          const siteInfo = JSON.parse(siteInfoStr);
          data.username =
            data.username ||
            siteInfo.username ||
            siteInfo.name ||
            siteInfo.display_name ||
            siteInfo.user_name;
        } catch (error) {
          logParseError('siteInfo', error);
        }
      }

      // 从userInfo对象
      if (userInfoStr) {
        try {
          const userInfo = JSON.parse(userInfoStr);
          data.username = data.username || userInfo.username || userInfo.name;
        } catch (error) {
          logParseError('userInfo', error);
        }
      }

      // 从独立键
      data.username =
        data.username ||
        storage.getItem('username') ||
        storage.getItem('user_name') ||
        storage.getItem('nickname');

      // ===== System Name 多路径获取 =====
      // 从siteInfo对象
      if (siteInfoStr) {
        try {
          const siteInfo = JSON.parse(siteInfoStr);
          data.systemName =
            siteInfo.system_name ||
            siteInfo.systemName ||
            siteInfo.site_name ||
            siteInfo.siteName ||
            siteInfo.name;
        } catch (error) {
          logParseError('siteInfo', error);
        }
      }

      // 从config对象
      const configStr = storage.getItem('config') || storage.getItem('siteConfig');
      if (configStr) {
        try {
          const config = JSON.parse(configStr);
          data.systemName =
            data.systemName ||
            config.system_name ||
            config.systemName ||
            config.site_name ||
            config.name;
        } catch (error) {
          logParseError('config', error);
        }
      }

      // 从独立键
      data.systemName =
        data.systemName ||
        storage.getItem('system_name') ||
        storage.getItem('systemName') ||
        storage.getItem('site_name') ||
        storage.getItem('siteName') ||
        storage.getItem('app_name');

      // ===== Access Token 多路径获取 =====
      // 从user对象
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          data.accessToken =
            user.access_token ||
            user.accessToken ||
            user.token ||
            user.auth_token ||
            user.authToken ||
            user.api_token;
        } catch (error) {
          logParseError('user', error);
        }
      }

      // 从siteInfo对象
      if (siteInfoStr) {
        try {
          const siteInfo = JSON.parse(siteInfoStr);
          data.accessToken =
            data.accessToken || siteInfo.access_token || siteInfo.accessToken || siteInfo.token;
        } catch (error) {
          logParseError('siteInfo', error);
        }
      }

      // 从auth对象
      const authStr = storage.getItem('auth') || storage.getItem('authentication');
      if (authStr) {
        try {
          const auth = JSON.parse(authStr);
          data.accessToken = data.accessToken || auth.access_token || auth.token;
        } catch (error) {
          logParseError('auth', error);
        }
      }

      // 从独立键
      data.accessToken =
        data.accessToken ||
        storage.getItem('access_token') ||
        storage.getItem('accessToken') ||
        storage.getItem('token') ||
        storage.getItem('auth_token') ||
        storage.getItem('authToken') ||
        storage.getItem('api_token') ||
        storage.getItem('apiToken') ||
        storage.getItem('bearer_token');

      const appConfig = (globalThis as any).__APP_CONFIG__;
      if (appConfig && typeof appConfig === 'object' && !Array.isArray(appConfig)) {
        const appConfigSystemName = [
          appConfig.site_subtitle,
          appConfig.site_name,
          appConfig.siteName,
          appConfig.system_name,
          appConfig.systemName,
          appConfig.name,
        ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

        data.systemName = data.systemName || appConfigSystemName?.trim() || null;

        if (
          !data.siteTypeHint &&
          ('site_subtitle' in appConfig ||
            'custom_menu_items' in appConfig ||
            'purchase_subscription_enabled' in appConfig ||
            'linuxdo_oauth_enabled' in appConfig ||
            'backend_mode_enabled' in appConfig)
        ) {
          data.siteTypeHint = 'sub2api';
        }
      }

      // ===== 签到信息多路径获取 =====
      // 从siteInfo对象获取签到支持状态
      if (siteInfoStr) {
        try {
          const siteInfo = JSON.parse(siteInfoStr);
          // 站点是否支持签到：兼容 Veloera (check_in_enabled) 和 New API (checkin_enabled)
          if (typeof siteInfo.check_in_enabled === 'boolean') {
            data.supportsCheckIn = siteInfo.check_in_enabled;
          } else if (typeof siteInfo.checkin_enabled === 'boolean') {
            data.supportsCheckIn = siteInfo.checkin_enabled;
          }
        } catch (error) {
          logParseError('siteInfo', error);
        }
      }

      // 从user对象获取当前签到状态
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          // 当前是否可签到（从 /api/user/check_in_status 的 can_check_in）
          if (typeof user.can_check_in === 'boolean') {
            data.canCheckIn = user.can_check_in;
          }
        } catch (error) {
          logParseError('user', error);
        }
      }

      // 从status对象获取
      const statusStr = storage.getItem('status') || storage.getItem('siteStatus');
      if (statusStr) {
        try {
          const status = JSON.parse(statusStr);
          // 兼容 Veloera (check_in_enabled) 和 New API (checkin_enabled)
          data.supportsCheckIn =
            data.supportsCheckIn ?? status.check_in_enabled ?? status.checkin_enabled;
        } catch (error) {
          logParseError('status', error);
        }
      }

      // 从checkIn对象获取（Veloera格式）
      const checkInStr = storage.getItem('checkIn') || storage.getItem('check_in');
      if (checkInStr) {
        try {
          const checkIn = JSON.parse(checkInStr);
          data.canCheckIn = data.canCheckIn ?? checkIn.can_check_in;
          data.supportsCheckIn = data.supportsCheckIn ?? checkIn.enabled;
        } catch (error) {
          logParseError('checkIn', error);
        }
      }

      // 从checkin对象获取（New API格式）
      const checkinStr = storage.getItem('checkin');
      if (checkinStr) {
        try {
          const checkin = JSON.parse(checkinStr);
          // New API 格式: { enabled: true, stats: { checked_in_today: boolean } }
          if (typeof checkin.enabled === 'boolean') {
            data.supportsCheckIn = data.supportsCheckIn ?? checkin.enabled;
          }
          if (checkin.stats && typeof checkin.stats.checked_in_today === 'boolean') {
            // checked_in_today=false 表示可签到，取反
            data.canCheckIn = data.canCheckIn ?? !checkin.stats.checked_in_today;
          }
        } catch (error) {
          logParseError('checkin', error);
        }
      }
    } catch (error) {
      console.error('[Browser Context] Failed to read localStorage:', error);
    }

    return data;
  });
}

export function parseUserDataResponse(data: any): LocalStorageData {
  // 兼容多种响应格式
  let userData: any = null;
  if (typeof data?.code === 'number' && data.data) {
    userData = data.data;
  } else if (data?.success && data.data) {
    userData = data.data;
  } else if (data?.data) {
    userData = data.data;
  } else if (data?.id || data?.user_id) {
    userData = data;
  }

  if (!userData) {
    throw new Error('响应格式不正确');
  }

  return {
    userId:
      userData.id ||
      userData.user_id ||
      userData.userId ||
      userData.uid ||
      userData.user_ID ||
      null,
    username:
      userData.username ||
      userData.name ||
      userData.display_name ||
      userData.displayName ||
      userData.nickname ||
      userData.login ||
      userData.user_name ||
      null,
    accessToken:
      userData.access_token ||
      userData.accessToken ||
      userData.token ||
      userData.auth_token ||
      userData.authToken ||
      userData.api_token ||
      userData.bearer_token ||
      null,
    systemName: null,
    siteTypeHint: null,
    dataSource: 'api',
  };
}

export async function readUserIdHintFromPage(page: any): Promise<number | string | null> {
  try {
    return await page.evaluate(() => {
      const s = (globalThis as any).localStorage;
      const parseJSON = (str: string | null) => {
        try {
          return str ? JSON.parse(str) : null;
        } catch {
          return null;
        }
      };
      const user = parseJSON(s.getItem('user')) || {};
      const siteInfo = parseJSON(s.getItem('siteInfo')) || {};
      const userInfo = parseJSON(s.getItem('userInfo')) || {};

      return (
        user.id ??
        user.user_id ??
        user.userId ??
        user.uid ??
        user.user_ID ??
        siteInfo.id ??
        siteInfo.user_id ??
        siteInfo.userId ??
        siteInfo.uid ??
        userInfo.id ??
        userInfo.user_id ??
        userInfo.userId ??
        s.getItem('user_id') ??
        s.getItem('userId') ??
        s.getItem('uid') ??
        s.getItem('id') ??
        null
      );
    });
  } catch (error: any) {
    Logger.info(`ℹ️ [ChromeManager] 读取页面 userId 提示失败: ${error.message}`);
    return null;
  }
}
