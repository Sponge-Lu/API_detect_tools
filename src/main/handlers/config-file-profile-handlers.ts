import { ipcMain } from 'electron';
import type {
  CommitConfigFileProfileInput,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileDirectEditInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  RestoreBuiltinConfigFileProfileInput,
  ResolveConfigFileProfileValuesInput,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from '../../shared/types/config-file-profile';
import {
  commitConfigFileProfile,
  deleteConfigFileProfile,
  generateConfigFileProfileRouteKey,
  getConfigFileTargetCatalog,
  loadConfigFileProfiles,
  previewConfigFileProfile,
  previewConfigFileProfileRouteKeyRotation,
  previewConfigFileDirectEdit,
  readSavedConfigFiles,
  restoreBuiltinConfigFileProfile,
  resolveConfigFileProfileValues,
  upsertConfigFileProfile,
  validateSessionRecordConnector,
} from '../config-file-profile-service';
import { notifyAppDataChanged } from '../app-data-events';

async function mutateConfigFileProfiles<T>(operation: () => Promise<T>): Promise<T> {
  const result = await operation();
  notifyAppDataChanged('config-file-profiles', 20);
  return result;
}

export function registerConfigFileProfileHandlers(): void {
  ipcMain.handle('config-file-profile:load', () => loadConfigFileProfiles());
  ipcMain.handle('config-file-profile:upsert', (_, input: UpsertConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => upsertConfigFileProfile(input))
  );
  ipcMain.handle('config-file-profile:delete', (_, input: DeleteConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => deleteConfigFileProfile(input))
  );
  ipcMain.handle(
    'config-file-profile:generate-route-key',
    (_, input: GenerateConfigFileProfileRouteKeyInput) =>
      mutateConfigFileProfiles(() => generateConfigFileProfileRouteKey(input))
  );
  ipcMain.handle('config-file-profile:target-catalog', () => getConfigFileTargetCatalog());
  ipcMain.handle(
    'config-file-profile:resolve-values',
    (_, input: ResolveConfigFileProfileValuesInput) => resolveConfigFileProfileValues(input)
  );
  ipcMain.handle(
    'config-file-profile:restore-builtin',
    (_, input: RestoreBuiltinConfigFileProfileInput) =>
      mutateConfigFileProfiles(() => restoreBuiltinConfigFileProfile(input))
  );
  ipcMain.handle('config-file-profile:read-files', (_, profileId: string) =>
    readSavedConfigFiles(profileId)
  );
  ipcMain.handle('config-file-profile:preview', (_, input: PreviewConfigFileProfileInput) =>
    previewConfigFileProfile(input)
  );
  ipcMain.handle(
    'config-file-profile:preview-route-key-rotation',
    (_, input: PreviewConfigFileProfileRouteKeyRotationInput) =>
      previewConfigFileProfileRouteKeyRotation(input)
  );
  ipcMain.handle(
    'config-file-profile:preview-direct-edit',
    (_, input: PreviewConfigFileDirectEditInput) => previewConfigFileDirectEdit(input)
  );
  ipcMain.handle('config-file-profile:commit', (_, input: CommitConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => commitConfigFileProfile(input))
  );
  ipcMain.handle(
    'config-file-profile:validate-session-record',
    (_, input: ValidateSessionRecordConnectorInput) => validateSessionRecordConnector(input)
  );
}
