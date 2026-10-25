import { ChromeManager } from '../chrome-manager';
import { httpGet, httpPost } from '../utils/http-client';

import type { CheckinStats } from '../../shared/types/site';
import { getAllUserIdHeaders } from '../../shared/utils/headers';
import Logger from '../utils/logger';
import { runOnPageQueue } from '../utils/page-exec-queue';

import type { SiteType } from '../../shared/types/site';

export interface TokenOperationContext {
  isBrowserChallengeResponse(data: unknown): boolean;
  getCheckInEndpoints(
    baseUrl: string,
    mode: 'status' | 'action',
    explicitSiteType?: SiteType
  ): Array<{ url: string; type: 'veloera' | 'newapi' }>;
  createRequestHeaders(
    userId: number,
    accessToken: string,
    siteUrl?: string,
    explicitSiteType?: SiteType
  ): Record<string, string>;
  chromeManager: ChromeManager;
  waitForCloudflareChallengeToPass(page: any, maxWaitMs?: number): Promise<void>;
  fetchCheckinStats(
    baseUrl: string,
    userId: number,
    accessToken: string,
    page?: any
  ): Promise<CheckinStats | undefined>;
  checkInWithBrowser(
    baseUrl: string,
    userId: number,
    accessToken: string,
    explicitSiteType?: SiteType,
    browserSlot?: number
  ): Promise<{
    success: boolean;
    message: string;
    needManualCheckIn?: boolean;
    reward?: number;
    siteType?: 'veloera' | 'newapi';
    checkinStats?: CheckinStats;
    browserPage?: any;
    pageRelease?: () => void;
  }>;
}
export async function checkSiteSupportsCheckIn(
  dependencies: TokenOperationContext,
  baseUrl: string,
  page?: any
): Promise<boolean> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${cleanBaseUrl}/api/status`;

  try {
    Logger.info('🔍 [TokenService] 检查站点配置:', url);

    // 优先使用浏览器模式（如果有共享页面）
    if (page) {
      Logger.info('♻️ [TokenService] 使用浏览器页面获取站点配置');
      try {
        const result = await runOnPageQueue(page, () =>
          page.evaluate(async (apiUrl: string) => {
            const response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include',
            });
            return await response.json();
          }, url)
        );

        // 兼容两种站点类型：Veloera (check_in_enabled) 和 New API (checkin_enabled)
        const checkInEnabled =
          result?.data?.check_in_enabled === true || result?.data?.checkin_enabled === true;
        Logger.info(
          `${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${result?.data?.check_in_enabled}, checkin_enabled=${result?.data?.checkin_enabled})`
        );
        return checkInEnabled;
      } catch (browserError: any) {
        Logger.warn('⚠️ [TokenService] 浏览器模式获取站点配置失败:', browserError.message);
        // 浏览器模式失败，回退到axios
      }
    }

    // HTTP 请求（打包环境自动使用 Electron net 模块）
    const response = await httpGet(url, {
      timeout: 10000,
      validateStatus: (status: number) => status < 500,
    });

    const rawData = response.data;

    // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
    if (dependencies.isBrowserChallengeResponse(rawData)) {
      Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截，无法获取站点配置');
      return false;
    }

    const data = rawData && typeof rawData === 'object' ? rawData : null;

    // 调试：打印完整响应结构
    Logger.info('📦 [TokenService] /api/status 响应结构:', {
      hasSuccess: !!data && 'success' in data,
      successValue: data?.success,
      hasData: !!data && 'data' in data,
      dataType: typeof data?.data,
      checkInEnabledValue: data?.data?.check_in_enabled,
      checkinEnabledValue: data?.data?.checkin_enabled,
    });

    // 兼容两种站点类型：Veloera (check_in_enabled) 和 New API (checkin_enabled)
    const checkInEnabled =
      data?.data?.check_in_enabled === true || data?.data?.checkin_enabled === true;
    Logger.info(
      `${checkInEnabled ? '✅' : 'ℹ️'} [TokenService] 站点${checkInEnabled ? '支持' : '不支持'}签到功能 (check_in_enabled=${data?.data?.check_in_enabled}, checkin_enabled=${data?.data?.checkin_enabled})`
    );
    return checkInEnabled;
  } catch (error: any) {
    Logger.info('⚠️ [TokenService] 无法获取站点配置:', error.message);
    return false;
  }
}

export async function fetchCheckInStatus(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page?: any,
  explicitSiteType?: SiteType
): Promise<boolean | undefined> {
  const endpoints = dependencies.getCheckInEndpoints(baseUrl, 'status', explicitSiteType);

  if (endpoints.length === 0) {
    Logger.info('ℹ️ [TokenService] 当前站点类型未注册签到状态端点');
    return undefined;
  }

  for (const endpoint of endpoints) {
    try {
      Logger.info(`🔍 [TokenService] 获取签到状态 (${endpoint.type}):`, endpoint.url);

      // 优先使用浏览器模式（如果有共享页面）
      if (page) {
        Logger.info('♻️ [TokenService] 使用浏览器页面获取签到状态');
        try {
          const userIdHeaders = getAllUserIdHeaders(userId);
          const result = await runOnPageQueue(page, () =>
            page.evaluate(
              async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
                const headers: Record<string, string> = {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                  ...additionalHeaders,
                };

                const response = await fetch(apiUrl, {
                  method: 'GET',
                  credentials: 'include',
                  headers: headers,
                });
                return await response.json();
              },
              endpoint.url,
              accessToken,
              userIdHeaders
            )
          );

          // 解析浏览器返回的结果
          if (result?.success && result?.data) {
            // Veloera 格式: { can_check_in: boolean, checked_in_days: number }
            if (typeof result.data.can_check_in === 'boolean') {
              const canCheckIn = result.data.can_check_in;
              const checkedInDays = result.data.checked_in_days || 0;
              Logger.info(
                `✅ [TokenService] 签到状态(浏览器模式, Veloera): ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`
              );
              return canCheckIn;
            }

            // New API 格式: { enabled: boolean, stats: { checked_in_today: boolean } }
            if (result.data.stats && typeof result.data.stats.checked_in_today === 'boolean') {
              const checkedInToday = result.data.stats.checked_in_today;
              const canCheckIn = !checkedInToday; // 取反：checked_in_today=false 表示可签到
              const totalCheckins = result.data.stats.total_checkins || 0;
              Logger.info(
                `✅ [TokenService] 签到状态(浏览器模式, New API): ${canCheckIn ? '可签到' : '已签到'}, 累计签到${totalCheckins}次`
              );
              return canCheckIn;
            }
          }

          Logger.warn('⚠️ [TokenService] 浏览器模式返回数据格式不符合预期，尝试下一个端点');
          continue;
        } catch (browserError: any) {
          Logger.warn('⚠️ [TokenService] 浏览器模式获取签到状态失败:', browserError.message);
          // 浏览器模式失败，回退到axios
        }
      }

      // HTTP 请求（打包环境自动使用 Electron net 模块）
      const response = await httpGet(endpoint.url, {
        headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      });

      // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
      if (dependencies.isBrowserChallengeResponse(response.data)) {
        Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截签到状态接口');
        continue;
      }

      if (response.data?.success && response.data?.data) {
        // Veloera 格式: { can_check_in: boolean, checked_in_days: number }
        if (typeof response.data.data.can_check_in === 'boolean') {
          const canCheckIn = response.data.data.can_check_in;
          const checkedInDays = response.data.data.checked_in_days || 0;
          Logger.info(
            `✅ [TokenService] 签到状态(Veloera): ${canCheckIn ? '可签到' : '已签到'}, 连续签到${checkedInDays}天`
          );
          return canCheckIn;
        }

        // New API 格式: { enabled: boolean, stats: { checked_in_today: boolean } }
        if (
          response.data.data.stats &&
          typeof response.data.data.stats.checked_in_today === 'boolean'
        ) {
          const checkedInToday = response.data.data.stats.checked_in_today;
          const canCheckIn = !checkedInToday; // 取反：checked_in_today=false 表示可签到
          const totalCheckins = response.data.data.stats.total_checkins || 0;
          Logger.info(
            `✅ [TokenService] 签到状态(New API): ${canCheckIn ? '可签到' : '已签到'}, 累计签到${totalCheckins}次`
          );
          return canCheckIn;
        }
      }

      Logger.warn(`⚠️ [TokenService] ${endpoint.type} 响应格式不符合预期，尝试下一个端点`);
    } catch (error: any) {
      const status = error.response?.status;
      Logger.info(`⚠️ [TokenService] ${endpoint.type} 端点失败:`, {
        status,
        message: error.message,
      });

      // 404 = 接口不存在，尝试下一个端点
      if (status === 404) {
        Logger.info(`ℹ️ [TokenService] ${endpoint.type} 接口不存在，尝试下一个端点`);
        continue;
      }
    }
  }

  Logger.info('ℹ️ [TokenService] 所有签到状态端点均不可用');
  return undefined;
}

export async function checkIn(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page?: any,
  explicitSiteType?: SiteType,
  browserSlot?: number
): Promise<{
  success: boolean;
  message: string;
  needManualCheckIn?: boolean; // 是否需要手动签到
  reward?: number; // 签到奖励（内部单位）
  siteType?: 'veloera' | 'newapi'; // 站点类型（用于确定手动签到页面路径）
  checkinStats?: CheckinStats; // 签到统计数据 (New API)
  browserPage?: any; // 浏览器页面（用于后续余额刷新）
  pageRelease?: () => void; // 页面释放函数
}> {
  Logger.info('📝 [TokenService] 执行签到操作...');
  Logger.info('📍 [TokenService] 站点:', baseUrl);
  Logger.info('🆔 [TokenService] 用户ID:', userId);

  const endpoints = dependencies.getCheckInEndpoints(baseUrl, 'action', explicitSiteType);

  if (endpoints.length === 0) {
    return {
      success: false,
      message: '当前站点类型未注册签到端点',
      needManualCheckIn: false,
    };
  }

  let lastError: any = null;
  let lastEndpointType: 'veloera' | 'newapi' = 'veloera'; // 记录最后尝试的端点类型
  let cloudflareDetected = false; // 是否检测到 Cloudflare 拦截

  for (const endpoint of endpoints) {
    try {
      lastEndpointType = endpoint.type as 'veloera' | 'newapi';
      Logger.info(`🔍 [TokenService] 尝试签到端点 (${endpoint.type}): ${endpoint.url}`);

      const response = await httpPost(
        endpoint.url,
        {},
        {
          headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
          timeout: 15000,
          validateStatus: (status: number) => status < 500,
        }
      );

      // 检测 Cloudflare/挑战页拦截（响应是 HTML 而不是 JSON）
      if (dependencies.isBrowserChallengeResponse(response.data)) {
        Logger.info(`🛡️ [TokenService] 检测到 Cloudflare 拦截签到接口 (${endpoint.type})`);
        cloudflareDetected = true;
        continue; // 尝试下一个端点
      }

      Logger.info(`📦 [TokenService] 签到响应 (${endpoint.type}):`, {
        success: response.data?.success,
        message: response.data?.message,
        hasReward: !!response.data?.data?.reward,
        hasQuotaAwarded: !!response.data?.data?.quota_awarded,
      });

      // 签到成功
      if (response.data?.success === true) {
        // Veloera 格式: { reward: number }
        const reward = response.data.data?.reward;
        // New API 格式: { quota_awarded: number }
        const quotaAwarded = response.data.data?.quota_awarded;

        let message = response.data.message || '签到成功！';
        const finalReward = reward || quotaAwarded;

        // 如果有奖励，添加到消息中
        if (finalReward && typeof finalReward === 'number') {
          const rewardInDollars = (finalReward / 500000).toFixed(4);
          message += `\n🎁 获得奖励: $${rewardInDollars}`;
        }

        Logger.info(`✅ [TokenService] 签到成功 (${endpoint.type}): ${message}`);

        // 如果是 New API 类型，获取签到统计数据
        let checkinStats: CheckinStats | undefined;
        if (endpoint.type === 'newapi') {
          try {
            checkinStats = await dependencies.fetchCheckinStats(baseUrl, userId, accessToken, page);
            // 如果没有从 API 获取到今日签到金额，使用签到返回的 quota_awarded
            if (checkinStats && checkinStats.todayQuota === undefined && quotaAwarded) {
              checkinStats.todayQuota = quotaAwarded;
            }
          } catch (statsError: any) {
            Logger.warn('⚠️ [TokenService] 获取签到统计失败，但签到已成功:', statsError.message);
          }
        }

        return {
          success: true,
          message: message,
          reward: finalReward,
          siteType: endpoint.type as 'veloera' | 'newapi',
          checkinStats,
        };
      }

      // 签到失败的情况
      if (response.data?.success === false) {
        const errorMsg = response.data.message || '签到失败';
        Logger.info(`ℹ️ [TokenService] 签到失败 (${endpoint.type}): ${errorMsg}`);

        // 站点回复"已签到"说明账号今日已完成，属正常状态而非需要人工介入的失败
        const alreadyCheckedIn = errorMsg.includes('已签到');
        if (alreadyCheckedIn) {
          return {
            success: false,
            message: '今日已签到',
            needManualCheckIn: false,
            siteType: endpoint.type as 'veloera' | 'newapi',
          };
        }

        // 检查是否需要人机验证或手动签到
        const needManual =
          errorMsg.includes('验证') ||
          errorMsg.includes('人机') ||
          errorMsg.includes('captcha') ||
          errorMsg.includes('challenge') ||
          errorMsg.toLowerCase().includes('turnstile');

        return {
          success: false,
          message: errorMsg,
          needManualCheckIn: needManual,
          siteType: endpoint.type as 'veloera' | 'newapi',
        };
      }

      // 未知响应格式，尝试下一个端点
      Logger.warn(`⚠️ [TokenService] ${endpoint.type} 未知的响应格式，尝试下一个端点`);
    } catch (error: any) {
      const status = error.response?.status;
      Logger.info(`⚠️ [TokenService] ${endpoint.type} 端点失败:`, {
        status,
        message: error.message,
      });

      lastError = error;

      // 404 = 接口不存在，尝试下一个端点
      if (status === 404) {
        Logger.info(`ℹ️ [TokenService] ${endpoint.type} 接口不存在，尝试下一个端点`);
        continue;
      }

      // 401 = 登录过期或未登录，403 = 权限不足（这些错误不需要尝试其他端点）
      if (status === 401) {
        return {
          success: false,
          message: '登录已过期或未登录，请重新登录站点获取凭证',
          needManualCheckIn: true,
          siteType: endpoint.type as 'veloera' | 'newapi',
        };
      }
      if (status === 403) {
        return {
          success: false,
          message: '权限不足，请检查账号状态是否正常',
          needManualCheckIn: true,
          siteType: endpoint.type as 'veloera' | 'newapi',
        };
      }

      // 其他错误，继续尝试下一个端点
      continue;
    }
  }

  // 所有端点都失败
  Logger.error('❌ [TokenService] 所有签到端点均失败');

  // 如果检测到 Cloudflare 拦截，尝试浏览器模式签到
  if (cloudflareDetected) {
    Logger.info('🛡️ [TokenService] 检测到 Cloudflare 拦截，尝试浏览器模式签到...');
    try {
      const browserResult = await dependencies.checkInWithBrowser(
        baseUrl,
        userId,
        accessToken,
        explicitSiteType,
        browserSlot
      );
      if (browserResult.success) {
        return browserResult;
      }
      // 浏览器模式也失败，返回浏览器模式的错误信息
      return browserResult;
    } catch (browserError: any) {
      Logger.error('❌ [TokenService] 浏览器模式签到失败:', browserError.message);
      return {
        success: false,
        message: '站点开启了 Cloudflare 保护，浏览器模式签到也失败',
        needManualCheckIn: true,
        siteType: lastEndpointType,
      };
    }
  }

  if (lastError) {
    const errorMsg = lastError.response?.data?.message || lastError.message || '签到失败';
    return {
      success: false,
      message: `签到失败: ${errorMsg}`,
      needManualCheckIn: true,
      siteType: lastEndpointType,
    };
  }

  return {
    success: false,
    message: '该站点不支持签到功能（接口不存在）',
    needManualCheckIn: false,
  };
}

export async function checkInWithBrowser(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  explicitSiteType?: SiteType,
  browserSlot?: number
): Promise<{
  success: boolean;
  message: string;
  needManualCheckIn?: boolean;
  reward?: number;
  siteType?: 'veloera' | 'newapi';
  checkinStats?: CheckinStats;
  browserPage?: any; // 浏览器页面（签到成功时返回，供后续余额刷新使用）
  pageRelease?: () => void; // 页面释放函数
}> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const endpoints = dependencies.getCheckInEndpoints(baseUrl, 'action', explicitSiteType);

  if (endpoints.length === 0) {
    return {
      success: false,
      message: '当前站点类型未注册签到端点',
      needManualCheckIn: false,
    };
  }

  Logger.info('🧭 [TokenService] 浏览器模式签到...');
  Logger.info('📍 [TokenService] 站点:', cleanBaseUrl);

  // 通过 ChromeManager 创建页面（携带账户槽位，避免多账户浏览器回退共用 slot-0 会话造成串号）
  const { page, release } = await dependencies.chromeManager.createPage(cleanBaseUrl, {
    slot: browserSlot,
  });

  // 用于跟踪是否需要在失败时关闭页面
  let shouldClosePage = true;

  try {
    // 确保页面前置，方便用户在 Cloudflare 页面中进行验证
    await page.bringToFront().catch(() => {});

    // 等待 Cloudflare 验证通过（如果存在）
    await dependencies.waitForCloudflareChallengeToPass(page);
    const userIdHeaders = getAllUserIdHeaders(userId);

    let lastError: any = null;
    let lastEndpointType: 'veloera' | 'newapi' = 'veloera';

    for (const endpoint of endpoints) {
      lastEndpointType = endpoint.type as 'veloera' | 'newapi';
      Logger.info(`📡 [TokenService] 浏览器签到: ${endpoint.url}`);

      try {
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              try {
                const response = await fetch(apiUrl, {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...additionalHeaders,
                    Pragma: 'no-cache',
                  },
                  body: JSON.stringify({}),
                });

                const status = response.status;
                const text = await response.text();

                try {
                  const data = JSON.parse(text);
                  return { ok: response.ok, status, isJson: true, data };
                } catch {
                  return {
                    ok: response.ok,
                    status,
                    isJson: false,
                    textSnippet: text.slice(0, 200),
                  };
                }
              } catch (err: any) {
                return {
                  ok: false,
                  status: 0,
                  isJson: false,
                  error: err?.message || String(err),
                };
              }
            },
            endpoint.url,
            accessToken,
            userIdHeaders
          )
        );

        Logger.info('📦 [TokenService] 浏览器签到结果:', result);

        // 检查是否返回 HTML（仍然被 Cloudflare 拦截）
        if (!result.isJson && dependencies.isBrowserChallengeResponse(result.textSnippet)) {
          Logger.warn('⚠️ [TokenService] 浏览器模式仍被 Cloudflare 拦截，尝试下一个端点');
          continue;
        }

        // 签到成功
        if (result.isJson && result.data?.success === true) {
          const reward = result.data.data?.reward;
          const quotaAwarded = result.data.data?.quota_awarded;
          const finalReward = reward || quotaAwarded;

          let message = result.data.message || '签到成功！';
          if (finalReward && typeof finalReward === 'number') {
            const rewardInDollars = (finalReward / 500000).toFixed(4);
            message += `\n🎁 获得奖励: $${rewardInDollars}`;
          }

          Logger.info(`✅ [TokenService] 浏览器签到成功 (${endpoint.type}): ${message}`);

          // 如果是 New API 类型，获取签到统计数据
          let checkinStats: CheckinStats | undefined;
          if (endpoint.type === 'newapi') {
            try {
              checkinStats = await dependencies.fetchCheckinStats(
                baseUrl,
                userId,
                accessToken,
                page
              );
              if (checkinStats && checkinStats.todayQuota === undefined && quotaAwarded) {
                checkinStats.todayQuota = quotaAwarded;
              }
            } catch (statsError: any) {
              Logger.warn('⚠️ [TokenService] 获取签到统计失败，但签到已成功:', statsError.message);
            }
          }

          // 签到成功，不关闭页面，返回页面引用供后续余额刷新使用
          shouldClosePage = false;

          return {
            success: true,
            message: message,
            reward: finalReward,
            siteType: endpoint.type as 'veloera' | 'newapi',
            checkinStats,
            browserPage: page,
            pageRelease: release,
          };
        }

        // 签到失败
        if (result.isJson && result.data?.success === false) {
          const errorMsg = result.data.message || '签到失败';
          Logger.info(`ℹ️ [TokenService] 浏览器签到失败 (${endpoint.type}): ${errorMsg}`);

          // 站点回复"已签到"属正常状态，不触发手动签到引导
          const alreadyCheckedIn = errorMsg.includes('已签到');
          if (alreadyCheckedIn) {
            return {
              success: false,
              message: '今日已签到',
              needManualCheckIn: false,
              siteType: endpoint.type as 'veloera' | 'newapi',
            };
          }

          const needManual =
            errorMsg.includes('验证') ||
            errorMsg.includes('人机') ||
            errorMsg.includes('captcha') ||
            errorMsg.includes('challenge') ||
            errorMsg.toLowerCase().includes('turnstile');

          return {
            success: false,
            message: errorMsg,
            needManualCheckIn: needManual,
            siteType: endpoint.type as 'veloera' | 'newapi',
          };
        }

        // HTTP 错误
        if (!result.ok || result.status >= 400) {
          const reason = result.isJson
            ? result.data?.message || `HTTP ${result.status}`
            : result.textSnippet || `HTTP ${result.status}`;
          Logger.warn(`⚠️ [TokenService] 浏览器签到 HTTP 错误 (${endpoint.type}):`, reason);
          lastError = new Error(reason);
          continue;
        }

        // 未知响应格式
        Logger.warn(`⚠️ [TokenService] 浏览器签到未知响应格式 (${endpoint.type})`);
        lastError = new Error('未知响应格式');
      } catch (error: any) {
        Logger.warn(`⚠️ [TokenService] 浏览器签到端点失败 (${endpoint.type}):`, error.message);
        lastError = error;
        continue;
      }
    }

    // 所有端点都失败
    if (lastError) {
      return {
        success: false,
        message: `浏览器模式签到失败: ${lastError.message}`,
        needManualCheckIn: true,
        siteType: lastEndpointType,
      };
    }

    return {
      success: false,
      message: '浏览器模式签到失败（接口不存在）',
      needManualCheckIn: true,
      siteType: lastEndpointType,
    };
  } finally {
    // 只有在失败时才关闭页面，成功时由调用者负责释放
    if (shouldClosePage) {
      try {
        await page.close();
      } catch {
        // 忽略关闭错误
      }
      release();
    }
  }
}

export async function fetchCheckinStats(
  dependencies: TokenOperationContext,
  baseUrl: string,
  userId: number,
  accessToken: string,
  page?: any
): Promise<CheckinStats | undefined> {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  // 使用本地时区日期：站点的 checkin_date 为站点本地日期，UTC 会在 UTC+8 的 0-8 点错位
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const currentMonth = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`; // YYYY-MM 格式
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`; // YYYY-MM-DD 格式
  const url = `${cleanBaseUrl}/api/user/checkin?month=${currentMonth}`;

  Logger.info('📊 [TokenService] 获取签到统计...');
  Logger.info('📍 [TokenService] URL:', url);

  try {
    // 优先使用浏览器模式（如果有共享页面）
    if (page) {
      Logger.info('♻️ [TokenService] 使用浏览器页面获取签到统计');
      try {
        const userIdHeaders = getAllUserIdHeaders(userId);
        const result = await runOnPageQueue(page, () =>
          page.evaluate(
            async (apiUrl: string, token: string, additionalHeaders: Record<string, string>) => {
              const headers: Record<string, string> = {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...additionalHeaders,
              };

              const response = await fetch(apiUrl, {
                method: 'GET',
                credentials: 'include',
                headers: headers,
              });
              return await response.json();
            },
            url,
            accessToken,
            userIdHeaders
          )
        );

        // 解析浏览器返回的结果
        if (result?.success && result?.data?.stats) {
          const stats = result.data.stats;
          let todayQuota: number | undefined;

          // 从 records 中查找今日签到金额
          if (stats.records && Array.isArray(stats.records)) {
            const todayRecord = stats.records.find(
              (r: { checkin_date: string; quota_awarded: number }) => r.checkin_date === today
            );
            if (todayRecord) {
              todayQuota = todayRecord.quota_awarded;
            }
          }

          const checkinStats: CheckinStats = {
            todayQuota,
            checkinCount: stats.checkin_count,
            totalCheckins: stats.total_checkins,
            siteType: 'newapi',
          };

          Logger.info('✅ [TokenService] 签到统计获取成功(浏览器模式):', {
            todayQuota,
            checkinCount: stats.checkin_count,
            totalCheckins: stats.total_checkins,
          });

          return checkinStats;
        }

        Logger.warn('⚠️ [TokenService] 浏览器模式返回数据格式不符合预期');
      } catch (browserError: any) {
        Logger.warn('⚠️ [TokenService] 浏览器模式获取签到统计失败:', browserError.message);
        // 浏览器模式失败，回退到axios
      }
    }

    // HTTP 请求（打包环境自动使用 Electron net 模块）
    const response = await httpGet(url, {
      headers: dependencies.createRequestHeaders(userId, accessToken, baseUrl),
      timeout: 10000,
      validateStatus: (status: number) => status < 500,
    });

    // 检查是否返回HTML/挑战页（Cloudflare 或其他站点防护）
    if (dependencies.isBrowserChallengeResponse(response.data)) {
      Logger.info('🛡️ [TokenService] 检测到Cloudflare拦截签到统计接口');
      return undefined;
    }

    if (response.data?.success && response.data?.data?.stats) {
      const stats = response.data.data.stats;
      let todayQuota: number | undefined;

      // 从 records 中查找今日签到金额
      if (stats.records && Array.isArray(stats.records)) {
        const todayRecord = stats.records.find(
          (r: { checkin_date: string; quota_awarded: number }) => r.checkin_date === today
        );
        if (todayRecord) {
          todayQuota = todayRecord.quota_awarded;
        }
      }

      const checkinStats: CheckinStats = {
        todayQuota,
        checkinCount: stats.checkin_count,
        totalCheckins: stats.total_checkins,
        siteType: 'newapi',
      };

      Logger.info('✅ [TokenService] 签到统计获取成功:', {
        todayQuota,
        checkinCount: stats.checkin_count,
        totalCheckins: stats.total_checkins,
      });

      return checkinStats;
    }

    Logger.warn('⚠️ [TokenService] 签到统计响应格式不符合预期');
    return undefined;
  } catch (error: any) {
    Logger.warn('⚠️ [TokenService] 获取签到统计失败:', error.message);
    return undefined;
  }
}
