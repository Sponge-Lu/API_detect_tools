/**
 * 配置文件页 UI 回归测试
 * 覆盖: 整卡点击编辑、卡片按钮 stopPropagation、徽章、删除确认、
 *       segmented 模型范围、本地配置直接保存、行级 diff 预览、会话关联默认折叠
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigFilesPage } from '../renderer/pages/ConfigFilesPage';

vi.mock('../renderer/store/toastStore', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-1',
    name: '测试方案',
    files: [{ id: 'file-1', path: 'C:/test/config.json', template: '{"model":"{{MODEL}}"}' }],
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    target: { kind: 'local-route', model: null },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const LOCAL_ROUTE_CATALOG = [
  {
    value: 'local-route',
    kind: 'local-route',
    label: '本地路由',
    available: true,
    apiKeys: [],
    models: [],
    allModels: [],
  },
];

function api() {
  return window.electronAPI.configFileProfiles as unknown as Record<
    string,
    ReturnType<typeof vi.fn>
  >;
}

beforeEach(() => {
  const config = api();
  window.electronAPI.appData = {
    onChanged: vi.fn(() => vi.fn()),
  };
  config.load.mockResolvedValue([]);
  config.getTargetCatalog.mockResolvedValue(LOCAL_ROUTE_CATALOG);
  config.upsert.mockImplementation(async ({ profile }: { profile: unknown }) => profile);
  config.delete.mockResolvedValue(undefined);
  config.readFiles.mockResolvedValue([]);
  config.preview.mockResolvedValue({ files: [] });
  config.previewDirectEdit.mockResolvedValue({ files: [] });
  config.previewRouteKeyRotation.mockResolvedValue({ transactionId: 'rotation-tx', files: [] });
  config.commit.mockResolvedValue(undefined);
});

describe('ConfigFilesPage UI refresh', () => {
  it('reloads the API key shown in the editor when route credentials change', async () => {
    const config = api();
    const previous = makeProfile({
      revision: 2,
      localRouteCredential: { id: 'credential-a', apiKey: 'old-key', createdAt: 1 },
    });
    config.load.mockResolvedValueOnce([previous]).mockResolvedValue([
      {
        ...previous,
        revision: 3,
        localRouteCredential: { id: 'credential-a', apiKey: 'new-key', createdAt: 1, rotatedAt: 2 },
      },
    ]);
    render(<ConfigFilesPage />);
    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    expect(screen.getByLabelText('测试方案 API Key')).toHaveValue('old-key');

    fireEvent.change(screen.getByLabelText('配置名称'), { target: { value: '未保存草稿' } });
    const onChanged = (
      window.electronAPI.appData?.onChanged as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    await act(async () => {
      onChanged({ domains: ['config-file-profiles'], emittedAt: Date.now() });
    });
    expect(config.load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(await screen.findByRole('button', { name: '放弃更改' }));
    await waitFor(() => expect(config.load).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByLabelText('测试方案 配置卡片'));
    expect(screen.getByLabelText('测试方案 API Key')).toHaveValue('new-key');
  });

  it('opens the editor when the whole card is clicked and keeps card buttons isolated', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    render(<ConfigFilesPage />);

    const card = await screen.findByLabelText('测试方案 配置卡片');
    expect(card).toHaveClass('shadow-[var(--shadow-md)]', 'hover:shadow-[var(--shadow-lg)]');
    expect(card).toHaveClass('bg-[var(--surface-2)]');
    expect(card).toHaveClass('cursor-pointer');

    fireEvent.click(card);
    expect(await screen.findByText('基本信息')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    // 常驻卡片操作不应触发整卡编辑
    expect(screen.queryByRole('button', { name: '应用到本地' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '测试方案 编辑' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '测试方案 删除配置' }));
    expect(screen.queryByText('基本信息')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '删除配置' })).toBeInTheDocument();
  });

  it('shows saved resolved values when a profile has never been applied', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    config.resolveValues.mockResolvedValue({
      targetLabel: '本地路由',
      baseUrl: 'http://127.0.0.1:8787',
      apiKeyName: 'API Key',
      apiKey: 'sk-local',
      model: 'claude-sonnet',
    });
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(config.upsert).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    const card = await screen.findByLabelText('测试方案 配置卡片');
    expect(within(card).getByText('http://127.0.0.1:8787')).toBeInTheDocument();
    expect(within(card).getByText('API Key')).toBeInTheDocument();
    expect(within(card).getByText('claude-sonnet')).toBeInTheDocument();
  });

  it('renders 内置 and 需修复 as token-backed badges', async () => {
    const config = api();
    config.load.mockResolvedValue([
      makeProfile({ id: 'p1', name: '内置方案', isExample: true }),
      makeProfile({
        id: 'p2',
        name: '异常方案',
        target: { kind: 'direct', configId: 'gone', model: null },
      }),
    ]);
    render(<ConfigFilesPage />);

    const builtinBadge = await screen.findByText('内置');
    expect(builtinBadge).toHaveClass('bg-[var(--success-soft)]', 'text-[var(--success)]');
    const repairBadge = await screen.findByText('需修复');
    expect(repairBadge).toHaveClass('bg-[var(--danger-soft)]', 'text-[var(--danger)]');
  });

  it('confirms before deleting a configuration', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    config.delete = vi.fn().mockResolvedValue(undefined);
    render(<ConfigFilesPage />);

    await screen.findByText('测试方案');
    fireEvent.click(screen.getByRole('button', { name: '测试方案 删除配置' }));
    expect(screen.getByRole('dialog', { name: '删除配置' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText('测试方案')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '测试方案 删除配置' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(config.delete).toHaveBeenCalled());
    expect(screen.queryByText('测试方案')).not.toBeInTheDocument();
  });

  it('confirms before removing a file rule', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    fireEvent.click(await screen.findByRole('button', { name: '测试方案 删除文件 1' }));
    expect(screen.getByRole('dialog', { name: '删除文件' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.queryByText('文件 1')).not.toBeInTheDocument();
    expect(screen.getByText('添加一个文件后开始编辑')).toBeInTheDocument();
  });

  it('switches the model scope with an explicit segmented control', async () => {
    const config = api();
    config.load.mockResolvedValue([
      makeProfile({
        id: 'managed-1',
        name: '托管方案',
        target: { kind: 'managed', siteId: 's', accountId: 'a', apiKeyId: 'k1', model: null },
      }),
    ]);
    config.getTargetCatalog.mockResolvedValue([
      {
        value: 'managed:s:a',
        kind: 'managed',
        label: '站点 A',
        available: true,
        apiKeys: [{ id: 'k1', label: 'Key 1', scopedModels: ['claude-sonnet'] }],
        models: ['claude-sonnet'],
        allModels: ['claude-sonnet', 'claude-opus'],
      },
    ]);
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('托管方案 配置卡片'));
    const group = await screen.findByRole('group', { name: '模型显示范围' });
    expect(within(group).getByRole('button', { name: '按分组' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(group).getByRole('button', { name: '显示全部' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.queryByRole('option', { name: 'claude-opus' })).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: '显示全部' }));
    expect(within(group).getByRole('button', { name: '显示全部' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('option', { name: 'claude-opus' })).toBeInTheDocument();
  });

  it('exposes a direct-edit save button in the local config column', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    config.readFiles.mockResolvedValue([
      {
        fileId: 'file-1',
        path: 'C:/test/config.json',
        exists: true,
        content: '{"model":"old"}',
        hash: 'h',
        mtimeMs: 1,
      },
    ]);
    const previewDirectEdit = vi.fn().mockResolvedValue({ files: [] });
    config.previewDirectEdit = previewDirectEdit;
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    fireEvent.click(saveButton);
    await waitFor(() => expect(previewDirectEdit).toHaveBeenCalled());
  });

  it('renders a line diff with a change summary in the write preview', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    config.upsert.mockImplementation(async ({ profile }: { profile: { revision?: number } }) => ({
      ...profile,
      revision: 1,
    }));
    config.preview = vi.fn().mockResolvedValue({
      transactionId: 'tx-1',
      profileId: 'profile-1',
      createdAt: 1,
      expiresAt: 999999,
      files: [
        {
          fileId: 'file-1',
          path: 'C:/test/config.json',
          exists: true,
          content: 'line1\nbefore\nline3',
          hash: 'h',
          mtimeMs: 1,
          nextContent: 'line1\nafter\nline3',
          matchCounts: { baseUrl: 0, apiKey: 0, model: 1 },
          changed: true,
        },
      ],
    });
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    fireEvent.click(screen.getByRole('button', { name: '覆盖' }));
    fireEvent.click(screen.getByRole('button', { name: '预览写入' }));

    await waitFor(() =>
      expect(config.preview).toHaveBeenCalledWith(
        expect.objectContaining({ applyMode: 'overwrite' })
      )
    );

    expect(await screen.findByText('确认写入内容')).toBeInTheDocument();
    expect(screen.getByText('+ after')).toBeInTheDocument();
    expect(screen.getByText('- before')).toBeInTheDocument();
    expect(screen.getByText(/新增 1 行 · 删除 1 行/)).toBeInTheDocument();
    const addedLine = screen.getByText('+ after');
    expect(addedLine).toHaveClass('bg-[var(--success-soft)]', 'text-[var(--success)]');
    const removedLine = screen.getByText('- before');
    expect(removedLine).toHaveClass('bg-[var(--danger-soft)]', 'text-[var(--danger)]');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rotates an existing route key without opening the generic write preview', async () => {
    const config = api();
    const profile = makeProfile({
      revision: 3,
      localRouteCredential: {
        id: 'credential-1',
        apiKey: 'sk-route-old',
        createdAt: 1,
      },
    });
    config.load.mockResolvedValue([profile]);
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    fireEvent.click(screen.getByRole('button', { name: '重新生成 API Key' }));

    expect(screen.getByRole('dialog', { name: '重新生成 API Key' })).toBeInTheDocument();
    expect(screen.queryByText('确认写入内容')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认重新生成' }));

    await waitFor(() =>
      expect(config.previewRouteKeyRotation).toHaveBeenCalledWith({
        profileId: 'profile-1',
        expectedRevision: 3,
      })
    );
    await waitFor(() =>
      expect(config.commit).toHaveBeenCalledWith({ transactionId: 'rotation-tx' })
    );
    expect(screen.queryByText('确认写入内容')).not.toBeInTheDocument();
  });

  it('keeps session association collapsed by default with a single heading', async () => {
    const config = api();
    config.load.mockResolvedValue([makeProfile()]);
    render(<ConfigFilesPage />);

    fireEvent.click(await screen.findByLabelText('测试方案 配置卡片'));
    const heading = await screen.findByText('会话关联');
    const details = heading.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    // 合并重复标题:同一 section 只有一个「会话关联」标题
    expect(screen.queryByText('对话记录路径')).not.toBeInTheDocument();
  });
});
