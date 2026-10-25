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

import * as path from 'path';
import Logger from './utils/logger';
import { writeTextFileAtomically } from './utils/atomic-json';
import { readStorageText, readStorageTextSync } from './storage/application-storage';
import type { CustomCliConfig, CustomCliSettings } from '../shared/types/custom-cli-config';
import {
  normalizeCustomCliApiKeys,
  normalizeCustomCliSettings,
} from '../shared/types/custom-cli-config';
import { buildCustomCliRouteSiteId } from '../shared/utils/customCliRouteId';
import { encryptCustomCliConfigs, decryptCustomCliConfigs } from './config-field-crypto';
import { routeStateAffinityService } from './route-state-affinity-service';
import {
  BUILTIN_CLI_TYPES,
  CLI_TARGET_PROTOCOLS,
  normalizeCliTargetProtocol,
  normalizeCliUpstreamProtocolsWithDefault,
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
  parseCustomCliRouteApiKeyId,
  parseCustomCliRouteConfigId,
} from '../shared/utils/customCliRouteId';

export function getCustomCliConfigFilePath(): string {
  return path.join(app.getPath('userData'), 'custom-cli-configs.json');
}

export function prepareCustomCliConfigs(value: unknown): CustomCliConfigStorage {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as CustomCliConfigStorage).configs)
  )
    throw new Error('Invalid direct configuration storage');
  const source = value as CustomCliConfigStorage;
  const configs = decryptCustomCliConfigs(structuredClone(source.configs));
  normalizeCustomCliConfigs(configs);
  return { ...source, configs, activeConfigId: source.activeConfigId ?? null };
}

function normalizeCustomCliConfigs(configs: CustomCliConfig[]): void {
  for (const config of configs) {
    config.supportedProtocols = normalizeCliUpstreamProtocolsWithDefault(config.supportedProtocols);
    if (config.routeAuthScheme !== 'bearer' && config.routeAuthScheme !== 'x-api-key') {
      delete config.routeAuthScheme;
    }
    if (typeof config.modelUrl === 'string') {
      const modelUrl = config.modelUrl.trim();
      config.modelUrl = modelUrl || undefined;
    }
    config.apiKeys = normalizeCustomCliApiKeys(config.apiKeys, {
      legacyApiKey: config.apiKey,
      legacyName: config.name,
      legacyGroupMultiplier: config.groupMultiplier,
    });
    // `apiKey` is a legacy compatibility projection. Never let a stale projection overwrite
    // the ordered multi-key list; derive it from the first configured key instead.
    if (config.apiKeys[0]) config.apiKey = config.apiKeys[0].key;
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
      config.routeTargetProtocolNeedsConfirmation = Boolean(
        config.routeTargetProtocolNeedsConfirmation
      );
      continue;
    }
    if (legacyValues.size === 1) {
      config.routeTargetProtocol = Array.from(legacyValues)[0];
      config.routeTargetProtocolNeedsConfirmation = false;
    } else if (legacyValues.size > 1) {
      config.routeTargetProtocol = 'native';
      config.routeTargetProtocolNeedsConfirmation = true;
    } else {
      config.routeTargetProtocol = 'native';
      config.routeTargetProtocolNeedsConfirmation = false;
    }
  }
}

async function persistNormalizedCustomCliConfigs(
  filePath: string,
  configs: CustomCliConfig[],
  activeConfigId: string | null
): Promise<void> {
  try {
    await writeTextFileAtomically(
      filePath,
      JSON.stringify({ configs: encryptCustomCliConfigs(configs), activeConfigId }, null, 2),
      { encoding: 'utf-8' }
    );
  } catch (error) {
    Logger.warn('[CustomCliConfigService] 规范化旧配置后写回失败:', error);
  }
}

let storageQueue: Promise<unknown> = Promise.resolve();

function serializeStorage<T>(operation: () => Promise<T>): Promise<T> {
  const pending = storageQueue.then(operation, operation);
  storageQueue = pending.catch(() => undefined);
  return pending;
}

export function loadCustomCliConfigStorage(): Promise<CustomCliConfigStorage> {
  return serializeStorage(readCustomCliConfigStorage);
}

