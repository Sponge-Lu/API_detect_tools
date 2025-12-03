/**
 * 数据验证 Schema
 * 使用 Zod 进行前后端统一的数据验证
 */

import { z } from 'zod';

// ============= 基础 Schema =============

/**
 * URL 验证 Schema
 * 支持 http 和 https 协议
 */
export const urlSchema = z
  .string()
  .min(1, 'URL 不能为空')
  .transform(val => {
    // 自动补全协议
    let url = val.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    return url;
  })
  .refine(
    val => {
      try {
        const parsed = new URL(val);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL 格式不正确，请输入有效的 http 或 https 地址' }
  );

/**
 * 站点名称 Schema
 */
export const siteNameSchema = z
  .string()
  .min(1, '站点名称不能为空')
  .max(50, '站点名称不能超过 50 个字符')
  .transform(val => val.trim());

/**
 * API Key Schema
 * 支持 sk- 前缀格式
 */
export const apiKeySchema = z
  .string()
  .optional()
  .transform(val => (val ? val.trim() : ''));

/**
 * 系统令牌 Schema
 */
export const systemTokenSchema = z
  .string()
  .optional()
  .transform(val => (val ? val.trim() : ''));

/**
 * 用户 ID Schema
 */
export const userIdSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true;
      const num = parseInt(val, 10);
      return !isNaN(num) && num > 0;
    },
    { message: '用户 ID 必须是正整数' }
  )
  .transform(val => (val ? val.trim() : ''));

// ============= 复合 Schema =============

/**
 * 站点配置 Schema
 */
export const siteConfigSchema = z.object({
  name: siteNameSchema,
  url: urlSchema,
  api_key: apiKeySchema,
  system_token: systemTokenSchema,
  user_id: userIdSchema,
  enabled: z.boolean().default(true),
  group: z.string().optional().default('default'),
  has_checkin: z.boolean().optional().default(false),
  force_enable_checkin: z.boolean().optional().default(false),
  extra_links: z.string().optional().default(''),
});

/**
 * 创建 API Token 表单 Schema
 */
export const createApiTokenSchema = z
  .object({
    name: z
      .string()
      .min(1, '令牌名称不能为空')
      .max(100, '令牌名称不能超过 100 个字符')
      .transform(val => val.trim()),
    group: z.string().min(1, '请选择分组').default('default'),
    unlimitedQuota: z.boolean().default(true),
    quota: z.string().optional(),
    expiredTime: z
      .string()
      .optional()
      .refine(
        val => {
          if (!val || val.trim() === '') return true; // 允许空值（永不过期）
          const date = new Date(val);
          return !isNaN(date.getTime()) && date.getTime() > Date.now();
        },
        { message: '过期时间必须是未来的时间' }
      ),
  })
  .refine(
    data => {
      // 如果是无限额度，不需要验证 quota
      if (data.unlimitedQuota) return true;
      // 有限额度时，quota 必须是正数
      if (!data.quota || data.quota.trim() === '') return false;
      const num = parseFloat(data.quota);
      return !isNaN(num) && num > 0;
    },
    { message: '额度必须是大于 0 的数字', path: ['quota'] }
  );

/**
 * 应用设置 Schema
 */
export const settingsSchema = z.object({
  timeout: z.number().min(5, '超时时间至少 5 秒').max(300, '超时时间不能超过 300 秒').default(30),
  concurrent: z.boolean().default(true),
  show_disabled: z.boolean().default(true),
  auto_refresh: z.boolean().default(false),
  refresh_interval: z
    .number()
    .min(60, '刷新间隔至少 60 秒')
    .max(3600, '刷新间隔不能超过 3600 秒')
    .default(300),
  browser_path: z.string().optional(),
});

/**
 * 站点分组 Schema
 */
export const siteGroupSchema = z.object({
  id: z.string().min(1, '分组 ID 不能为空'),
  name: z
    .string()
    .min(1, '分组名称不能为空')
    .max(20, '分组名称不能超过 20 个字符')
    .transform(val => val.trim()),
});

/**
 * 完整配置 Schema
 */
export const configSchema = z.object({
  sites: z.array(siteConfigSchema),
  settings: settingsSchema,
  siteGroups: z.array(siteGroupSchema).optional(),
});

// ============= 类型导出 =============

export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfigOutput = z.output<typeof siteConfigSchema>;
export type CreateApiTokenInput = z.input<typeof createApiTokenSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;
export type SiteGroupInput = z.input<typeof siteGroupSchema>;
export type ConfigInput = z.input<typeof configSchema>;

// ============= 验证工具函数 =============

/**
 * 验证 URL 并返回结果
 */
export function validateUrl(
  url: string
): { success: true; data: string } | { success: false; error: string } {
  const result = urlSchema.safeParse(url);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error?.issues || [];
  return { success: false, error: issues[0]?.message || 'URL 验证失败' };
}

/**
 * 验证站点配置并返回结果
 */
export function validateSiteConfig(
  config: unknown
): { success: true; data: SiteConfigOutput } | { success: false; errors: string[] } {
  const result = siteConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error?.issues || [];
  return {
    success: false,
    errors: issues.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * 验证创建 API Token 表单
 */
export function validateCreateApiToken(
  data: unknown
):
  | { success: true; data: z.output<typeof createApiTokenSchema> }
  | { success: false; errors: string[] } {
  const result = createApiTokenSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error?.issues || [];
  return {
    success: false,
    errors: issues.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

/**
 * 验证完整配置
 */
export function validateConfig(
  config: unknown
): { success: true; data: z.output<typeof configSchema> } | { success: false; errors: string[] } {
  const result = configSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error?.issues || [];
  return {
    success: false,
    errors: issues.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
