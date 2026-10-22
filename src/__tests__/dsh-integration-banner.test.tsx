import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshIntegrationBanner } from '../renderer/components/Route/DshIntegrationBanner';
import type { DshModelSource, DshRoutingStatus } from '../shared/types/dsh-integration';

const LOCAL_SOURCE: DshModelSource = {
  id: 'local-route',
  label: '本地路由',
  kind: 'local-route',
  models: ['model-a', 'model-b'],
};

function buildStatus(overrides: Partial<DshRoutingStatus> = {}): DshRoutingStatus {
  return {
    installed: true,
    dshHome: 'C:/Users/test/.dsh',
    profileDir: 'C:/Users/test/.dsh/profiles/desktop',
    patchFilePath: 'C:/Users/test/.dsh/profiles/desktop/cordis.patch.yml',
    credentialsFilePath: 'C:/Users/test/.dsh/.credentials.yaml',
    running: false,
    configured: false,
    drift: ['patch-entry-missing'],
    currentBaseUrl: null,
    expectedBaseUrl: 'http://127.0.0.1:3210',
    configuredModelCount: 0,
    missingModels: ['model-a', 'model-b'],
    staleModels: [],
    sessionsOnLegacyProvider: 0,
    sessionsTotal: 0,
    restartRequired: true,
    modelSources: [LOCAL_SOURCE],
    matchedModelSourceId: null,
    summary: '未接入：DSH 所有对话窗口会共用同一张路由卡片',
    ...overrides,
  };
}

const statusMock = vi.fn();
const enableMock = vi.fn();
const migrateMock = vi.fn();
const rollbackMock = vi.fn();

beforeEach(() => {
  statusMock.mockReset();
  enableMock.mockReset();
  migrateMock.mockReset();
  rollbackMock.mockReset();
  (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    dshIntegration: {
      status: statusMock,
      enable: enableMock,
      rollback: rollbackMock,
      migrateSessions: migrateMock,
    },
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('DshIntegrationBanner', () => {
  it('IPC 不可用时静默不渲染', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const { container } = render(<DshIntegrationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('未安装 DSH 时不渲染', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({ installed: false, profileDir: null, patchFilePath: null }),
    });
    const { container } = render(<DshIntegrationBanner />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('未接入时展示目标地址并支持一键接入', async () => {
    statusMock.mockResolvedValue({ ok: true, data: buildStatus() });
    enableMock.mockResolvedValue({ ok: true, data: {} });

    render(<DshIntegrationBanner />);

    expect(await screen.findByText('DeepSeek Harness 未启用会话级路由')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:3210')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键接入' }));

    await waitFor(() =>
      expect(enableMock).toHaveBeenCalledWith({
        migrateSessions: true,
        modelSourceId: 'local-route',
      })
    );
  });

  it('DSH 正在运行时只写配置，不迁移会话', async () => {
    statusMock.mockResolvedValue({ ok: true, data: buildStatus({ running: true }) });
    enableMock.mockResolvedValue({ ok: true, data: {} });

    render(<DshIntegrationBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '一键接入' }));

    await waitFor(() =>
      expect(enableMock).toHaveBeenCalledWith({
        migrateSessions: false,
        modelSourceId: 'local-route',
      })
    );
  });

  it('应用里没有供应商时引导去添加，且不给接入按钮', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({ modelSources: [], drift: ['no-model-source'] }),
    });

    render(<DshIntegrationBanner />);

    expect(await screen.findByText('还没有可用的模型供应商')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '一键接入' })).not.toBeInTheDocument();
  });

  it('多个供应商时给出选择器，并用选中的来源接入', async () => {
    const other: DshModelSource = {
      id: 'managed:site-1:account-1',
      label: 'Relay / 主账号',
      kind: 'managed',
      models: ['relay-x', 'relay-y', 'relay-z'],
    };
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({ modelSources: [LOCAL_SOURCE, other] }),
    });
    enableMock.mockResolvedValue({ ok: true, data: {} });

    render(<DshIntegrationBanner />);

    const select = await screen.findByLabelText('选择模型来源');
    expect(screen.getByText('Relay / 主账号（3 个模型）')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: other.id } });
    fireEvent.click(screen.getByRole('button', { name: '一键接入' }));

    await waitFor(() =>
      expect(enableMock).toHaveBeenCalledWith({
        migrateSessions: true,
        modelSourceId: other.id,
      })
    );
  });

  it('模型目录变化时提示重新应用', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({
        drift: ['models-out-of-sync'],
        missingModels: ['model-new'],
        staleModels: ['model-old'],
        summary: '模型目录已变化（新增 1 个，移除 1 个），需要重新应用一次',
      }),
    });

    render(<DshIntegrationBanner />);

    expect(await screen.findByText('模型目录已变化，需要重新应用')).toBeInTheDocument();
    expect(screen.getByText('新增 1 个，移除 1 个')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新应用' })).toBeInTheDocument();
  });

  it('已接入但仍有会话钉在旧通道时，提示并支持迁移', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({
        configured: true,
        drift: ['ok'],
        sessionsOnLegacyProvider: 3,
        sessionsTotal: 8,
      }),
    });
    migrateMock.mockResolvedValue({ ok: true, data: { changedRefs: 6 } });

    render(<DshIntegrationBanner />);

    expect(await screen.findByText('DeepSeek Harness 还有会话在使用旧通道')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '迁移存量会话' }));

    await waitFor(() => expect(migrateMock).toHaveBeenCalled());
  });

  it('完全就绪时只渲染一行状态，不再占大版面，且提供恢复入口', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({ configured: true, drift: ['ok'], sessionsOnLegacyProvider: 0 }),
    });
    render(<DshIntegrationBanner />);

    expect(await screen.findByTestId('dsh-integration-ready')).toBeInTheDocument();
    expect(screen.queryByTestId('dsh-integration-banner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /恢复初始状态/ })).toBeInTheDocument();
  });

  it('点恢复初始状态会调用回滚并刷新状态', async () => {
    statusMock.mockResolvedValue({
      ok: true,
      data: buildStatus({ configured: true, drift: ['ok'], sessionsOnLegacyProvider: 0 }),
    });
    rollbackMock.mockResolvedValue({ ok: true, data: { restoredFiles: ['a'] } });

    render(<DshIntegrationBanner />);
    fireEvent.click(await screen.findByRole('button', { name: /恢复初始状态/ }));

    await waitFor(() => expect(rollbackMock).toHaveBeenCalled());
  });

  it('接入失败时展示错误文案', async () => {
    statusMock.mockResolvedValue({ ok: true, data: buildStatus() });
    enableMock.mockResolvedValue({ ok: false, error: 'DeepSeek Harness 正在运行，请先完全退出' });

    render(<DshIntegrationBanner />);
    fireEvent.click(await screen.findByRole('button', { name: '一键接入' }));

    expect(await screen.findByTestId('dsh-integration-error')).toHaveTextContent(
      'DeepSeek Harness 正在运行'
    );
  });
});