async function readCustomCliConfigStorage(): Promise<CustomCliConfigStorage> {
  const filePath = getCustomCliConfigFilePath();
  try {
    const content = await readStorageText(filePath);
    const data = JSON.parse(content);
    if (!data || !Array.isArray(data.configs))
      throw new Error('Invalid direct configuration storage');
    const configs = data.configs;
    const decryptedConfigs = decryptCustomCliConfigs(configs);

    const beforeNormalization = JSON.stringify(decryptedConfigs);
    normalizeCustomCliConfigs(decryptedConfigs);
    if (JSON.stringify(decryptedConfigs) !== beforeNormalization) {
      await persistNormalizedCustomCliConfigs(
        filePath,
        decryptedConfigs,
        typeof data.activeConfigId === 'string' ? data.activeConfigId : null
      );
    }

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
      return { configs: [], activeConfigId: null };
    }
    Logger.error('[CustomCliConfigService] 读取配置文件失败:', error);
    throw error;
  }
}

export function loadCustomCliConfigStorageSync(): CustomCliConfigStorage {
  const filePath = getCustomCliConfigFilePath();
  try {
    const content = readStorageTextSync(filePath);
    const data = JSON.parse(content);
    if (!data || !Array.isArray(data.configs))
      throw new Error('Invalid direct configuration storage');
    const configs = data.configs;
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
      return { configs: [], activeConfigId: null };
    }
    Logger.error('[CustomCliConfigService] 同步读取配置文件失败:', error);
    throw error;
  }
}

export async function updateCustomCliConfigStorage(
  update: (current: CustomCliConfigStorage) => CustomCliConfigStorage | null
): Promise<CustomCliConfigStorage> {
  return serializeStorage(async () => {
    const previous = await readCustomCliConfigStorage();
    const next = update(previous);
    if (!next) return previous;
    await persistCustomCliConfigStorage(next, previous);
    return next;
  });
}

export async function saveCustomCliConfigStorage(data: CustomCliConfigStorage): Promise<void> {
  await updateCustomCliConfigStorage(current => ({
    ...data,
    configs: data.configs.map(config => {
      const latest = current.configs.find(item => item.id === config.id);
      if (
        !latest ||
        latest.baseUrl !== config.baseUrl ||
        latest.modelUrl !== config.modelUrl ||
        latest.routeAuthScheme !== config.routeAuthScheme
      )
        return config;
      const keys = normalizeCustomCliApiKeys(config.apiKeys, { legacyApiKey: config.apiKey });
      const latestKeys = normalizeCustomCliApiKeys(latest.apiKeys, { legacyApiKey: latest.apiKey });
      let changed = false;
      const merged = keys.map(key => {
        const persisted = latestKeys.find(item => item.id === key.id && item.key === key.key);
        if (!persisted || (persisted.lastModelFetch || 0) <= (key.lastModelFetch || 0)) return key;
        changed = true;
        return { ...key, models: persisted.models, lastModelFetch: persisted.lastModelFetch };
      });
      return changed
        ? {
            ...config,
            apiKeys: merged,
            models: Array.from(new Set(merged.flatMap(key => key.models))),
            lastModelFetch: Math.max(config.lastModelFetch || 0, latest.lastModelFetch || 0),
          }
        : config;
    }),
  }));
}

async function persistCustomCliConfigStorage(
  data: CustomCliConfigStorage,
  previous: CustomCliConfigStorage
): Promise<void> {
  const filePath = getCustomCliConfigFilePath();
  const normalizedConfigs = data.configs.map(config => ({ ...config }));
  normalizeCustomCliConfigs(normalizedConfigs);
  try {
    const encryptedData = {
      configs: encryptCustomCliConfigs(normalizedConfigs),
      activeConfigId: data.activeConfigId,
    };
    await writeTextFileAtomically(filePath, JSON.stringify(encryptedData, null, 2));
  } catch (error) {
    Logger.error('[CustomCliConfigService] 保存配置文件失败:', error);
    throw error;
  }
  try {
    const nextIds = new Set(normalizedConfigs.map(config => config.id));
    await routeStateAffinityService.removeBySites(
      previous.configs
        .filter(config => !nextIds.has(config.id))
        .map(config => buildCustomCliRouteSiteId(config.id))
    );
  } catch (error) {
    Logger.warn('[CustomCliConfigService] 清理已删除配置的关联状态失败:', error);
  }
  Logger.info('[CustomCliConfigService] 配置文件已保存');
}
