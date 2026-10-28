/**
 * 代理服务器状态与凭证管理面板
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Play,
  Square,
  Copy,
  KeyRound,
  Loader2,
  Activity,
  Edit2,
  RotateCcw,
  Check,
  Eye,
  EyeOff,
  Trash2,
  Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useRouteStore } from '../../../store/routeStore';
import { toast } from '../../../store/toastStore';
import { AppCard, AppCardContent } from '../../AppCard';
import { AppButton } from '../../AppButton/AppButton';
import { AppInput } from '../../AppInput/AppInput';
import { AppModal } from '../../AppModal/AppModal';
import { AgentLogo, AgentLogoSelect } from '../../AgentLogo';
import { type RouteStateAffinitySummary } from '../../../../shared/types/route-proxy';
import type {
  ConfigFilePreviewTransaction,
  ConfigFileProfile,
  AgentLogoId,
} from '../../../../shared/types/config-file-profile';
const PROFILE_CREDENTIAL_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-soft)] bg-[var(--surface-2)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50';

/** 代理服务器状态区 */
interface RoutePanelProps {
  className?: string;
  variant?: 'card' | 'pane';
}

export function ServerSection({ className = '' }: RoutePanelProps) {
  const { config, serverRunning, saveServerConfig, startServer, stopServer } = useRouteStore(
    useShallow(s => ({
      config: s.config,
      serverRunning: s.serverRunning,
      saveServerConfig: s.saveServerConfig,
      startServer: s.startServer,
      stopServer: s.stopServer,
    }))
  );
  const [toggling, setToggling] = useState(false);
  const [localRouteProfiles, setLocalRouteProfiles] = useState<ConfigFileProfile[]>([]);
  const [visibleProfileKeys, setVisibleProfileKeys] = useState<Record<string, boolean>>({});
  const [credentialActionProfileId, setCredentialActionProfileId] = useState<string | null>(null);
  const [rotationPreview, setRotationPreview] = useState<ConfigFilePreviewTransaction | null>(null);
  const [stateClearPreview, setStateClearPreview] = useState<RouteStateAffinitySummary | null>(
    null
  );
  const [credentialEditorProfileId, setCredentialEditorProfileId] = useState<string | 'new' | null>(
    null
  );
  const [credentialDraft, setCredentialDraft] = useState<{
    name: string;
    agentLogoId?: AgentLogoId;
  }>({ name: '' });
  const [savingCredential, setSavingCredential] = useState(false);
  const [deleteCredentialProfile, setDeleteCredentialProfile] = useState<ConfigFileProfile | null>(
    null
  );
  const server = config?.server;

  const reloadProfiles = useCallback(async () => {
    const profiles = await window.electronAPI.configFileProfiles.load();
    setLocalRouteProfiles(profiles.filter(profile => profile.target.kind === 'local-route'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reloadProfiles().catch(
      error =>
        !cancelled && toast.error(error instanceof Error ? error.message : '加载代理服务器配置失败')
    );
    return () => {
      cancelled = true;
    };
  }, [reloadProfiles]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.appData?.onChanged?.(({ domains }) => {
      if (!domains.includes('config-file-profiles')) return;
      void reloadProfiles().catch(error =>
        toast.error(error instanceof Error ? error.message : '刷新客户端独立凭证失败')
      );
    });
    return () => unsubscribe?.();
  }, [reloadProfiles]);

  if (!config || !server) return null;

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (serverRunning) {
        const ok = await stopServer();
        if (ok) toast.success('代理服务器已停止');
        else toast.error('停止失败');
      } else {
        const ok = await startServer();
        if (ok) toast.success(`代理服务器已启动 ${server.host}:${server.port}`);
        else toast.error('启动失败');
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '未知错误');
    } finally {
      setToggling(false);
    }
  };

  const openCredentialEditor = (profile?: ConfigFileProfile) => {
    setCredentialDraft({
      name: profile?.name || '',
      agentLogoId: profile?.agentLogoId,
    });
    setCredentialEditorProfileId(profile?.id || 'new');
  };

  const saveCredentialProfile = async () => {
    const name = credentialDraft.name.trim();
    if (!name || !credentialEditorProfileId) return;
    setSavingCredential(true);
    try {
      if (credentialEditorProfileId === 'new') {
        const now = Date.now();
        const saved = await window.electronAPI.configFileProfiles.upsert({
          profile: {
            id: crypto.randomUUID(),
            name,
            agentLogoId: credentialDraft.agentLogoId,
            credentialOnly: true,
            files: [],
            sessionRecordConnectors: [],
            sessionRecordPaths: [],
            target: { kind: 'local-route', model: null },
            createdAt: now,
            updatedAt: now,
          },
        });
        setLocalRouteProfiles(current => [...current, saved]);
        setCredentialEditorProfileId(saved.id);
        const generated = await window.electronAPI.configFileProfiles.generateRouteKey({
          profileId: saved.id,
          expectedRevision: saved.revision,
        });
        setLocalRouteProfiles(current =>
          current.map(profile => (profile.id === generated.id ? generated : profile))
        );
        setVisibleProfileKeys(current => ({ ...current, [generated.id]: false }));
        toast.success(`已添加 ${generated.name} 并生成独立 API Key`);
      } else {
        const current = localRouteProfiles.find(
          profile => profile.id === credentialEditorProfileId
        );
        if (!current?.credentialOnly) throw new Error('仅凭证客户端不存在');
        const updated = await window.electronAPI.configFileProfiles.upsert({
          profile: {
            ...current,
            name,
            agentLogoId: credentialDraft.agentLogoId,
          },
          expectedRevision: current.revision,
        });
        setLocalRouteProfiles(profiles =>
          profiles.map(profile => (profile.id === updated.id ? updated : profile))
        );
        toast.success('客户端信息已更新');
      }
      setCredentialEditorProfileId(null);
      setCredentialDraft({ name: '' });
    } catch (error) {
      await reloadProfiles().catch(() => undefined);
      toast.error(error instanceof Error ? error.message : '保存客户端凭证失败');
    } finally {
      setSavingCredential(false);
    }
  };

  const deleteStandaloneCredential = async () => {
    if (!deleteCredentialProfile?.credentialOnly) return;
    setSavingCredential(true);
    try {
      await window.electronAPI.configFileProfiles.delete({
        profileId: deleteCredentialProfile.id,
        expectedRevision: deleteCredentialProfile.revision,
      });
      setLocalRouteProfiles(current =>
        current.filter(profile => profile.id !== deleteCredentialProfile.id)
      );
      setDeleteCredentialProfile(null);
      toast.success('客户端独立凭证已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除客户端凭证失败');
    } finally {
      setSavingCredential(false);
    }
  };

  const generateProfileKey = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      const updated = await window.electronAPI.configFileProfiles.generateRouteKey({
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      setLocalRouteProfiles(current =>
        current.map(item => (item.id === updated.id ? updated : item))
      );
      setVisibleProfileKeys(current => ({ ...current, [updated.id]: false }));
      toast.success(`已为 ${updated.name} 生成独立 API Key`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成独立 API Key 失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const previewProfileKeyRotation = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      setRotationPreview(
        await window.electronAPI.configFileProfiles.previewRouteKeyRotation({
          profileId: profile.id,
          expectedRevision: profile.revision,
        })
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成 API Key 轮换预览失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const commitProfileKeyRotation = async () => {
    if (!rotationPreview) return;
    setCredentialActionProfileId(rotationPreview.profileId);
    try {
      await window.electronAPI.configFileProfiles.commit({
        transactionId: rotationPreview.transactionId,
      });
      await reloadProfiles();
      setVisibleProfileKeys(current => ({ ...current, [rotationPreview.profileId]: false }));
      setRotationPreview(null);
      toast.success('API Key 与客户端配置文件已同步轮换');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '轮换 API Key 失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const previewProfileStateClear = async (profile: ConfigFileProfile) => {
    setCredentialActionProfileId(profile.id);
    try {
      const result = await window.electronAPI.route?.previewProfileStateClear?.(profile.id);
      if (!result?.success || !result.data) {
        throw new Error(result?.error || '无法读取状态资源影响范围');
      }
      setStateClearPreview(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取状态资源影响范围失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  const commitProfileStateClear = async () => {
    if (!stateClearPreview) return;
    setCredentialActionProfileId(stateClearPreview.profileId);
    try {
      const result = await window.electronAPI.route?.clearProfileState?.(
        stateClearPreview.profileId
      );
      if (!result?.success) throw new Error(result?.error || '清理状态资源失败');
      setStateClearPreview(null);
      toast.success(`已清理 ${result.data?.removed || 0} 条状态资源映射`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清理状态资源失败');
    } finally {
      setCredentialActionProfileId(null);
    }
  };

  return (
    <>
      <AppCard
        data-testid="route-server-section-card"
        className={className}
        hoverable={false}
        blur={false}
      >
        <AppCardContent className="p-4">
          <div className="mb-3 flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-[var(--accent)]" />
            <span className="truncate text-sm font-medium">代理服务器</span>
            <span
              className={`inline-flex items-center gap-1 rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium ${
                serverRunning
                  ? 'bg-[var(--success-soft)] text-[var(--success)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-secondary)]'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${serverRunning ? 'bg-[var(--success)]' : 'bg-[var(--icon-muted)]'}`}
              />
              {serverRunning ? '运行中' : '已停止'}
            </span>
            <AppButton
              variant={serverRunning ? 'danger' : 'primary'}
              size="sm"
              className="ml-auto shrink-0"
              onClick={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : serverRunning ? (
                <Square className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              <span className="ml-1">{serverRunning ? '停止' : '启动'}</span>
            </AppButton>
          </div>
          <div
            data-testid="route-server-primary-config-row"
            className="grid grid-cols-1 gap-3 md:grid-cols-3"
          >
            <AppInput
              id="route-server-port"
              label="端口"
              size="sm"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={server.port}
              onBlur={e => {
                const port = parseInt(e.target.value, 10);
                if (!isNaN(port) && port > 0 && port < 65536) saveServerConfig({ port });
              }}
            />
            <AppInput
              id="route-server-upstream-proxy"
              label="代理"
              size="sm"
              type="text"
              defaultValue={server.upstreamProxyUrl || ''}
              placeholder="http://127.0.0.1:7890"
              onBlur={e => saveServerConfig({ upstreamProxyUrl: e.target.value.trim() })}
            />
            <AppInput
              id="route-server-base-url"
              label="Base URL"
              size="sm"
              type="text"
              value={`http://${server.host}:${server.port}`}
              readOnly
              containerClassName="[&_input]:font-mono"
            />
          </div>
          <div className="mt-4 border-t border-[var(--line-muted)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">客户端独立凭证</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  配置文件客户端与手动添加的第三方供应商客户端共用独立认证。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-[var(--text-tertiary)]">
                  {localRouteProfiles.length} 个客户端
                </span>
                <AppButton size="sm" onClick={() => openCredentialEditor()}>
                  <Plus className="h-3.5 w-3.5" />
                  新增客户端
                </AppButton>
              </div>
            </div>
            <div
              className="grid grid-cols-3 gap-x-3 gap-y-1"
              data-testid="route-profile-credentials"
            >
              {localRouteProfiles.length === 0 ? (
                <p className="col-span-3 py-3 text-xs text-[var(--text-tertiary)]">
                  暂无客户端独立凭证
                </p>
              ) : (
                localRouteProfiles.map(profile => {
                  const credential = profile.localRouteCredential;
                  const visible = Boolean(visibleProfileKeys[profile.id]);
                  const busy = credentialActionProfileId === profile.id;
                  return (
                    <div
                      key={profile.id}
                      data-testid={`route-profile-credential-${profile.id}`}
                      className="min-w-0 space-y-1.5 border-t border-[var(--line-muted)] py-2.5"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <AgentLogo
                            logoId={profile.agentLogoId}
                            agentId={profile.builtin?.clientType}
                            agentName={profile.name}
                            className="h-5 w-5"
                          />
                          <p className="truncate text-xs font-medium" title={profile.name}>
                            {profile.name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <p className="text-[11px] text-[var(--text-tertiary)]">
                            {credential ? '已生成独立 Key' : '尚未生成 Key'}
                          </p>
                          {profile.credentialOnly ? (
                            <>
                              <button
                                type="button"
                                title="编辑客户端"
                                aria-label={`编辑 ${profile.name}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                                onClick={() => openCredentialEditor(profile)}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="删除客户端"
                                aria-label={`删除 ${profile.name}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                                onClick={() => setDeleteCredentialProfile(profile)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div
                        data-testid={`route-profile-credential-controls-${profile.id}`}
                        className="flex min-w-0 items-center gap-1"
                      >
                        <input
                          aria-label={`${profile.name} API Key`}
                          type={visible ? 'text' : 'password'}
                          value={credential?.apiKey || ''}
                          placeholder="尚未生成"
                          readOnly
                          className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-2 font-mono text-xs text-[var(--text-primary)]"
                        />
                        {credential ? (
                          <div
                            data-testid={`route-profile-credential-actions-${profile.id}`}
                            className="flex shrink-0 items-center gap-0.5"
                          >
                            <button
                              type="button"
                              title={visible ? '隐藏' : '显示'}
                              aria-label={`${visible ? '隐藏' : '显示'} ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() =>
                                setVisibleProfileKeys(current => ({
                                  ...current,
                                  [profile.id]: !visible,
                                }))
                              }
                            >
                              {visible ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              title="复制"
                              aria-label={`复制 ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => {
                                void navigator.clipboard.writeText(credential.apiKey);
                                toast.success('已复制');
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="轮换"
                              aria-label={`轮换 ${profile.name} API Key`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => void previewProfileKeyRotation(profile)}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              title="清理状态资源"
                              aria-label={`清理 ${profile.name} 状态资源`}
                              className={PROFILE_CREDENTIAL_ICON_BUTTON_CLASS}
                              onClick={() => void previewProfileStateClear(profile)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 text-xs font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void generateProfileKey(profile)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <KeyRound className="h-3.5 w-3.5" />
                            )}
                            生成
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </AppCardContent>
      </AppCard>
      <AppModal
        isOpen={credentialEditorProfileId !== null}
        onClose={() => setCredentialEditorProfileId(null)}
        title={credentialEditorProfileId === 'new' ? '新增客户端独立凭证' : '编辑客户端独立凭证'}
        titleIcon={<KeyRound className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton
              variant="tertiary"
              disabled={savingCredential}
              onClick={() => setCredentialEditorProfileId(null)}
            >
              取消
            </AppButton>
            <AppButton
              disabled={savingCredential || !credentialDraft.name.trim()}
              onClick={() => void saveCredentialProfile()}
            >
              {savingCredential ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {credentialEditorProfileId === 'new' ? '保存并生成' : '保存'}
            </AppButton>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1 text-xs">
            <span>客户端名称</span>
            <input
              autoFocus
              aria-label="客户端名称"
              value={credentialDraft.name}
              onChange={event =>
                setCredentialDraft(current => ({ ...current, name: event.target.value }))
              }
              className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--line-soft)] bg-[var(--surface-2)] px-3 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>Logo</span>
            <AgentLogoSelect
              value={credentialDraft.agentLogoId}
              agentName={credentialDraft.name}
              onChange={agentLogoId => setCredentialDraft(current => ({ ...current, agentLogoId }))}
            />
          </label>
        </div>
      </AppModal>
      <AppModal
        isOpen={deleteCredentialProfile !== null}
        onClose={() => setDeleteCredentialProfile(null)}
        title="删除客户端独立凭证"
        titleIcon={<Trash2 className="h-5 w-5" />}
        size="sm"
        footer={
          <>
            <AppButton
              variant="tertiary"
              disabled={savingCredential}
              onClick={() => setDeleteCredentialProfile(null)}
            >
              取消
            </AppButton>
            <AppButton
              variant="danger"
              disabled={savingCredential}
              onClick={() => void deleteStandaloneCredential()}
            >
              <Trash2 className="h-4 w-4" />
              确认删除
            </AppButton>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          删除 {deleteCredentialProfile?.name || '此客户端'} 后，其 API Key
          将立即失效，关联的本地状态映射也会清理。
        </p>
      </AppModal>
      <AppModal
        isOpen={rotationPreview !== null}
        onClose={() => setRotationPreview(null)}
        title="确认轮换客户端 API Key"
        titleIcon={<KeyRound className="h-5 w-5" />}
        size="lg"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setRotationPreview(null)}>
              取消
            </AppButton>
            <AppButton
              disabled={credentialActionProfileId !== null}
              onClick={() => void commitProfileKeyRotation()}
            >
              <Check className="h-4 w-4" />
              确认轮换
            </AppButton>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            {rotationPreview?.files.length
              ? '新 Key 将同步写入以下客户端配置文件；确认前旧 Key 仍保持有效。'
              : '此客户端没有关联配置文件；确认后只更新客户端独立凭证。'}
          </p>
          <div className="divide-y divide-[var(--line-muted)] border-y border-[var(--line-muted)]">
            {(rotationPreview?.files || []).map(file => (
              <div
                key={file.fileId}
                className="flex min-w-0 items-center justify-between gap-3 py-2"
              >
                <span className="truncate font-mono text-xs" title={file.path}>
                  {file.path}
                </span>
                <span
                  className={file.changed ? 'text-[var(--warning)]' : 'text-[var(--text-tertiary)]'}
                >
                  {file.changed ? '将更新' : '无需修改'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </AppModal>
      <AppModal
        isOpen={stateClearPreview !== null}
        onClose={() => setStateClearPreview(null)}
        title="确认清理状态资源"
        titleIcon={<Trash2 className="h-5 w-5" />}
        size="md"
        footer={
          <>
            <AppButton variant="tertiary" onClick={() => setStateClearPreview(null)}>
              取消
            </AppButton>
            <AppButton
              variant="danger"
              disabled={credentialActionProfileId !== null || stateClearPreview?.total === 0}
              onClick={() => void commitProfileStateClear()}
            >
              <Trash2 className="h-4 w-4" />
              确认清理
            </AppButton>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            将删除此客户端的 {stateClearPreview?.total || 0}{' '}
            条本地亲和映射。上游资源不会被删除，后续状态请求也不会重新选路。
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">{stateClearPreview?.responses || 0}</strong>
              Responses
            </div>
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">{stateClearPreview?.conversations || 0}</strong>
              Conversations
            </div>
            <div className="border-y border-[var(--line-muted)] py-2">
              <strong className="block text-base">
                {stateClearPreview?.conversationItems || 0}
              </strong>
              Items
            </div>
          </div>
        </div>
      </AppModal>
    </>
  );
}
