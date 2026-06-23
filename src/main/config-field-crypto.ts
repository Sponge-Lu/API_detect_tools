/**
 * 配置字段级加密模块
 * 输入: 明文敏感字段 (api_key, access_token 等)
 * 输出: 加密字段 (encrypted:v1:...)
 * 定位: 主进程工具层 - 在磁盘 I/O 边界透明加解密敏感字段
 *
 * 加密策略:
 * - 使用应用固定密钥 (AES-256-GCM)
 * - 支持密钥版本化 (v1, v2, ...)
 * - 仅在保存到磁盘时加密，加载后立即解密
 * - 内存中的配置对象始终是明文状态
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { UnifiedConfig, UnifiedSite, AccountCredential } from '../shared/types/site';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

// 延迟导入 Logger 以避免 Electron app 依赖在测试环境中失败
let Logger: any;
function getLogger() {
  if (!Logger) {
    try {
      Logger = require('./utils/logger').default;
    } catch {
      // 测试环境回退到 console
      Logger = console;
    }
  }
  return Logger;
}

/**
 * 加密密钥版本化存储
 * v1: 初始密钥（base64 编码）
 */
const ENCRYPTION_KEYS = {
  v1: Buffer.from('h6NsYI/1Voh26Nh5PzwJgcPWZTYtkbQ4V9Hd/dfpPRY=', 'base64'),
  // 将来可添加 v2 实现密钥轮换
};

const CURRENT_KEY_VERSION = 'v1';
const ENCRYPTED_PREFIX = 'encrypted:';

/**
 * 加密单个字段
 * @param plaintext 明文字符串
 * @returns 加密格式: encrypted:v1:{iv}:{authTag}:{ciphertext} (base64 编码)
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  try {
    const key = ENCRYPTION_KEYS[CURRENT_KEY_VERSION];
    const iv = randomBytes(12); // GCM 推荐 12 字节 IV
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return `${ENCRYPTED_PREFIX}${CURRENT_KEY_VERSION}:${iv.toString('base64')}:${authTag}:${encrypted}`;
  } catch (error: any) {
    getLogger().error('[ConfigFieldCrypto] 加密字段失败:', error?.message || error);
    throw new Error(`加密字段失败: ${error?.message || error}`);
  }
}

/**
 * 解密单个字段
 * @param encrypted 加密字符串 (encrypted:v1:...) 或明文字符串
 * @returns 明文字符串
 */
export function decryptField(encrypted: string): string {
  if (!encrypted) {
    return encrypted;
  }

  // 向后兼容：如果不是加密格式，直接返回
  if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
    return encrypted;
  }

  try {
    const withoutPrefix = encrypted.slice(ENCRYPTED_PREFIX.length);
    const parts = withoutPrefix.split(':');

    if (parts.length !== 4) {
      throw new Error('加密格式无效，期望 4 个部分');
    }

    const [version, ivBase64, authTagBase64, ciphertext] = parts;

    const key = ENCRYPTION_KEYS[version as keyof typeof ENCRYPTION_KEYS];
    if (!key) {
      throw new Error(`不支持的密钥版本: ${version}`);
    }

    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error: any) {
    getLogger().error('[ConfigFieldCrypto] 解密字段失败:', error?.message || error);
    throw new Error(`解密字段失败: ${error?.message || error}`);
  }
}

/**
 * 批量加密配置对象中的敏感字段
 * @param config 明文配置对象
 * @returns 敏感字段已加密的配置对象
 */
export function encryptConfigFields(config: UnifiedConfig): UnifiedConfig {
  const encryptedConfig: UnifiedConfig = {
    ...config,
    sites: config.sites.map(encryptSiteFields),
    accounts: config.accounts.map(encryptAccountFields),
  };

  return encryptedConfig;
}

/**
 * 批量解密配置对象中的敏感字段
 * @param config 敏感字段已加密的配置对象
 * @returns 完全明文的配置对象
 */
