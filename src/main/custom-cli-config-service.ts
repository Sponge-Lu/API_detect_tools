/**
 * 自定义 CLI 配置服务
 * 输入: Electron userData/custom-cli-configs.json, OpenAI 兼容模型端点
 * 输出: 自定义 CLI 配置存储、模型列表、路由虚拟通道标识
 * 定位: 主进程服务层 - 复用自定义 CLI 配置持久化与路由通道标识生成
 *
 * 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import Logger from './utils/logger';
import type { CustomCliConfig, CustomCliSettings } from '../shared/types/custom-cli-config';
import { normalizeCustomCliSettings } from '../shared/types/custom-cli-config';
import {
  CUSTOM_CLI_ROUTE_GROUP,
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteChannel,
  parseCustomCliRouteConfigId,
} from '../shared/utils/customCliRouteId';
import { encryptCustomCliConfigs, decryptCustomCliConfigs } from './config-field-crypto';
import { routeStateAffinityService } from './route-state-affinity-service';
import {
  BUILTIN_CLI_TYPES,
  CLI_TARGET_PROTOCOLS,
  normalizeCliTargetProtocol,
  type CliTargetProtocol,
} from '../shared/types/cli-config';

export interface CustomCliConfigStorage {
  configs: CustomCliConfig[];
  activeConfigId: string | null;
}

export const DEFAULT_CUSTOM_CLI_CONFIG_STORAGE: CustomCliConfigStorage = {
  configs: [],
  activeConfigId: null,
};

export {
  CUSTOM_CLI_ROUTE_GROUP,
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteChannel,
  parseCustomCliRouteConfigId,
};

export function getCustomCliConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'custom-cli-configs.json');
}

function normalizeCustomCliConfigs(configs: CustomCliConfig[]): void {
  for (const config of configs) {
    const legacyValues = new Set<CliTargetProtocol>();
    if (
      !(
        typeof config.routeTargetProtocol === 'string' &&
        CLI_TARGET_PROTOCOLS.includes(config.routeTargetProtocol)
      )
    ) {
      for (const cliType of BUILTIN_CLI_TYPES) {
        const value = config.cliSettings?.[cliType]?.targetProtocol;
        if (typeof value === 'string' && CLI_TARGET_PROTOCOLS.includes(value)) {
          legacyValues.add(normalizeCliTargetProtocol(value));
        }
      }
    }
    config.cliSettings = Object.fromEntries(
      BUILTIN_CLI_TYPES.map(cliType => [
        cliType,
        normalizeCustomCliSettings(config.cliSettings?.[cliType]),
      ])
    ) as Record<(typeof BUILTIN_CLI_TYPES)[number], CustomCliSettings>;
    if (
      typeof config.routeTargetProtocol === 'string' &&
      CLI_TARGET_PROTOCOLS.includes(config.routeTargetProtocol)
    ) {
      config.routeTargetProtocol = normalizeCliTargetProtocol(config.routeTargetProtocol);
      continue;
    }
    if (legacyValues.size === 1) {
      config.routeTargetProtocol = Array.from(legacyValues)[0];
      config.routeTargetProtocolNeedsConfirmation = false;
    } else if (legacyValues.size > 1) {
      config.routeTargetProtocol = 'native';
      config.routeTargetProtocolNeedsConfirmation = true;
    }
  }
}

export async function loadCustomCliConfigStorage(): Promise<CustomCliConfigStorage> {
  const filePath = getCustomCliConfigFilePath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const configs = Array.isArray(data.configs) ? data.configs : [];
    const decryptedConfigs = decryptCustomCliConfigs(configs);

    normalizeCustomCliConfigs(decryptedConfigs);

    return {
      configs: decryptedConfigs,
      activeConfigId: typeof data.activeConfigId === 'string' ? data.activeConfigId : null,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      Logger.info('[CustomCliConfigService] 配置文件不存在，使用默认配置');
      return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
    }
    Logger.error('[CustomCliConfigService] 读取配置文件失败:', error);
    return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
  }
}

export function loadCustomCliConfigStorageSync(): CustomCliConfigStorage {
  const filePath = getCustomCliConfigFilePath();
  try {
    const content = fsSync.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const configs = Array.isArray(data.configs) ? data.configs : [];
    const decryptedConfigs = decryptCustomCliConfigs(configs);

    normalizeCustomCliConfigs(decryptedConfigs);

    return {
      configs: decryptedConfigs,
      activeConfigId: typeof data.activeConfigId === 'string' ? data.activeConfigId : null,
    };
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
    }
    Logger.error('[CustomCliConfigService] 同步读取配置文件失败:', error);
    return DEFAULT_CUSTOM_CLI_CONFIG_STORAGE;
  }
}

export async function saveCustomCliConfigStorage(data: CustomCliConfigStorage): Promise<void> {
  const filePath = getCustomCliConfigFilePath();
  const previous = await loadCustomCliConfigStorage();
  try {
    const encryptedData = {
      configs: encryptCustomCliConfigs(data.configs),
      activeConfigId: data.activeConfigId,
    };
    await fs.writeFile(filePath, JSON.stringify(encryptedData, null, 2), 'utf-8');
    const nextIds = new Set(data.configs.map(config => config.id));
    await routeStateAffinityService.removeBySites(
      previous.configs
        .filter(config => !nextIds.has(config.id))
        .map(config => buildCustomCliRouteSiteId(config.id))
    );
    Logger.info('[CustomCliConfigService] 配置文件已保存');
  } catch (error: unknown) {
    const rollbackData = {
      configs: encryptCustomCliConfigs(previous.configs),
      activeConfigId: previous.activeConfigId,
    };
    await fs.writeFile(filePath, JSON.stringify(rollbackData, null, 2), 'utf-8');
    Logger.error('[CustomCliConfigService] 保存配置文件失败:', error);
    throw error;
  }
}
