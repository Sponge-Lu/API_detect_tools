import { handleStorageIpc } from '../storage/ipc-handler';
import { getApplicationStorage } from '../storage/application-storage';
import { parseStateVersion } from '../../shared/types/app-storage-contract';
import {
  CUSTOM_CLI_EDIT_FIELDS,
  type CustomCliCommandBatch,
} from '../../shared/types/custom-cli-commands';
import { StorageConflictError } from '../storage/database/storage-coordinator';
/**
 * 输入: 自定义 CLI 配置数据
 * 输出: IPC 事件处理响应 (配置操作结果)
 * 定位: IPC 处理层 - 处理自定义 CLI 配置的持久化、模型拉取和保存后的路由模型 registry 同步
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import Logger from '../utils/logger';
import { notifyAppDataChanged } from '../app-data-events';
import {
  loadCustomCliConfigStorage,
  saveCustomCliConfigStorage,
  updateCustomCliConfigStorage,
  type CustomCliConfigStorage,
} from '../custom-cli-config-service';
import { syncModelRegistrySources } from '../route-model-registry-service';

/** IPC 通道名 */
const CHANNELS = {
  LOAD: 'custom-cli-config:load',
  SAVE: 'custom-cli-config:save',
  FETCH_MODELS: 'custom-cli-config:fetch-models',
} as const;

/**
 * 注册自定义 CLI 配置 IPC 处理器
 */
export function registerCustomCliConfigHandlers(): void {
  // 加载配置
  handleStorageIpc(CHANNELS.LOAD, async () => {
    try {
      Logger.info('📖 [CustomCliConfigHandlers] 收到加载配置请求');
      const data = await loadCustomCliConfigStorage();
      return {
        ...data,
        storageVersion: getApplicationStorage()?.coordinator.version('custom-cli-configs'),
      };
    } catch (error: unknown) {
      Logger.error('❌ [CustomCliConfigHandlers] 加载配置失败:', error);
      throw error;
    }
  });

  // 保存配置
  handleStorageIpc(CHANNELS.SAVE, async (_, data: CustomCliConfigStorage) => {
    if (getApplicationStorage())
      throw Object.assign(new Error('Use versioned direct configuration commands'), {
        code: 'LEGACY_WRITE_DISABLED',
      });
    try {
      Logger.info('💾 [CustomCliConfigHandlers] 收到保存配置请求');
      await saveCustomCliConfigStorage(data);
      await syncModelRegistrySources(true);
      notifyAppDataChanged('route-overview');
      return { success: true };
    } catch (error: unknown) {
      Logger.error('❌ [CustomCliConfigHandlers] 保存配置失败:', error);
      throw error;
    }
  });

  handleStorageIpc('custom-cli-config:commands', async (_, batch: CustomCliCommandBatch) => {
    const storage = getApplicationStorage();
    if (
      !storage ||
      !batch ||
      Object.keys(batch).some(key => !['version', 'commands'].includes(key)) ||
      !Array.isArray(batch.commands) ||
      batch.commands.length > 10000
    )
      throw new Error('Invalid direct configuration commands');
    const version = parseStateVersion(batch.version);
    await updateCustomCliConfigStorage(current => {
      const latest = storage.coordinator.version('custom-cli-configs');
      if (JSON.stringify(version) !== JSON.stringify(latest))
        throw new StorageConflictError(latest);
      const next = structuredClone(current);
      for (const command of batch.commands) {
        if (!command || typeof command !== 'object')
          throw new Error('Invalid direct configuration command');
        const allowed =
          command.type === 'upsert'
            ? ['type', 'id', 'create', 'fields']
            : command.type === 'order'
              ? ['type', 'ids']
              : ['type', 'id'];
        if (Object.keys(command).some(key => !allowed.includes(key)))
          throw new Error('Unexpected direct configuration field');
        if (command.type === 'upsert') {
          if (
            typeof command.id !== 'string' ||
            !command.id ||
            typeof command.create !== 'boolean' ||
            !command.fields ||
            typeof command.fields !== 'object' ||
            Array.isArray(command.fields) ||
            Object.keys(command.fields).some(
              key => !(CUSTOM_CLI_EDIT_FIELDS as readonly string[]).includes(key)
            )
          )
            throw new Error('Invalid direct configuration patch');
          const index = next.configs.findIndex(config => config.id === command.id);
          if (command.create ? index >= 0 : index < 0)
            throw new Error('Direct configuration existence changed');
          const fields = Object.fromEntries(
            Object.entries(command.fields).map(([key, value]) => [
              key,
              value === null ? undefined : value,
            ])
          );
          const updated = {
            ...next.configs[index],
            ...fields,
            id: command.id,
          } as CustomCliConfigStorage['configs'][number];
          if (
            typeof updated.name !== 'string' ||
            !updated.name.trim() ||
            typeof updated.baseUrl !== 'string' ||
            !/^https?:\/\//i.test(updated.baseUrl)
          )
            throw new Error('Invalid direct configuration URL or name');
          if (index < 0) next.configs.push(updated);
          else next.configs[index] = updated;
        } else if (command.type === 'delete')
          next.configs = next.configs.filter(config => config.id !== command.id);
        else if (command.type === 'activate') next.activeConfigId = command.id;
        else if (command.type === 'order') {
          if (
            !Array.isArray(command.ids) ||
            new Set(command.ids).size !== next.configs.length ||
            command.ids.length !== next.configs.length
          )
            throw new Error('Invalid direct configuration order');
          next.configs = command.ids.map(id => {
            const config = next.configs.find(item => item.id === id);
            if (!config) throw new Error('Unknown direct configuration identity');
            return config;
          });
        } else throw new Error('Unknown direct configuration command');
      }
      if (next.activeConfigId && !next.configs.some(config => config.id === next.activeConfigId))
        next.activeConfigId = null;
      return next;
    });
    await syncModelRegistrySources(true);
    notifyAppDataChanged('route-overview');
    return { success: true, storageVersion: storage.coordinator.version('custom-cli-configs') };
  });

  // 拉取模型 (通过 configId,走 httpGet → Electron net/axios,接入系统代理)
  handleStorageIpc(CHANNELS.FETCH_MODELS, async (_, configId: string) => {
    try {
      Logger.info(`📡 [CustomCliConfigHandlers] 收到拉取模型请求 (configId=${configId})`);
      const { fetchModels } = await import('../custom-cli-model-service');
      const result = await fetchModels(configId);
      if (!result.success) {
        throw new Error(result.error || '拉取模型失败');
      }
      await syncModelRegistrySources(true);
      notifyAppDataChanged('route-overview');
      return result.models;
    } catch (error: unknown) {
      Logger.error(`❌ [CustomCliConfigHandlers] 拉取模型失败 (configId=${configId}):`, error);
      throw error;
    }
  });

  Logger.info('✅ [CustomCliConfigHandlers] 自定义 CLI 配置 IPC 处理器已注册');
}
