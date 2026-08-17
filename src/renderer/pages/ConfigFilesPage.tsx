/**
 * 配置文件页
 * 输入: window.electronAPI.configFileProfiles (load/upsert/delete/preview/previewDirectEdit/commit/readFiles/...)
 * 输出: 配置方案摘要卡片、编辑弹窗、模板应用/本地文件保存预览
 * 定位: 展示层 - 配置文件页入口
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  FileCog,
  FilePlus2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  ConfigFileApplyMode,
  ConfigFileDefinition,
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  ConfigFileResolvedTargetValues,
  ConfigFileSnapshot,
  ConfigFileTarget,
  ConfigFileTargetCatalogEntry,
  SessionRecordConnector,
} from '../../shared/types/config-file-profile';
import { DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS } from '../../shared/types/config-file-profile';
import { AppButton } from '../components/AppButton/AppButton';
import { AppCard } from '../components/AppCard';
import { AppModal } from '../components/AppModal/AppModal';
import { AppInput } from '../components/AppInput/AppInput';
import { AppSelect } from '../components/AppSelect';
import { AgentLogo, AgentLogoSelect } from '../components/AgentLogo';
import { toast } from '../store/toastStore';

function createFile(profileId: string): ConfigFileDefinition {
  return {
    id: `${profileId}:file:${crypto.randomUUID()}`,
    path: '',
    template: '',
    format: 'auto',
  };
}

function createProfile(): ConfigFileProfile {
  const now = Date.now();
  const id = crypto.randomUUID();
  return {
    id,
    name: '新建配置',
    files: [createFile(id)],
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    target: { kind: 'local-route', model: null },
    createdAt: now,
    updatedAt: now,
  };
}

function createSessionConnector(profileId: string): SessionRecordConnector {
  return {
    id: `${profileId}:session:${crypto.randomUUID()}`,
    path: '',
    format: 'jsonl',
    namespace: 'custom',
    sessionIdPath: 'session_id',
    recursive: false,
  };
}

function encodeTarget(target: ConfigFileTarget): string {
  if (target.kind === 'local-route') return 'local-route';
  if (target.kind === 'direct') return `direct:${target.configId}`;
  return `managed:${target.siteId}:${target.accountId}`;
}

function decodeTarget(value: string): ConfigFileTarget {
  const [kind, first, second] = value.split(':');
  if (kind === 'direct') return { kind: 'direct', configId: first, model: null };
  if (kind === 'managed') {
    return { kind: 'managed', siteId: first, accountId: second, model: null };
  }
  return { kind: 'local-route', model: null };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const CREDENTIAL_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

function renderTemplatePreview(
  template: string,
  values: { baseUrl: string; apiKey: string; model: string }
): string {
  return template
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.baseUrl)
    .join(values.baseUrl)
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.apiKey)
    .join(values.apiKey)
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.model)
    .join(values.model);
}

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** 轻量行级 diff（LCS），不引入第三方库。 */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: 'same', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'del', text: oldLines[i] });
      i += 1;
    } else {
      result.push({ kind: 'add', text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    result.push({ kind: 'del', text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    result.push({ kind: 'add', text: newLines[j] });
    j += 1;
  }
  return result;
}

function diffSummary(lines: DiffLine[]): { added: number; removed: number } {
  return lines.reduce(
    (acc, line) => {
      if (line.kind === 'add') acc.added += 1;
      if (line.kind === 'del') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 }
  );
}

export function ConfigFilesPage() {
  const [profiles, setProfiles] = useState<ConfigFileProfile[]>([]);
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [visibleRouteKeys, setVisibleRouteKeys] = useState<Record<string, boolean>>({});
  const [deleteProfileTarget, setDeleteProfileTarget] = useState<ConfigFileProfile | null>(null);
  const [rotateKeyTarget, setRotateKeyTarget] = useState<ConfigFileProfile | null>(null);
  const [rotatingRouteKey, setRotatingRouteKey] = useState(false);
  const pendingProfileRefreshRef = useRef(false);
  const [deleteFileTarget, setDeleteFileTarget] = useState<{
    profileId: string;
    fileId: string;
  } | null>(null);

  const reload = useCallback(async () => {
    const [loadedProfiles, targetCatalog] = await Promise.all([
      window.electronAPI.configFileProfiles.load(),
      window.electronAPI.configFileProfiles.getTargetCatalog?.() ?? Promise.resolve([]),
    ]);
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
            const values = await window.electronAPI.configFileProfiles.resolveValues({ profile });
            return values ? ([profile.id, values] as const) : null;
          } catch {
            return null;
          }
        })
    );
    setSavedResolvedValues(
      Object.fromEntries(
        resolvedEntries.filter((entry): entry is NonNullable<typeof entry> => !!entry)
      )
    );
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalog(await window.electronAPI.configFileProfiles.getTargetCatalog());
  }, []);

  useEffect(() => {
    void reload().catch(error => toast.error(errorMessage(error, '加载配置文件失败')));
  }, [reload]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!domains.includes('config-file-profiles')) return;
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
    const saved = await window.electronAPI.configFileProfiles.upsert({
      profile,
      expectedRevision: persistedIds.has(profile.id) ? profile.revision : undefined,
    });
    setProfiles(current => current.map(item => (item.id === saved.id ? saved : item)));
    setProfileBaselines(current => ({ ...current, [saved.id]: saved }));
    setPersistedIds(current => new Set(current).add(saved.id));
    setHasUnsavedChanges(false);
    if (!saved.lastApplied) {
      try {
        const values = await window.electronAPI.configFileProfiles.resolveValues({
          profile: saved,
        });
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
      const updated = await window.electronAPI.configFileProfiles.generateRouteKey({
        profileId: saved.id,
        expectedRevision: saved.revision,
      });
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
      const rotationPreview = await window.electronAPI.configFileProfiles.previewRouteKeyRotation({
        profileId: rotateKeyTarget.id,
        expectedRevision: rotateKeyTarget.revision,
      });
      await window.electronAPI.configFileProfiles.commit({
        transactionId: rotationPreview.transactionId,
      });
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
        await window.electronAPI.configFileProfiles.preview({
          profileId: saved.id,
          expectedRevision: saved.revision,
          applyMode,
        })
      );
    } catch (error) {
      toast.error(errorMessage(error, '生成写入预览失败'));
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
        await window.electronAPI.configFileProfiles.delete({
          profileId: profile.id,
          expectedRevision: profile.revision,
        });
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
      const files = await window.electronAPI.configFileProfiles.readFiles(profile.id);
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

  const buildDirectEditPreview = async (profile: ConfigFileProfile) => {
    const profileSnapshots = snapshots[profile.id] || [];
    try {
      const saved = await persistProfile(profile);
      setApplyProfileId(saved.id);
      setPreview(
        await window.electronAPI.configFileProfiles.previewDirectEdit({
          profileId: saved.id,
          expectedRevision: saved.revision,
          edits: edits[saved.id] || {},
          snapshots: Object.fromEntries(profileSnapshots.map(item => [item.fileId, item])),
        })
      );
    } catch (error) {
      toast.error(errorMessage(error, '生成本地文件保存预览失败'));
    }
  };

  const commitPreview = async () => {
    if (!preview || !applyProfile) return;
    const operation = preview.operation;
    try {
      await window.electronAPI.configFileProfiles.commit({ transactionId: preview.transactionId });
      setPreview(null);
      setApplyProfileId(null);
      try {
        if (operation === 'apply' || operation === 'key-rotation') {
          await reload();
        }
        if (operation !== 'key-rotation') {
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
          : operation === 'direct-edit'
            ? '本地文件已保存'
            : '配置已应用到本地'
      );
    } catch (error) {
      toast.error(errorMessage(error, '写入本地配置失败'));
    }
  };

  const restoreBuiltin = async () => {
    if (!restoreProfile) return;
    try {
      const restored = await window.electronAPI.configFileProfiles.restoreBuiltin({
        profileId: restoreProfile.id,
        expectedRevision: restoreProfile.revision,
      });
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

  const targetEntryFor = (profile: ConfigFileProfile) =>
    catalog.find(entry => entry.value === encodeTarget(profile.target));

  const modelOptions = (profile: ConfigFileProfile): string[] => {
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
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line-muted)] pb-3">
          <p className="text-xs text-[var(--text-tertiary)]">
            {profiles.length} 个方案 · {profiles.reduce((sum, item) => sum + item.files.length, 0)}{' '}
            个文件
          </p>
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

        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[56rem] grid-cols-4 gap-3">
            {profiles.map(profile => {
              const entry = targetEntryFor(profile);
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
                  <div className="flex items-start gap-2.5 px-3 pb-2.5 pt-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line-muted)] bg-[var(--surface-2)]">
                      <AgentLogo
                        logoId={profile.agentLogoId}
                        agentId={profile.builtin?.clientType}
                        agentName={profile.name}
                        className="h-5 w-5"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{profile.name}</h3>
                        {profile.isExample ? (
                          <span className="shrink-0 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--success)]">
                            内置
                          </span>
                        ) : null}
                        {!entry || !entry.available ? (
                          <span className="shrink-0 rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs font-medium text-[var(--danger)]">
                            需修复
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                        {entry?.label || '目标已不存在'}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 border-y border-[var(--line-muted)] bg-[var(--surface-2)]/40 px-3 py-2 text-xs">
                    {[
                      ['配置目标', cardValues?.targetLabel || entry?.label || '未设置'],
                      ['BaseURL', cardValues?.baseUrl || '未设置'],
                      ['APIKey 名称', cardValues?.apiKeyName || '未设置'],
                      ['模型', cardValues?.model || profile.target.model || '未设置'],
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
                  <div className="flex items-center justify-end gap-1 px-3 py-2">
                    <AppButton
                      variant="tertiary"
                      size="sm"
                      title="复制配置"
                      aria-label={`${profile.name} 复制配置`}
                      onClick={event => {
                        event.stopPropagation();
                        duplicateProfile(profile);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </AppButton>
                    <AppButton
                      variant="tertiary"
                      size="sm"
                      title="删除配置"
                      aria-label={`${profile.name} 删除配置`}
                      onClick={event => {
                        event.stopPropagation();
                        setDeleteProfileTarget(profile);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </AppButton>
                  </div>
                </AppCard>
              );
            })}
          </div>
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
              <AppButton variant="tertiary" onClick={handleCloseModal}>
                取消
              </AppButton>
              <AppButton variant="secondary" onClick={() => void saveSelected()}>
                <Save className="h-4 w-4" />
                保存配置
              </AppButton>
              <AppButton
                disabled={!selectedProfile || !targetEntryFor(selectedProfile)}
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
            onRestore={() => setRestoreProfileId(selectedProfile.id)}
            onReadLocal={() => void readLocalFiles(selectedProfile)}
            onEditLocal={(fileId, content) => {
              setHasUnsavedChanges(true);
              setEdits(current => ({
                ...current,
                [selectedProfile.id]: { ...current[selectedProfile.id], [fileId]: content },
              }));
            }}
            onSaveLocal={() => void buildDirectEditPreview(selectedProfile)}
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
    </div>
  );
}

function ApplyPreviewPanel(props: { preview: ConfigFilePreviewTransaction; onBack: () => void }) {
  const totalAdded = props.preview.files.reduce(
    (sum, file) => sum + diffSummary(computeLineDiff(file.content, file.nextContent)).added,
    0
  );
  const totalRemoved = props.preview.files.reduce(
    (sum, file) => sum + diffSummary(computeLineDiff(file.content, file.nextContent)).removed,
    0
  );
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line-muted)] pb-3">
        <div>
          <h3 className="text-sm font-semibold">确认写入内容</h3>
          <p className="mt-1 text-xs font-medium text-[var(--accent-strong)]">
            写入模式：{props.preview.applyMode === 'overwrite' ? '覆盖' : '合并'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            共 {props.preview.files.length} 个文件
            {totalAdded + totalRemoved > 0
              ? ` · 新增 ${totalAdded} 行 · 删除 ${totalRemoved} 行`
              : '，内容无变化'}
            ，确认后将写入本地配置。
          </p>
        </div>
        <AppButton variant="tertiary" size="sm" onClick={props.onBack}>
          返回编辑
        </AppButton>
      </div>
      {props.preview.files.map(file => (
        <section
          key={file.fileId}
          className="space-y-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] p-4"
        >
          <div className="truncate font-mono text-xs" title={file.path}>
            {file.path}
          </div>
          <DiffView oldText={file.content} newText={file.nextContent} />
        </section>
      ))}
    </div>
  );
}

function DiffView(props: { oldText: string; newText: string }) {
  const lines = useMemo(
    () => computeLineDiff(props.oldText, props.newText),
    [props.oldText, props.newText]
  );
  const summary = useMemo(() => diffSummary(lines), [lines]);
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
      <div className="flex items-center gap-3 border-b border-[var(--line-muted)] px-3 py-1.5 text-xs">
        <span className="font-medium text-[var(--success)]">+{summary.added}</span>
        <span className="font-medium text-[var(--danger)]">-{summary.removed}</span>
        <span className="ml-auto text-[var(--text-tertiary)]">{lines.length} 行</span>
      </div>
      <div className="max-h-72 overflow-auto p-2 font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div
            key={index}
            data-diff-kind={line.kind}
            className={
              line.kind === 'add'
                ? 'rounded-[var(--radius-sm)] bg-[var(--success-soft)] text-[var(--success)]'
                : line.kind === 'del'
                  ? 'rounded-[var(--radius-sm)] bg-[var(--danger-soft)] text-[var(--danger)]'
                  : 'text-[var(--text-secondary)]'
            }
          >
            {line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}
            {line.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleEditor(props: {
  profile: ConfigFileProfile;
  catalog: ConfigFileTargetCatalogEntry[];
  currentEntry?: ConfigFileTargetCatalogEntry;
  showAll: boolean;
  models: string[];
  snapshots: ConfigFileSnapshot[];
  edits: Record<string, string>;
  onSelectScope: (showAll: boolean) => void;
  onUpdate: (update: (profile: ConfigFileProfile) => ConfigFileProfile) => void;
  routeKeyVisible: boolean;
  onToggleRouteKey: () => void;
  onGenerateRouteKey: () => void;
  onCopyRouteKey: () => void;
  onUpdateFile: (fileId: string, updates: Partial<ConfigFileDefinition>) => void;
  onRestore: () => void;
  onReadLocal: () => void;
  onEditLocal: (fileId: string, content: string) => void;
  onSaveLocal: () => void;
  onRequestDeleteFile: (fileId: string) => void;
}) {
  const { profile } = props;
  const [resolvedValues, setResolvedValues] = useState<ConfigFileResolvedTargetValues | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const unavailableTarget = !props.currentEntry || !props.currentEntry.available;
  const selectedKey = profile.target.kind === 'managed' ? profile.target.apiKeyId : undefined;

  // 解析结果只依赖 target 与本地路由凭证；按稳定 key 触发，避免名称/模板/路径每次编辑都重置并重发 IPC
  const resolveKey = useMemo(() => {
    const target = profile.target;
    const scope =
      target.kind === 'managed'
        ? `managed:${target.siteId}:${target.accountId}:${target.apiKeyId ?? ''}`
        : target.kind === 'direct'
          ? `direct:${target.configId}`
          : `local-route:${profile.localRouteCredential?.apiKey ?? ''}`;
    return `${scope}:${target.model ?? ''}`;
  }, [profile.target, profile.localRouteCredential?.apiKey]);

  useEffect(() => {
    let active = true;
    setResolvedValues(null);
    setApiKeyVisible(false);
    if (!props.currentEntry?.available) return () => undefined;
    void window.electronAPI.configFileProfiles
      .resolveValues({ profile })
      .then(values => {
        if (active) setResolvedValues(values);
      })
      .catch(() => {
        if (active) setResolvedValues(null);
      });
    return () => {
      active = false;
    };
    // resolveKey 已覆盖全部影响解析结果的输入；profile 仅用于透传给 IPC
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveKey, props.currentEntry]);

  const targetValues = resolvedValues || { baseUrl: '', apiKey: '', model: '' };

  return (
    <div className="space-y-3 p-3">
      <section className="space-y-2">
        <div className="flex items-center justify-between border-b border-[var(--line-muted)] pb-1.5">
          <div>
            <h3 className="text-sm font-semibold">基本信息</h3>
          </div>
          {unavailableTarget ? (
            <span className="text-xs text-[var(--danger)]">
              {props.currentEntry?.unavailableReason || '目标需要重新选择'}
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 items-end gap-2 md:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1.8fr_1fr]">
          <div className="grid min-w-0 grid-cols-2 items-end gap-2">
            <div className="min-w-0">
              <AppInput
                size="sm"
                label="名称"
                aria-label="配置名称"
                value={profile.name}
                onChange={event => props.onUpdate(item => ({ ...item, name: event.target.value }))}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <span className="block text-sm font-medium text-[var(--text-primary)]">Logo</span>
              <AgentLogoSelect
                value={profile.agentLogoId}
                agentId={profile.builtin?.clientType}
                agentName={profile.name}
                ariaLabel={`${profile.name} Logo`}
                onChange={agentLogoId => props.onUpdate(item => ({ ...item, agentLogoId }))}
              />
            </div>
          </div>
          <AppSelect
            size="sm"
            label="配置目标"
            aria-label={`${profile.name} 目标`}
            containerClassName="min-w-0"
            value={encodeTarget(profile.target)}
            onChange={event =>
              props.onUpdate(item => ({ ...item, target: decodeTarget(event.target.value) }))
            }
          >
            {unavailableTarget ? (
              <option value={encodeTarget(profile.target)} disabled>
                当前目标已不可用
              </option>
            ) : null}
            {props.catalog
              .filter(entry => entry.available)
              .map(entry => (
                <option key={entry.value} value={entry.value} disabled={!entry.available}>
                  {entry.label}
                  {!entry.available && entry.unavailableReason
                    ? `（${entry.unavailableReason}）`
                    : ''}
                </option>
              ))}
          </AppSelect>
          <div className="min-w-0 xl:min-w-0">
            {profile.target.kind === 'managed' ? (
              <div className="flex min-w-0 items-end gap-0.5">
                <AppSelect
                  size="sm"
                  label="API Key"
                  aria-label={`${profile.name} API Key`}
                  value={selectedKey || ''}
                  containerClassName="min-w-0 flex-1"
                  onChange={event =>
                    props.onUpdate(item => ({
                      ...item,
                      target:
                        item.target.kind === 'managed'
                          ? {
                              ...item.target,
                              apiKeyId: event.target.value || undefined,
                              model: null,
                            }
                          : item.target,
                    }))
                  }
                >
                  <option value="">选择 API Key</option>
                  {selectedKey &&
                  !props.currentEntry?.apiKeys.some(key => key.id === selectedKey) ? (
                    <option value={selectedKey} disabled>
                      当前 API Key 已不可用
                    </option>
                  ) : null}
                  {props.currentEntry?.apiKeys.map(key => (
                    <option key={key.id} value={key.id}>
                      {key.label}
                    </option>
                  ))}
                </AppSelect>
                <button
                  type="button"
                  className={`${CREDENTIAL_ICON_BUTTON_CLASS} mb-0.5`}
                  title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                  aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                  onClick={() => setApiKeyVisible(current => !current)}
                >
                  {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            ) : profile.target.kind === 'local-route' ? (
              <div className="space-y-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">
                  API Key
                </span>
                <div className="flex min-w-0 gap-0.5">
                  <AppInput
                    size="sm"
                    readOnly
                    className="min-w-0 flex-1 font-mono"
                    containerClassName="min-w-0 flex-1"
                    aria-label={`${profile.name} API Key`}
                    type={props.routeKeyVisible ? 'text' : 'password'}
                    value={profile.localRouteCredential?.apiKey || ''}
                    placeholder="尚未生成独立 API Key"
                  />
                  {profile.localRouteCredential ? (
                    <>
                      <button
                        type="button"
                        className={CREDENTIAL_ICON_BUTTON_CLASS}
                        title={props.routeKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        aria-label={props.routeKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        onClick={props.onToggleRouteKey}
                      >
                        {props.routeKeyVisible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={CREDENTIAL_ICON_BUTTON_CLASS}
                        title="复制 API Key"
                        aria-label="复制 API Key"
                        onClick={props.onCopyRouteKey}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className={CREDENTIAL_ICON_BUTTON_CLASS}
                    title={profile.localRouteCredential ? '重新生成 API Key' : '生成 API Key'}
                    aria-label={profile.localRouteCredential ? '重新生成 API Key' : '生成 API Key'}
                    onClick={props.onGenerateRouteKey}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <span className="block text-sm font-medium text-[var(--text-primary)]">
                  API Key
                </span>
                <div className="flex items-center gap-0.5">
                  <div className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2.5 font-mono text-xs text-[var(--text-secondary)]">
                    {resolvedValues?.apiKeyName ||
                      (profile.target.kind === 'direct' ? '直连 API Key' : '未选择 API Key')}
                  </div>
                  <button
                    type="button"
                    className={`${CREDENTIAL_ICON_BUTTON_CLASS} mb-0.5`}
                    title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    onClick={() => setApiKeyVisible(current => !current)}
                  >
                    {apiKeyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-end gap-2">
            <AppSelect
              size="sm"
              label="模型"
              aria-label={`${profile.name} 模型`}
              value={profile.target.model || ''}
              onChange={event =>
                props.onUpdate(item => ({
                  ...item,
                  target: { ...item.target, model: event.target.value || null },
                }))
              }
              containerClassName="min-w-0 flex-1"
            >
              <option value="">选择模型</option>
              {props.models.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </AppSelect>
            {profile.target.kind === 'managed' ? (
              <div
                role="group"
                aria-label="模型显示范围"
                className="flex shrink-0 items-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--line-soft)] text-xs"
              >
                <button
                  type="button"
                  aria-pressed={!props.showAll}
                  onClick={() => props.onSelectScope(false)}
                  className={`flex h-9 items-center px-3 transition-colors ${
                    !props.showAll
                      ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  按分组
                </button>
                <button
                  type="button"
                  aria-pressed={props.showAll}
                  onClick={() => props.onSelectScope(true)}
                  className={`flex h-9 items-center border-l border-[var(--line-soft)] px-3 transition-colors ${
                    props.showAll
                      ? 'bg-[var(--surface-3)] font-medium text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  显示全部
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {props.currentEntry && (
        <section className="flex flex-wrap gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{BASE_URL}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.baseUrl || '未设置'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{API_KEY}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.apiKey
                ? profile.target.kind === 'local-route'
                  ? !props.routeKeyVisible
                    ? `${targetValues.apiKey.slice(0, 4)}••••${targetValues.apiKey.slice(-4)}`
                    : targetValues.apiKey
                  : !apiKeyVisible
                    ? `${targetValues.apiKey.slice(0, 4)}••••${targetValues.apiKey.slice(-4)}`
                    : targetValues.apiKey
                : '未设置'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[var(--text-tertiary)]">{'{{MODEL}}'}</span>
            <span className="font-medium text-[var(--text-primary)]">
              {targetValues.model || '未设置'}
            </span>
          </div>
        </section>
      )}

      <div className="flex items-end justify-between border-b border-[var(--line-muted)] pb-2">
        <div>
          <h3 className="text-sm font-semibold">文件规则</h3>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            维护模板并对照生成结果与本地内容
          </p>
        </div>
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() =>
            props.onUpdate(item => ({ ...item, files: [...item.files, createFile(item.id)] }))
          }
        >
          <FilePlus2 className="h-4 w-4" />
          添加文件
        </AppButton>
      </div>

      <div className="space-y-3">
        {profile.files.map((file, fileIndex) => {
          const snapshot = props.snapshots.find(item => item.fileId === file.id);
          return (
            <section
              key={file.id}
              className="rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-3"
            >
              <div className="flex items-center gap-2">
                <h4 className="shrink-0 text-sm font-semibold">文件 {fileIndex + 1}</h4>
                <AppInput
                  size="sm"
                  className="min-w-0 flex-1 font-mono"
                  containerClassName="min-w-0 flex-1"
                  aria-label={`${profile.name} 文件路径`}
                  value={file.path}
                  placeholder="配置文件路径"
                  onChange={event => props.onUpdateFile(file.id, { path: event.target.value })}
                />
                <AppButton
                  variant="tertiary"
                  size="sm"
                  title="删除文件"
                  aria-label={`${profile.name} 删除文件 ${fileIndex + 1}`}
                  onClick={() => props.onRequestDeleteFile(file.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </AppButton>
              </div>
              <div className="mt-3 overflow-x-auto">
                <div className="grid min-w-[56rem] grid-cols-3 gap-3">
                  <div className="min-w-0 space-y-2">
                    <span className="flex h-8 items-center text-xs font-medium text-[var(--text-secondary)]">
                      配置模板
                    </span>
                    <textarea
                      aria-label={`${profile.name} 文件模板`}
                      value={file.template}
                      onChange={event =>
                        props.onUpdateFile(file.id, { template: event.target.value })
                      }
                      placeholder="使用 {{BASE_URL}}、{{API_KEY}}、{{MODEL}} 作为占位符"
                      className="h-44 w-full resize-none overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <span className="flex h-8 items-center text-xs font-medium text-[var(--text-secondary)]">
                      配置预览
                    </span>
                    <pre className="h-44 overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs text-[var(--text-secondary)]">
                      {file.template
                        ? renderTemplatePreview(file.template, targetValues)
                        : '选择配置目标并编辑模板后显示预览'}
                    </pre>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex h-8 items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--text-secondary)]">
                        本地配置
                      </span>
                      <div className="flex items-center gap-1">
                        <AppButton
                          variant="secondary"
                          size="sm"
                          title="保存本地文件修改（预览后写入）"
                          disabled={!snapshot}
                          onClick={props.onSaveLocal}
                        >
                          <Save className="h-3.5 w-3.5" />
                          保存
                        </AppButton>
                        <AppButton variant="tertiary" size="sm" onClick={props.onReadLocal}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          读取
                        </AppButton>
                      </div>
                    </div>
                    {snapshot ? (
                      <textarea
                        aria-label={`${profile.name} 本地文件 ${file.path}`}
                        value={props.edits[file.id] ?? snapshot.content}
                        onChange={event => props.onEditLocal(file.id, event.target.value)}
                        className="h-44 w-full resize-none overflow-auto whitespace-pre rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] p-3 font-mono text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                      />
                    ) : (
                      <div className="flex min-h-44 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] p-5 text-center text-xs text-[var(--text-tertiary)]">
                        点击「读取」加载本地文件
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
        {profile.files.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] p-6 text-sm text-[var(--text-tertiary)]">
            添加一个文件后开始编辑
          </div>
        ) : null}
      </div>

      <details className="group rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <div>
            <span className="text-sm font-semibold">会话关联</span>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">按需关联外部会话记录路径</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-[var(--line-muted)] p-3">
          <ConversationPathEditor profile={profile} onUpdate={props.onUpdate} />
        </div>
      </details>

      <div className="flex justify-end border-t border-[var(--line-muted)] pt-3">
        {profile.isExample ? (
          <AppButton variant="secondary" onClick={props.onRestore}>
            <RefreshCw className="h-4 w-4" />
            恢复最新示例
          </AppButton>
        ) : null}
      </div>
    </div>
  );
}

function ConversationPathEditor(props: {
  profile: ConfigFileProfile;
  onUpdate: (update: (profile: ConfigFileProfile) => ConfigFileProfile) => void;
}) {
  const { profile } = props;
  const validate = async (connector: SessionRecordConnector) => {
    try {
      const result = await window.electronAPI.configFileProfiles.validateSessionRecord({
        connector,
      });
      const errors = result.diagnostics.filter(item => item.status === 'error');
      if (errors.length) toast.error(errors[0].message || '对话记录路径无法读取');
      else toast.success(`已检测到 ${result.records.length} 个对话`);
    } catch (error) {
      toast.error(errorMessage(error, '验证对话记录路径失败'));
    }
  };
  const updateConnector = (connectorId: string, updates: Partial<SessionRecordConnector>) => {
    props.onUpdate(item => ({
      ...item,
      sessionRecordConnectors: item.sessionRecordConnectors.map(value =>
        value.id === connectorId ? { ...value, ...updates } : value
      ),
    }));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-tertiary)]">
          可选。用于发现可能属于同一对话的本地记录,不会单独作为精确会话身份。
        </p>
        <AppButton
          variant="tertiary"
          size="sm"
          onClick={() =>
            props.onUpdate(item => ({
              ...item,
              sessionRecordConnectors: [
                ...item.sessionRecordConnectors,
                createSessionConnector(item.id),
              ],
            }))
          }
        >
          <Plus className="h-4 w-4" />
          添加路径
        </AppButton>
      </div>
      {profile.sessionRecordConnectors.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)]">尚未配置对话记录路径。</p>
      ) : null}
      {profile.sessionRecordConnectors.map(connector => (
        <div
          key={connector.id}
          className="space-y-3 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-1)] p-3"
        >
          <div className="flex gap-2">
            <AppInput
              size="sm"
              className="min-w-0 flex-1 font-mono"
              containerClassName="min-w-0 flex-1"
              aria-label={`${profile.name} 对话记录路径`}
              value={connector.path}
              placeholder="对话记录文件或目录"
              onChange={event => updateConnector(connector.id, { path: event.target.value })}
            />
            <AppButton variant="secondary" size="sm" onClick={() => void validate(connector)}>
              <RefreshCw className="h-4 w-4" />
              验证
            </AppButton>
            <AppButton
              variant="tertiary"
              size="sm"
              title="删除路径"
              onClick={() =>
                props.onUpdate(item => ({
                  ...item,
                  sessionRecordConnectors: item.sessionRecordConnectors.filter(
                    value => value.id !== connector.id
                  ),
                }))
              }
            >
              <Trash2 className="h-4 w-4" />
            </AppButton>
          </div>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
              <span>解析规则</span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <AppSelect
                  size="sm"
                  label="记录格式"
                  aria-label={`${profile.name} 对话记录格式`}
                  value={connector.format}
                  onChange={event =>
                    updateConnector(connector.id, {
                      format: event.target.value as 'json' | 'jsonl',
                    })
                  }
                >
                  <option value="json">JSON</option>
                  <option value="jsonl">JSONL</option>
                </AppSelect>
                <label className="flex items-end gap-2 pb-2 text-xs text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={connector.recursive === true}
                    onChange={event =>
                      updateConnector(connector.id, { recursive: event.target.checked })
                    }
                  />
                  递归扫描目录
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ParseRuleGroup title="记录定位">
                  <AppInput
                    size="sm"
                    label="命名空间"
                    placeholder="例如 codex"
                    value={connector.namespace}
                    onChange={event =>
                      updateConnector(connector.id, { namespace: event.target.value })
                    }
                  />
                  <AppInput
                    size="sm"
                    label="记录列表路径"
                    placeholder="例如 sessions"
                    value={connector.recordsPath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { recordsPath: event.target.value })
                    }
                  />
                </ParseRuleGroup>
                <ParseRuleGroup title="会话身份">
                  <AppInput
                    size="sm"
                    label="Session ID 路径"
                    placeholder="例如 id / session_id"
                    value={connector.sessionIdPath}
                    onChange={event =>
                      updateConnector(connector.id, { sessionIdPath: event.target.value })
                    }
                  />
                  <AppInput
                    size="sm"
                    label="对话名称路径"
                    placeholder="例如 title"
                    value={connector.displayNamePath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { displayNamePath: event.target.value })
                    }
                  />
                </ParseRuleGroup>
                <ParseRuleGroup title="时间与工作区">
                  <AppInput
                    size="sm"
                    label="工作区路径"
                    placeholder="例如 cwd"
                    value={connector.workspacePath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { workspacePath: event.target.value })
                    }
                  />
                  <AppInput
                    size="sm"
                    label="更新时间路径"
                    placeholder="例如 updated_at"
                    value={connector.updatedAtPath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { updatedAtPath: event.target.value })
                    }
                  />
                </ParseRuleGroup>
                <ParseRuleGroup title="窗口状态">
                  <AppInput
                    size="sm"
                    label="打开状态路径"
                    placeholder="例如 is_open / active / current"
                    value={connector.activePath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { activePath: event.target.value })
                    }
                  />
                  <AppInput
                    size="sm"
                    label="窗口打开状态路径"
                    placeholder="JSON 顶层路径,例如 window.is_open"
                    value={connector.windowOpenPath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { windowOpenPath: event.target.value })
                    }
                  />
                  <AppInput
                    size="sm"
                    label="窗口当前 Session ID 路径"
                    placeholder="JSON 顶层路径,例如 window.current_session_id"
                    value={connector.currentSessionIdPath || ''}
                    onChange={event =>
                      updateConnector(connector.id, { currentSessionIdPath: event.target.value })
                    }
                  />
                </ParseRuleGroup>
              </div>
              <p className="text-xs leading-5 text-[var(--text-tertiary)]">
                “窗口打开状态路径”和“窗口当前 Session ID
                路径”需要配合使用:只有窗口状态明确为打开时,当前 ID
                匹配的会话才标记为打开;窗口关闭时全部标记为关闭,状态缺失时保持未知。“打开状态路径”用于每条记录已自带窗口状态的格式,支持布尔值、0/1,以及
                open、active、current、selected、closed、inactive
                等值。未提供明确窗口状态时只发现会话,不会根据当前
                ID、更新时间或请求时间猜测窗口仍然打开。
              </p>
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

function ParseRuleGroup(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-2.5">
      <span className="block text-xs font-medium text-[var(--text-tertiary)]">{props.title}</span>
      {props.children}
    </div>
  );
}
