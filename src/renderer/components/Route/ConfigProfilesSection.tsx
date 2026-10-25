import { RuleEditor } from './ConfigProfileRuleEditor';
import { ApplyPreviewPanel } from './ConfigProfilePreview';
import { createProfile, encodeTarget, errorMessage } from './config-profile-view';
/**
 * 配置文件卡片区
 * 输入: window.electronAPI.configFileProfiles (load/upsert/delete/preview/previewDirectEdit/commit/readFiles/...)
 * 输出: 配置方案摘要卡片、编辑弹窗、模板应用/本地文件保存预览
 * 定位: 展示层 - 本地路由页内的配置文件卡片区（原「配置文件」页内容）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Eye, FileCog, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type {
  ConfigFileApplyMode,
  ConfigFileAuthMode,
  ConfigFileDefinition,
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  ConfigFileResolvedTargetValues,
  ConfigFileSnapshot,
  ConfigFileBackup,
  ConfigFileTargetCatalogEntry,
} from '../../../shared/types/config-file-profile';

import { BUILTIN_CLI_IDS, BUILTIN_CLI_TYPES } from '../../../shared/types/cli-config';
import { AppButton } from '../AppButton/AppButton';
import { AppCard } from '../AppCard';
import { AppModal } from '../AppModal/AppModal';

import { AgentLogo } from '../AgentLogo';
import { toast } from '../../store/toastStore';
import { isDshConfigProfile } from '../../../shared/config/dsh-client-config';
import {
  DshConfigControls,
  getDshConfigModelSources,
  useDshRoutingStatus,
} from './DshConfigControls';

export function ConfigProfilesSection() {
  const [profiles, setProfiles] = useState<ConfigFileProfile[]>([]);
  const dsh = useDshRoutingStatus(profiles.some(isDshConfigProfile));
  const [savedResolvedValues, setSavedResolvedValues] = useState<
    Record<string, ConfigFileResolvedTargetValues>
  >({});
  const [profileBaselines, setProfileBaselines] = useState<Record<string, ConfigFileProfile>>({});
  const [catalog, setCatalog] = useState<ConfigFileTargetCatalogEntry[]>([]);
  const [persistedIds, setPersistedIds] = useState<Set<string>>(new Set());
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [showAllModels, setShowAllModels] = useState<Record<string, boolean>>({});
  const [snapshots, setSnapshots] = useState<Record<string, ConfigFileSnapshot[]>>({});
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [applyProfileId, setApplyProfileId] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<ConfigFileApplyMode>('merge');
  const [preview, setPreview] = useState<ConfigFilePreviewTransaction | null>(null);
  const [restoreProfileId, setRestoreProfileId] = useState<string | null>(null);
  const [backupDialog, setBackupDialog] = useState<{
    profileId: string;
    fileId: string;
    path: string;
    revision?: number;
    entries: ConfigFileBackup[];
  } | null>(null);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [authModeTarget, setAuthModeTarget] = useState<{
    profile: ConfigFileProfile;
    authMode: ConfigFileAuthMode;
  } | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [visibleRouteKeys, setVisibleRouteKeys] = useState<Record<string, boolean>>({});
  const [deleteProfileTarget, setDeleteProfileTarget] = useState<ConfigFileProfile | null>(null);
  const [rotateKeyTarget, setRotateKeyTarget] = useState<ConfigFileProfile | null>(null);
  const [rotatingRouteKey, setRotatingRouteKey] = useState(false);
  const pendingProfileRefreshRef = useRef(false);
  const profileGeneration = useRef(0);
  const guardProfileResponse = useCallback(async <T,>(result: Promise<T>): Promise<T> => {
    const generation = profileGeneration.current;
    const value = await result;
    if (generation !== profileGeneration.current)
      throw new Error('应用数据已恢复，请重新预览或保存草稿');
    return value;
  }, []);
  const reloadSequence = useRef(0);
  const catalogSequence = useRef(0);
  const [deleteFileTarget, setDeleteFileTarget] = useState<{
    profileId: string;
    fileId: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const request = ++reloadSequence.current;
    const [loadedProfiles, targetCatalog] = await Promise.all([
      window.electronAPI.configFileProfiles.load(),
      window.electronAPI.configFileProfiles.getTargetCatalog?.() ?? Promise.resolve([]),
    ]);
    if (request !== reloadSequence.current) return;
    const configProfiles = loadedProfiles.filter(profile => !profile.credentialOnly);
    setProfiles(configProfiles);
    setProfileBaselines(current => ({
      ...current,
      ...Object.fromEntries(configProfiles.map(profile => [profile.id, profile])),
    }));
    setPersistedIds(new Set(configProfiles.map(profile => profile.id)));
    setCatalog(targetCatalog);
    const resolvedEntries = await Promise.all(
      configProfiles
        .filter(profile => !profile.lastApplied)
        .map(async profile => {
          try {
            const values = await guardProfileResponse(
              window.electronAPI.configFileProfiles.resolveValues({ profile })
            );
            return values ? ([profile.id, values] as const) : null;
          } catch {
            return null;
          }
        })
    );
    if (request !== reloadSequence.current) return;
    setSavedResolvedValues(
      Object.fromEntries(
        resolvedEntries.filter((entry): entry is NonNullable<typeof entry> => !!entry)
      )
    );
  }, []);

  const refreshCatalog = useCallback(async () => {
    const request = ++catalogSequence.current;
    const catalog = await guardProfileResponse(
      window.electronAPI.configFileProfiles.getTargetCatalog()
    );
    if (request === catalogSequence.current) setCatalog(catalog);
  }, []);

  useEffect(() => {
    void reload().catch(error => toast.error(errorMessage(error, '加载配置文件失败')));
  }, [reload]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains, restored }) => {
      if (!domains.includes('config-file-profiles')) return;
      if (restored) {
        profileGeneration.current++;
        reloadSequence.current++;
        catalogSequence.current++;
        setPreview(null);
        setSnapshots({});
        setSavedResolvedValues({});
        setBackupDialog(null);
      }
      if (hasUnsavedChanges) {
        pendingProfileRefreshRef.current = true;
        return;
      }
      void reload().catch(error => toast.error(errorMessage(error, '刷新配置文件凭证失败')));
    });
    return () => unsubscribe?.();
  }, [hasUnsavedChanges, reload]);

  useEffect(() => {
    if (hasUnsavedChanges || !pendingProfileRefreshRef.current) return;
    pendingProfileRefreshRef.current = false;
    void reload().catch(error => toast.error(errorMessage(error, '刷新配置文件凭证失败')));
  }, [hasUnsavedChanges, reload]);

  useEffect(() => {
    const handleFocus = () => void refreshCatalog();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshCatalog();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshCatalog]);

  const selectedProfile = profiles.find(profile => profile.id === selectedProfileId) || null;
  const applyProfile = profiles.find(profile => profile.id === applyProfileId) || null;
  const restoreProfile = profiles.find(profile => profile.id === restoreProfileId) || null;
  const missingBuiltinCount = [...BUILTIN_CLI_TYPES, 'deepseekHarness' as const].filter(
    clientType =>
      !profiles.some(
        profile =>
          profile.builtin?.clientType === clientType ||
          (clientType !== 'deepseekHarness' && profile.id === BUILTIN_CLI_IDS[clientType])
      )
  ).length;

  const updateProfile = (
    profileId: string,
    update: (profile: ConfigFileProfile) => ConfigFileProfile
  ) => {
    setProfiles(current =>
      current.map(profile =>
        profile.id === profileId ? { ...update(profile), updatedAt: Date.now() } : profile
      )
    );
    setPreview(null);
    setHasUnsavedChanges(true);
  };

  const updateFile = (
    profileId: string,
    fileId: string,
    updates: Partial<ConfigFileDefinition>
  ) => {
    updateProfile(profileId, profile => ({
      ...profile,
      files: profile.files.map(file => (file.id === fileId ? { ...file, ...updates } : file)),
    }));
    if (updates.path !== undefined) {
      setSnapshots(current => ({
        ...current,
        [profileId]: (current[profileId] || []).filter(item => item.fileId !== fileId),
      }));
      setEdits(current => {
        const profileEdits = { ...(current[profileId] || {}) };
        delete profileEdits[fileId];
        return { ...current, [profileId]: profileEdits };
      });
    }
  };

  const persistProfile = async (profile: ConfigFileProfile): Promise<ConfigFileProfile> => {
    const saved = await guardProfileResponse(
      window.electronAPI.configFileProfiles.upsert({
        profile,
        expectedRevision: persistedIds.has(profile.id) ? profile.revision : undefined,
      })
    );
    setProfiles(current => current.map(item => (item.id === saved.id ? saved : item)));
    setProfileBaselines(current => ({ ...current, [saved.id]: saved }));
    setPersistedIds(current => new Set(current).add(saved.id));
    setHasUnsavedChanges(false);
    if (!saved.lastApplied) {
      try {
        const values = await guardProfileResponse(
          window.electronAPI.configFileProfiles.resolveValues({
            profile: saved,
          })
        );
        if (values) setSavedResolvedValues(current => ({ ...current, [saved.id]: values }));
      } catch {
        setSavedResolvedValues(current => {
          const next = { ...current };
          delete next[saved.id];
          return next;
        });
      }
    }
    return saved;
  };

  const saveSelected = async () => {
    if (!selectedProfile) return;
    try {
      await persistProfile(selectedProfile);
      toast.success('配置规则已保存');
    } catch (error) {
      toast.error(errorMessage(error, '保存配置规则失败'));
    }
  };

  const generateRouteKey = async (profile: ConfigFileProfile) => {
    try {
      const saved =
        persistedIds.has(profile.id) && !hasUnsavedChanges
          ? profile
          : await persistProfile(profile);
      if (saved.localRouteCredential) {
        setRotateKeyTarget(saved);
        return;
      }
      const updated = await guardProfileResponse(
        window.electronAPI.configFileProfiles.generateRouteKey({
          profileId: saved.id,
          expectedRevision: saved.revision,
        })
      );
      setProfiles(current => current.map(item => (item.id === updated.id ? updated : item)));
      setVisibleRouteKeys(current => ({ ...current, [updated.id]: true }));
      setHasUnsavedChanges(false);
      toast.success('已生成独立 API Key');
    } catch (error) {
      toast.error(errorMessage(error, '生成本地路由 API Key 失败'));
    }
  };

  const confirmRouteKeyRotation = async () => {
    if (!rotateKeyTarget || rotatingRouteKey) return;
    setRotatingRouteKey(true);
    try {
      const rotationPreview = await guardProfileResponse(
        window.electronAPI.configFileProfiles.previewRouteKeyRotation({
          profileId: rotateKeyTarget.id,
          expectedRevision: rotateKeyTarget.revision,
        })
      );
      await guardProfileResponse(
        window.electronAPI.configFileProfiles.commit({
          transactionId: rotationPreview.transactionId,
        })
      );
      const rotatedProfileId = rotateKeyTarget.id;
      setRotateKeyTarget(null);
      setVisibleRouteKeys(current => ({ ...current, [rotatedProfileId]: true }));
      try {
        await reload();
      } catch (refreshError) {
        toast.warning(
          `API Key 已重新生成，但刷新页面状态失败：${errorMessage(refreshError, '请重新打开配置')}`
        );
        return;
      }
      toast.success('API Key 与本地配置已同步更新');
    } catch (error) {
      toast.error(errorMessage(error, '重新生成本地路由 API Key 失败'));
    } finally {
      setRotatingRouteKey(false);
    }
  };

  const saveAndBuildApplyPreview = async () => {
    if (!selectedProfile) return;
    try {
      const saved = await persistProfile(selectedProfile);
      setApplyProfileId(saved.id);
      setPreview(
        await guardProfileResponse(
          window.electronAPI.configFileProfiles.preview({
            profileId: saved.id,
            expectedRevision: saved.revision,
            applyMode,
          })
        )
      );
    } catch (error) {
      toast.error(errorMessage(error, '生成写入预览失败'));
    }
  };

  const buildDshRestorePreview = async () => {
    if (!selectedProfile) return;
    try {
      const result = await guardProfileResponse(
        window.electronAPI.configFileProfiles.preview({
          profileId: selectedProfile.id,
          expectedRevision: selectedProfile.revision,
          restoreDsh: true,
        })
      );
      setApplyProfileId(selectedProfile.id);
      setPreview(result);
    } catch (error) {
      toast.error(errorMessage(error, '生成 DSH 恢复预览失败'));
    }
  };

  const duplicateProfile = (profile: ConfigFileProfile) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const copy: ConfigFileProfile = {
      ...profile,
      id,
      name: `${profile.name} 副本`,
      isExample: false,
      builtin: undefined,
      localRouteCredential: undefined,
      lastApplied: undefined,
      revision: undefined,
      files: profile.files.map(file => ({ ...file, id: `${id}:file:${crypto.randomUUID()}` })),
      sessionRecordConnectors: profile.sessionRecordConnectors.map(connector => ({
        ...connector,
        id: `${id}:session:${crypto.randomUUID()}`,
      })),
      createdAt: now,
      updatedAt: now,
    };
    setProfiles(current => [...current, copy]);
    setSelectedProfileId(id);
    setHasUnsavedChanges(true);
  };

  const deleteProfile = async (profile: ConfigFileProfile) => {
    try {
      if (persistedIds.has(profile.id)) {
        await guardProfileResponse(
          window.electronAPI.configFileProfiles.delete({
            profileId: profile.id,
            expectedRevision: profile.revision,
          })
        );
      }
      setProfiles(current => current.filter(item => item.id !== profile.id));
      setPersistedIds(current => {
        const next = new Set(current);
        next.delete(profile.id);
        return next;
      });
      setProfileBaselines(current => {
        const next = { ...current };
        delete next[profile.id];
        return next;
      });
      setSelectedProfileId(current => (current === profile.id ? null : current));
    } catch (error) {
      toast.error(errorMessage(error, '删除配置失败'));
    }
  };

  const confirmDeleteProfile = async () => {
    if (!deleteProfileTarget) return;
    setDeleteProfileTarget(null);
    await deleteProfile(deleteProfileTarget);
  };

  const confirmDeleteFile = () => {
    if (!deleteFileTarget) return;
    const { profileId, fileId } = deleteFileTarget;
    setDeleteFileTarget(null);
    updateProfile(profileId, profile => ({
      ...profile,
      files: profile.files.filter(file => file.id !== fileId),
    }));
  };

  const readLocalFiles = async (profile: ConfigFileProfile) => {
    try {
      const files = await guardProfileResponse(
        window.electronAPI.configFileProfiles.readFiles(profile.id)
      );
      setSnapshots(current => ({ ...current, [profile.id]: files }));
      setEdits(current => ({
        ...current,
        [profile.id]: Object.fromEntries(files.map(file => [file.fileId, file.content])),
      }));
      toast.success('已重新读取本地文件');
    } catch (error) {
      toast.error(errorMessage(error, '读取本地文件失败'));
    }
  };

  const showBackups = async (profile: ConfigFileProfile, fileId: string) => {
    const file = profile.files.find(item => item.id === fileId);
    if (!file) return;
    try {
      const entries = await guardProfileResponse(
        window.electronAPI.configFileProfiles.listBackups({
          profileId: profile.id,
          fileId,
        })
      );
      setBackupDialog({
        profileId: profile.id,
        fileId,
        path: file.path,
        revision: profile.revision,
        entries,
      });
    } catch (error) {
      toast.error(errorMessage(error, '加载备份列表失败'));
    }
  };

  const previewBackup = async (backup: ConfigFileBackup) => {
    if (!backupDialog || loadingBackup) return;
    setLoadingBackup(true);
    try {
      const transaction = await guardProfileResponse(
        window.electronAPI.configFileProfiles.previewBackupRestore({
          profileId: backupDialog.profileId,
          fileId: backupDialog.fileId,
          expectedRevision: backupDialog.revision,
          backupId: backup.id,
          expectedHash: backup.sha256,
        })
      );
      setApplyProfileId(backupDialog.profileId);
      setPreview(transaction);
      setBackupDialog(null);
    } catch (error) {
      toast.error(errorMessage(error, '生成备份恢复预览失败'));
    } finally {
      setLoadingBackup(false);
    }
  };

  const buildDirectEditPreview = async (profile: ConfigFileProfile) => {
    const profileSnapshots = snapshots[profile.id] || [];
    try {
      const saved = await persistProfile(profile);
      setApplyProfileId(saved.id);
      setPreview(
        await guardProfileResponse(
          window.electronAPI.configFileProfiles.previewDirectEdit({
            profileId: saved.id,
            expectedRevision: saved.revision,
            edits: edits[saved.id] || {},
            snapshots: Object.fromEntries(profileSnapshots.map(item => [item.fileId, item])),
          })
        )
      );
    } catch (error) {
      toast.error(errorMessage(error, '生成本地文件保存预览失败'));
    }
  };

  const commitPreview = async () => {
    if (!preview || !applyProfile) return;
    const operation = preview.operation;
    try {
      await guardProfileResponse(
        window.electronAPI.configFileProfiles.commit({ transactionId: preview.transactionId })
      );
      setPreview(null);
      setApplyProfileId(null);
      try {
        if (operation === 'apply' || operation === 'key-rotation' || operation === 'dsh-rollback') {
          await reload();
        }
        if (isDshConfigProfile(applyProfile)) await dsh.refresh();
        if (operation === 'backup-restore') {
          const restoredFileIds = new Set(preview.files.map(file => file.fileId));
          setSnapshots(current => ({
            ...current,
            [applyProfile.id]: (current[applyProfile.id] || []).filter(
              file => !restoredFileIds.has(file.fileId)
            ),
          }));
          setEdits(current => ({
            ...current,
            [applyProfile.id]: Object.fromEntries(
              Object.entries(current[applyProfile.id] || {}).filter(
                ([fileId]) => !restoredFileIds.has(fileId)
              )
            ),
          }));
        } else if (operation !== 'key-rotation') {
          await readLocalFiles(applyProfile);
        }
      } catch (refreshError) {
        toast.warning(
          `配置已写入本地，但刷新页面状态失败：${errorMessage(refreshError, '请重新读取')}`
        );
        return;
      }
      toast.success(
        operation === 'key-rotation'
          ? 'API Key 与本地配置已同步轮换'
          : operation === 'backup-restore'
            ? '配置文件已从备份恢复'
            : operation === 'direct-edit'
              ? '本地文件已保存'
              : isDshConfigProfile(applyProfile)
                ? operation === 'dsh-rollback'
                  ? '已恢复 DSH 接入前配置，请重启 DeepSeek Harness'
                  : 'DSH 配置已写入，请重启 DeepSeek Harness；旧会话可在高级操作中迁移'
                : '配置已应用到本地'
      );
    } catch (error) {
      toast.error(errorMessage(error, '写入本地配置失败'));
    }
  };

  const restoreBuiltin = async () => {
    if (!restoreProfile) return;
    try {
      const restored = await guardProfileResponse(
        window.electronAPI.configFileProfiles.restoreBuiltin({
          profileId: restoreProfile.id,
          expectedRevision: restoreProfile.revision,
        })
      );
      setProfiles(current =>
        current.map(profile => (profile.id === restored.id ? restored : profile))
      );
      setProfileBaselines(current => ({ ...current, [restored.id]: restored }));
      setSnapshots(current => {
        const next = { ...current };
        delete next[restored.id];
        return next;
      });
      setEdits(current => {
        const next = { ...current };
        delete next[restored.id];
        return next;
      });
      setRestoreProfileId(null);
      toast.success('已恢复为最新内置示例');
    } catch (error) {
      toast.error(errorMessage(error, '恢复内置示例失败'));
    }
  };

  const restoreMissingBuiltins = async () => {
    try {
      await guardProfileResponse(window.electronAPI.configFileProfiles.restoreMissingBuiltins());
      await reload();
      toast.success('内置模板已恢复');
    } catch (error) {
      toast.error(errorMessage(error, '恢复内置模板失败'));
    }
  };

  const switchAuthMode = async () => {
    if (!authModeTarget) return;
    const { profile, authMode } = authModeTarget;
    try {
      const saved = await persistProfile(profile);
      const switched = await guardProfileResponse(
        window.electronAPI.configFileProfiles.switchAuthMode({
          profileId: saved.id,
          authMode,
          expectedRevision: saved.revision,
        })
      );
      setProfiles(current => current.map(item => (item.id === switched.id ? switched : item)));
      setProfileBaselines(current => ({ ...current, [switched.id]: switched }));
      setSnapshots(current => {
        const next = { ...current };
        delete next[switched.id];
        return next;
      });
      setEdits(current => {
        const next = { ...current };
        delete next[switched.id];
        return next;
      });
      setAuthModeTarget(null);
      toast.success('接入方式已切换');
    } catch (error) {
      toast.error(errorMessage(error, '切换接入方式失败'));
    }
  };

  const targetEntryFor = (profile: ConfigFileProfile) =>
    catalog.find(entry => entry.value === encodeTarget(profile.target));

  const modelOptions = (profile: ConfigFileProfile): string[] => {
    if (isDshConfigProfile(profile)) {
      const sources = getDshConfigModelSources(catalog, dsh.status);
      const sourceId =
        profile.dsh?.modelSourceId ||
        dsh.status?.matchedModelSourceId ||
        sources.find(item => item.kind === 'local-route')?.id ||
        sources[0]?.id;
      return sources.find(item => item.id === sourceId)?.models || [];
    }
    const entry = targetEntryFor(profile);
    if (!entry) return [];
    if (profile.target.kind !== 'managed' || showAllModels[profile.id]) return entry.allModels;
    const apiKeyId = profile.target.apiKeyId;
    return entry.apiKeys.find(key => key.id === apiKeyId)?.scopedModels || [];
  };

  const targetOptions = useMemo(() => catalog, [catalog]);

  const selectModelScope = (profile: ConfigFileProfile, showAll: boolean) => {
    const entry = targetEntryFor(profile);
    const nextModels = showAll
      ? entry?.allModels || []
      : entry?.apiKeys.find(
          key =>
            key.id === (profile.target.kind === 'managed' ? profile.target.apiKeyId : undefined)
        )?.scopedModels || [];
    setShowAllModels(current => ({ ...current, [profile.id]: showAll }));
    if (profile.target.model && !nextModels.includes(profile.target.model)) {
      updateProfile(profile.id, item => ({
        ...item,
        target: { ...item.target, model: null },
      }));
    }
  };

  const openEditor = (profileId: string) => {
    setSelectedProfileId(profileId);
    setApplyMode('merge');
    setHasUnsavedChanges(false);
  };

  const handleCloseModal = () => {
    if (hasUnsavedChanges) {
      setShowCloseConfirm(true);
    } else {
      setSelectedProfileId(null);
      setApplyProfileId(null);
      setPreview(null);
      setHasUnsavedChanges(false);
    }
  };

  const confirmClose = () => {
    if (selectedProfileId) {
      const baseline = profileBaselines[selectedProfileId];
      if (baseline) {
        setProfiles(current =>
          current.map(profile => (profile.id === selectedProfileId ? baseline : profile))
        );
        setEdits(current => {
          const next = { ...current };
          delete next[selectedProfileId];
          return next;
        });
      } else if (!persistedIds.has(selectedProfileId)) {
        setProfiles(current => current.filter(profile => profile.id !== selectedProfileId));
        setPersistedIds(current => {
          const next = new Set(current);
          next.delete(selectedProfileId);
          return next;
        });
      }
    }
    setShowCloseConfirm(false);
    setSelectedProfileId(null);
    setApplyProfileId(null);
    setPreview(null);
    setHasUnsavedChanges(false);
  };

  return (
    <AppCard variant="standard" hoverable={false} blur={false} className="flex min-h-0 flex-col">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">配置文件</h2>
          <p className="min-w-0 truncate text-xs text-[var(--text-tertiary)]">
            {profiles.length} 个方案 · {profiles.reduce((sum, item) => sum + item.files.length, 0)}{' '}
            个文件
          </p>
        </div>
        <div className="flex items-center gap-2">
          {missingBuiltinCount > 0 ? (
            <AppButton
              variant="tertiary"
              size="sm"
              title="恢复已删除的内置模板"
              onClick={() => void restoreMissingBuiltins()}
            >
              <RefreshCw className="h-4 w-4" />
              恢复内置模板
            </AppButton>
          ) : null}
          <AppButton
            size="sm"
            onClick={() => {
              const profile = createProfile();
              setProfiles(current => [...current, profile]);
              setSelectedProfileId(profile.id);
              setHasUnsavedChanges(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新增配置
          </AppButton>
        </div>
      </div>

      <div className="overflow-x-auto p-2">
        <div className="grid min-w-[56rem] grid-cols-4 gap-3">
          {profiles.map(profile => {
            const entry = targetEntryFor(profile);
            const isOfficial = profile.authMode === 'official';
            const cardValues = profile.lastApplied || savedResolvedValues[profile.id];
            return (
              <AppCard
                key={profile.id}
                hoverable
                focusable
                aria-label={`${profile.name} 配置卡片`}
                className="flex min-w-0 cursor-pointer flex-col bg-[var(--surface-2)]"
                onClick={() => openEditor(profile.id)}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openEditor(profile.id);
                  }
                }}
              >
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-muted)] bg-[var(--surface-2)]">
                    <AgentLogo
                      logoId={profile.agentLogoId}
                      agentId={profile.builtin?.clientType}
                      agentName={profile.name}
                      className="h-5 w-5"
                    />
                  </div>
                  {/* 标题区不再渲染副标题：入口标签与下方「配置目标」字段重复，
                      「官方登录」/「需修复」徽标已覆盖状态语义。
                      这样所有卡片头部等高，四列栅格里字段区天然对齐，也不会留下空位。 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
                      {profile.isExample ? (
                        <span className="shrink-0 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--success)]">
                          内置
                        </span>
                      ) : null}
                      {isOfficial ? (
                        <span className="shrink-0 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                          官方登录
                        </span>
                      ) : null}
                      {!isOfficial && (!entry || !entry.available) ? (
                        <span className="shrink-0 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs font-medium text-[var(--danger)]">
                          需修复
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* 28×28 紧凑图标按钮：比 sm 按钮（34px 宽）窄，把横向空间让给客户端名称 */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <AppButton
                      variant="tertiary"
                      size="sm"
                      className="!h-7 !min-h-7 !w-7 !px-0"
                      title="复制配置"
                      aria-label={`${profile.name} 复制配置`}
                      onClick={event => {
                        event.stopPropagation();
                        duplicateProfile(profile);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </AppButton>
                    <AppButton
                      variant="tertiary"
                      size="sm"
                      className="!h-7 !min-h-7 !w-7 !px-0"
                      title="删除配置"
                      aria-label={`${profile.name} 删除配置`}
                      onClick={event => {
                        event.stopPropagation();
                        setDeleteProfileTarget(profile);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </AppButton>
                  </div>
                </div>
                {/* 操作按钮已上移到卡片顶部，字段区是最后一个区块，只保留上边框 */}
                <div className="space-y-1.5 border-t border-[var(--line-muted)] bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] px-3 py-2 text-xs">
                  {[
                    [
                      '配置目标',
                      isOfficial
                        ? '官方账号登录'
                        : cardValues?.targetLabel || entry?.label || '未设置',
                    ],
                    [
                      'BaseURL',
                      isOfficial
                        ? '—'
                        : cardValues?.baseUrl ||
                          (isDshConfigProfile(profile) ? dsh.status?.expectedBaseUrl : '') ||
                          '未设置',
                    ],
                    ['APIKey 名称', isOfficial ? '—' : cardValues?.apiKeyName || '未设置'],
                    [
                      '模型',
                      isOfficial
                        ? '模板内置'
                        : cardValues?.model ||
                          profile.target.model ||
                          (isDshConfigProfile(profile)
                            ? `${dsh.status?.configuredModelCount ?? 0} 个模型`
                            : '未设置'),
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2"
                    >
                      <span className="text-[var(--text-tertiary)]">{label}</span>
                      <span className="min-w-0 truncate" title={value}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </AppCard>
            );
          })}
        </div>
      </div>

      <AppModal
        isOpen={selectedProfile !== null}
        onClose={handleCloseModal}
        title={selectedProfile?.name ? `编辑配置: ${selectedProfile.name}` : '编辑配置'}
        titleIcon={<FileCog className="h-5 w-5" />}
        size="xl"
        className="!h-[calc(100vh-4rem)] !max-w-6xl"
        contentClassName="!max-h-none min-h-0 flex-1 overflow-y-auto !p-0"
        footer={
          preview && applyProfileId === selectedProfile?.id ? (
            <>
              <AppButton
                variant="tertiary"
                onClick={() => {
                  setPreview(null);
                  setApplyProfileId(null);
                }}
              >
                返回编辑
              </AppButton>
              <AppButton onClick={() => void commitPreview()}>
                <Check className="h-4 w-4" />
                确认写入
              </AppButton>
            </>
          ) : (
            <>
              {!selectedProfile || !isDshConfigProfile(selectedProfile) ? (
                <div
                  role="group"
                  aria-label="预览写入模式"
                  className="mr-auto flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] p-0.5"
                >
                  {(['merge', 'overwrite'] as const).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={applyMode === mode}
                      onClick={() => setApplyMode(mode)}
                      className={`rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs transition-colors ${
                        applyMode === mode
                          ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                      }`}
                    >
                      {mode === 'merge' ? '合并' : '覆盖'}
                    </button>
                  ))}
                </div>
              ) : null}
              {selectedProfile?.isExample ? (
                <AppButton
                  variant="secondary"
                  onClick={() => setRestoreProfileId(selectedProfile.id)}
                >
                  <RefreshCw className="h-4 w-4" />
                  恢复最新示例
                </AppButton>
              ) : null}
              <AppButton variant="tertiary" onClick={handleCloseModal}>
                取消
              </AppButton>
              <AppButton variant="secondary" onClick={() => void saveSelected()}>
                <Save className="h-4 w-4" />
                保存配置
              </AppButton>
              <AppButton
                disabled={
                  !selectedProfile ||
                  (selectedProfile.authMode !== 'official' && !targetEntryFor(selectedProfile))
                }
                onClick={() => void saveAndBuildApplyPreview()}
              >
                <Eye className="h-4 w-4" />
                预览写入
              </AppButton>
            </>
          )
        }
      >
        {selectedProfile && preview && applyProfileId === selectedProfile.id ? (
          <ApplyPreviewPanel
            preview={preview}
            onBack={() => {
              setPreview(null);
              setApplyProfileId(null);
            }}
          />
        ) : selectedProfile ? (
          <RuleEditor
            profile={selectedProfile}
            advancedActions={
              isDshConfigProfile(selectedProfile) ? (
                <DshConfigControls
                  status={dsh.status}
                  error={dsh.error}
                  hasUnsavedChanges={hasUnsavedChanges}
                  onRefresh={dsh.refresh}
                  onRestore={() => void buildDshRestorePreview()}
                />
              ) : null
            }
            catalog={targetOptions}
            currentEntry={targetEntryFor(selectedProfile)}
            showAll={showAllModels[selectedProfile.id] === true}
            models={modelOptions(selectedProfile)}
            snapshots={snapshots[selectedProfile.id] || []}
            edits={edits[selectedProfile.id] || {}}
            onSelectScope={showAll => selectModelScope(selectedProfile, showAll)}
            onUpdate={update => updateProfile(selectedProfile.id, update)}
            routeKeyVisible={visibleRouteKeys[selectedProfile.id] === true}
            onToggleRouteKey={() =>
              setVisibleRouteKeys(current => ({
                ...current,
                [selectedProfile.id]: !current[selectedProfile.id],
              }))
            }
            onGenerateRouteKey={() => void generateRouteKey(selectedProfile)}
            onCopyRouteKey={() => {
              const apiKey = selectedProfile.localRouteCredential?.apiKey;
              if (!apiKey) return;
              void navigator.clipboard
                .writeText(apiKey)
                .then(() => toast.success('API Key 已复制'));
            }}
            onUpdateFile={(fileId, updates) => updateFile(selectedProfile.id, fileId, updates)}
            onRequestAuthMode={authMode =>
              setAuthModeTarget({ profile: selectedProfile, authMode })
            }
            onReadLocal={() => void readLocalFiles(selectedProfile)}
            onEditLocal={(fileId, content) => {
              setHasUnsavedChanges(true);
              setEdits(current => ({
                ...current,
                [selectedProfile.id]: { ...current[selectedProfile.id], [fileId]: content },
              }));
            }}
            onSaveLocal={() => void buildDirectEditPreview(selectedProfile)}
            canBrowseBackups={persistedIds.has(selectedProfile.id) && !hasUnsavedChanges}
            onShowBackups={fileId => void showBackups(selectedProfile, fileId)}
            onRequestDeleteFile={fileId =>
              setDeleteFileTarget({ profileId: selectedProfile.id, fileId })
            }
          />
        ) : null}
      </AppModal>

      <AppModal
        isOpen={restoreProfile !== null}
        onClose={() => setRestoreProfileId(null)}
        title="恢复最新示例"
        titleIcon={<RefreshCw className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setRestoreProfileId(null)}>
              取消
            </AppButton>
            <AppButton variant="danger" onClick={() => void restoreBuiltin()}>
              确认恢复
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          将用最新的完整内置模板替换“{restoreProfile?.name}
          ”当前的模板和说明。配置目标与对话记录路径会保留,本地文件不会立即写入。
        </p>
      </AppModal>

      <AppModal
        isOpen={authModeTarget !== null}
        onClose={() => setAuthModeTarget(null)}
        title="切换接入方式"
        titleIcon={<RefreshCw className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setAuthModeTarget(null)}>
              取消
            </AppButton>
            <AppButton variant="danger" onClick={() => void switchAuthMode()}>
              确认切换
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          将把“{authModeTarget?.profile.name}”的模板替换为“
          {authModeTarget?.authMode === 'official' ? '官方账号登录' : '第三方 API'}
          ”内置模板，未保存的模板修改会丢失。本地文件不会立即写入。
        </p>
      </AppModal>

      <AppModal
        isOpen={backupDialog !== null}
        onClose={() => {
          if (!loadingBackup) setBackupDialog(null);
        }}
        title="配置文件备份"
        size="md"
      >
        <p className="mb-3 break-all text-xs text-[var(--text-secondary)]">{backupDialog?.path}</p>
        <div className="max-h-80 space-y-2 overflow-auto">
          {backupDialog?.entries.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">暂无备份</p>
          ) : (
            backupDialog?.entries.map(backup => (
              <div key={backup.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {backup.kind === 'original'
                    ? '首次原始备份'
                    : backup.kind === 'legacy'
                      ? '迁移备份'
                      : '自动备份'}
                  {' · '}
                  {new Date(backup.createdAt).toLocaleString()}
                  {' · '}
                  {backup.size} B
                </span>
                <AppButton
                  size="sm"
                  disabled={loadingBackup}
                  onClick={() => void previewBackup(backup)}
                >
                  预览恢复
                </AppButton>
              </div>
            ))
          )}
        </div>
      </AppModal>

      <AppModal
        isOpen={showCloseConfirm}
        onClose={() => setShowCloseConfirm(false)}
        title="未保存的更改"
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setShowCloseConfirm(false)}>
              取消
            </AppButton>
            <AppButton variant="danger" onClick={confirmClose}>
              放弃更改
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">有未保存的更改,确定要关闭吗?</p>
      </AppModal>

      <AppModal
        isOpen={rotateKeyTarget !== null}
        onClose={() => {
          if (!rotatingRouteKey) setRotateKeyTarget(null);
        }}
        title="重新生成 API Key"
        titleIcon={<RefreshCw className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton
              variant="tertiary"
              disabled={rotatingRouteKey}
              onClick={() => setRotateKeyTarget(null)}
            >
              取消
            </AppButton>
            <AppButton loading={rotatingRouteKey} onClick={() => void confirmRouteKeyRotation()}>
              确认重新生成
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          重新生成后，包含当前 Key 的本地配置会同步更新。未找到当前 Key 时不会执行轮换。
        </p>
      </AppModal>

      <AppModal
        isOpen={deleteProfileTarget !== null}
        onClose={() => setDeleteProfileTarget(null)}
        title="删除配置"
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setDeleteProfileTarget(null)}>
              取消
            </AppButton>
            <AppButton variant="danger" onClick={() => void confirmDeleteProfile()}>
              确认删除
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          确定要删除配置“{deleteProfileTarget?.name}”吗？已写入本地文件的内容不会被删除。
        </p>
      </AppModal>

      <AppModal
        isOpen={deleteFileTarget !== null}
        onClose={() => setDeleteFileTarget(null)}
        title="删除文件"
        size="sm"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setDeleteFileTarget(null)}>
              取消
            </AppButton>
            <AppButton variant="danger" onClick={confirmDeleteFile}>
              确认删除
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          确定要从此配置规则中删除该文件吗？磁盘上的本地文件不会受影响。
        </p>
      </AppModal>
    </AppCard>
  );
}
