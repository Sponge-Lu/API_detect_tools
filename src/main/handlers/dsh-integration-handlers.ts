/**
 * 输入: dsh-integration-service 的检测/接入/回滚/迁移能力
 * 输出: 注册到 ipcMain 的 `dsh-integration:*` 通道
 * 定位: 集成层 - DSH 会话级路由接入的 IPC 边界，把异常收敛成结构化结果
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/handlers/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { ipcMain } from 'electron';
import {
  detectDshRouting,
  enableDshSessionRouting,
  listDshModelSources,
  migrateDshSessionProviders,
  rollbackDshSessionRouting,
} from '../dsh-integration-service';
import type {
  DshActionResult,
  DshModelSource,
  DshRollbackResult,
  DshRoutingStatus,
  DshSessionMigrationResult,
  EnableDshSessionRoutingInput,
  EnableDshSessionRoutingResult,
} from '../../shared/types/dsh-integration';

async function toResult<T>(operation: () => Promise<T>): Promise<DshActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerDshIntegrationHandlers(): void {
  ipcMain.handle('dsh-integration:status', () =>
    toResult<DshRoutingStatus>(() => detectDshRouting())
  );

  ipcMain.handle('dsh-integration:model-sources', () =>
    toResult<DshModelSource[]>(() => listDshModelSources())
  );

  ipcMain.handle('dsh-integration:enable', (_, input: EnableDshSessionRoutingInput) =>
    toResult<EnableDshSessionRoutingResult>(() => enableDshSessionRouting(input ?? {}))
  );

  ipcMain.handle('dsh-integration:rollback', () =>
    toResult<DshRollbackResult>(() => rollbackDshSessionRouting())
  );

  ipcMain.handle('dsh-integration:migrate-sessions', () =>
    toResult<DshSessionMigrationResult>(() => migrateDshSessionProviders())
  );
}
