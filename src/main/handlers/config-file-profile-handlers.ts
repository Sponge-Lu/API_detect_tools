import { handleStorageIpc } from '../storage/ipc-handler';

import type {
  ConfigFileBackupInput,
  PreviewConfigFileBackupRestoreInput,
  CommitConfigFileProfileInput,
  DeleteConfigFileProfileInput,
  GenerateConfigFileProfileRouteKeyInput,
  PreviewConfigFileDirectEditInput,
  PreviewConfigFileProfileInput,
  PreviewConfigFileProfileRouteKeyRotationInput,
  RestoreBuiltinConfigFileProfileInput,
  ResolveConfigFileProfileValuesInput,
  SwitchBuiltinConfigFileProfileAuthModeInput,
  UpsertConfigFileProfileInput,
  ValidateSessionRecordConnectorInput,
} from '../../shared/types/config-file-profile';
import {
  listSavedConfigFileBackups,
  previewConfigFileBackupRestore,
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
  restoreMissingBuiltinConfigFileProfiles,
  switchBuiltinConfigFileProfileAuthMode,
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
  handleStorageIpc('config-file-profile:load', () => loadConfigFileProfiles());
  handleStorageIpc('config-file-profile:upsert', (_, input: UpsertConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => upsertConfigFileProfile(input))
  );
  handleStorageIpc('config-file-profile:delete', (_, input: DeleteConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => deleteConfigFileProfile(input))
  );
  handleStorageIpc(
    'config-file-profile:generate-route-key',
    (_, input: GenerateConfigFileProfileRouteKeyInput) =>
      mutateConfigFileProfiles(() => generateConfigFileProfileRouteKey(input))
  );
  handleStorageIpc('config-file-profile:target-catalog', () => getConfigFileTargetCatalog());
  handleStorageIpc(
    'config-file-profile:resolve-values',
    (_, input: ResolveConfigFileProfileValuesInput) => resolveConfigFileProfileValues(input)
  );
  handleStorageIpc(
    'config-file-profile:restore-builtin',
    (_, input: RestoreBuiltinConfigFileProfileInput) =>
      mutateConfigFileProfiles(() => restoreBuiltinConfigFileProfile(input))
  );
  handleStorageIpc('config-file-profile:restore-missing-builtins', () =>
    mutateConfigFileProfiles(() => restoreMissingBuiltinConfigFileProfiles())
  );
  handleStorageIpc(
    'config-file-profile:switch-auth-mode',
    (_, input: SwitchBuiltinConfigFileProfileAuthModeInput) =>
      mutateConfigFileProfiles(() => switchBuiltinConfigFileProfileAuthMode(input))
  );
  handleStorageIpc('config-file-profile:read-files', (_, profileId: string) =>
    readSavedConfigFiles(profileId)
  );
  handleStorageIpc('config-file-profile:list-backups', (_, input: ConfigFileBackupInput) =>
    listSavedConfigFileBackups(input)
  );
  handleStorageIpc(
    'config-file-profile:preview-backup-restore',
    (_, input: PreviewConfigFileBackupRestoreInput) => previewConfigFileBackupRestore(input)
  );
  handleStorageIpc('config-file-profile:preview', (_, input: PreviewConfigFileProfileInput) =>
    previewConfigFileProfile(input)
  );
  handleStorageIpc(
    'config-file-profile:preview-route-key-rotation',
    (_, input: PreviewConfigFileProfileRouteKeyRotationInput) =>
      previewConfigFileProfileRouteKeyRotation(input)
  );
  handleStorageIpc(
    'config-file-profile:preview-direct-edit',
    (_, input: PreviewConfigFileDirectEditInput) => previewConfigFileDirectEdit(input)
  );
  handleStorageIpc('config-file-profile:commit', (_, input: CommitConfigFileProfileInput) =>
    mutateConfigFileProfiles(() => commitConfigFileProfile(input))
  );
  handleStorageIpc(
    'config-file-profile:validate-session-record',
    (_, input: ValidateSessionRecordConnectorInput) => validateSessionRecordConnector(input)
  );
}