export function decryptConfigFields(config: UnifiedConfig): UnifiedConfig {
  try {
    const decryptedConfig: UnifiedConfig = {
      ...config,
      sites: config.sites.map(decryptSiteFields),
      accounts: config.accounts.map(decryptAccountFields),
    };

    return decryptedConfig;
  } catch (error: any) {
    getLogger().error('[ConfigFieldCrypto] 解密配置失败:', error?.message || error);
    throw error;
  }
}

/**
 * 加密站点敏感字段
 */
function encryptSiteFields(site: UnifiedSite): UnifiedSite {
  const encryptedSite: UnifiedSite = { ...site };

  if (encryptedSite.api_key) {
    encryptedSite.api_key = encryptField(encryptedSite.api_key);
  }

  if (encryptedSite.access_token) {
    encryptedSite.access_token = encryptField(encryptedSite.access_token);
  }

  // 兼容 legacy system_token 字段
  const siteWithLegacy = encryptedSite as UnifiedSite & { system_token?: string };
  if (siteWithLegacy.system_token) {
    siteWithLegacy.system_token = encryptField(siteWithLegacy.system_token);
  }

  return encryptedSite;
}

/**
 * 解密站点敏感字段
 */
function decryptSiteFields(site: UnifiedSite): UnifiedSite {
  const decryptedSite: UnifiedSite = { ...site };

  if (decryptedSite.api_key) {
    decryptedSite.api_key = decryptField(decryptedSite.api_key);
  }

  if (decryptedSite.access_token) {
    decryptedSite.access_token = decryptField(decryptedSite.access_token);
  }

  // 兼容 legacy system_token 字段
  const siteWithLegacy = decryptedSite as UnifiedSite & { system_token?: string };
  if (siteWithLegacy.system_token) {
    siteWithLegacy.system_token = decryptField(siteWithLegacy.system_token);
  }

  return decryptedSite;
}

/**
 * 加密账户敏感字段
 */
function encryptAccountFields(account: AccountCredential): AccountCredential {
  const encryptedAccount: AccountCredential = { ...account };

  if (encryptedAccount.access_token) {
    encryptedAccount.access_token = encryptField(encryptedAccount.access_token);
  }

  // 兼容嵌套的 account_info.access_token 字段
  const accountWithInfo = encryptedAccount as AccountCredential & {
    account_info?: { access_token?: string };
  };
  if (accountWithInfo.account_info?.access_token) {
    accountWithInfo.account_info = {
      ...accountWithInfo.account_info,
      access_token: encryptField(accountWithInfo.account_info.access_token),
    };
  }

  return encryptedAccount;
}

/**
 * 解密账户敏感字段
 */
function decryptAccountFields(account: AccountCredential): AccountCredential {
  const decryptedAccount: AccountCredential = { ...account };

  if (decryptedAccount.access_token) {
    decryptedAccount.access_token = decryptField(decryptedAccount.access_token);
  }

  // 兼容嵌套的 account_info.access_token 字段
  const accountWithInfo = decryptedAccount as AccountCredential & {
    account_info?: { access_token?: string };
  };
  if (accountWithInfo.account_info?.access_token) {
    accountWithInfo.account_info = {
      ...accountWithInfo.account_info,
      access_token: decryptField(accountWithInfo.account_info.access_token),
    };
  }

  return decryptedAccount;
}

/**
 * 加密 custom-cli-configs 数组中的 apiKey 字段
 * @param configs 明文配置数组
 * @returns apiKey 已加密的配置数组
 */
export function encryptCustomCliConfigs(configs: CustomCliConfig[]): CustomCliConfig[] {
  return configs.map(config => ({
    ...config,
    apiKey: config.apiKey ? encryptField(config.apiKey) : config.apiKey,
  }));
}

/**
 * 解密 custom-cli-configs 数组中的 apiKey 字段
 * @param configs apiKey 已加密的配置数组
 * @returns 完全明文的配置数组
 */
export function decryptCustomCliConfigs(configs: CustomCliConfig[]): CustomCliConfig[] {
  try {
    return configs.map(config => ({
      ...config,
      apiKey: config.apiKey ? decryptField(config.apiKey) : config.apiKey,
    }));
  } catch (error: any) {
    getLogger().error('[ConfigFieldCrypto] 解密 custom-cli-configs 失败:', error?.message || error);
    throw error;
  }
}
