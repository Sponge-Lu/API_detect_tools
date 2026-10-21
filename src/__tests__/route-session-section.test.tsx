import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteSessionSection } from '../renderer/components/Route/RouteSessionSection';
import type { RouteInstance, RoutingConfig } from '../shared/types/route-proxy';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockClose = vi.fn();
const mockCancel = vi.fn();
const mockArchive = vi.fn();
const mockRestore = vi.fn();
let mockConfig: RoutingConfig;

vi.mock('../renderer/store/routeStore', () => ({
  useRouteStore: (selector: (state: { config: RoutingConfig }) => unknown) =>
    selector({ config: mockConfig }),
}));

vi.mock('../renderer/store/toastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const activeRoute = (): RouteInstance => ({
  id: 'route-1',
  routeKey: { agentId: 'codex', runtimeSlotId: 'terminal-1', sessionId: 'session-1' },
  display: { observedAgentName: 'Codex', observedRuntimeSlotLabel: 'Terminal 1' },
  modelId: 'model-a',
  reasoningEffort: 'high',
  routingState: 'active',
  presenceState: 'unknown',
  createdAt: 1_000,
  lastRequestAt: 2_000,
});

const armedRoute = (): RouteInstance => ({
  id: 'route-1',
  display: {},
  modelId: '',
  reasoningEffort: 'medium',
  routingState: 'armed',
  presenceState: 'unknown',
});

beforeEach(() => {
  mockConfig = {
    modelRegistry: {
      entries: {
        'model-a': {
          canonicalName: 'model-a',
          aliases: ['model-a'],
          sources: [],
          vendor: 'gpt',
          hasOverride: false,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
  } as unknown as RoutingConfig;
  mockList.mockReset().mockResolvedValue({ success: true, data: [activeRoute()] });
  mockCreate.mockReset().mockResolvedValue({ success: true });
  mockUpdate.mockReset().mockImplementation(async (_id, updates) => ({
    success: true,
    data: { ...activeRoute(), ...updates },
  }));
  mockClose.mockReset().mockResolvedValue({ success: true });
  mockCancel.mockReset().mockResolvedValue({ success: true });
  mockArchive.mockReset().mockResolvedValue({ success: true, data: { archived: true } });
  mockRestore.mockReset().mockResolvedValue({ success: true, data: activeRoute() });
  const route = window.electronAPI.route;
  if (!route) throw new Error('Route bridge is unavailable');
  route.listRouteInstances = mockList;
  route.createArmedRouteInstance = mockCreate;
  route.updateRouteInstance = mockUpdate;
  route.closeRouteInstance = mockClose;
  route.cancelArmedRouteInstance = mockCancel;
  route.archiveRouteInstance = mockArchive;
  route.restoreRouteInstance = mockRestore;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('route session instance cards', () => {
  it('creates an armed route card immediately when starting a new session route', async () => {
    render(<RouteSessionSection />);
    await screen.findByText('session-1');
    fireEvent.click(screen.getByRole('button', { name: '为下一个新会话创建路由' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({}));
  });

  it('lets model and reasoning effort be chosen directly on the armed card', async () => {
    mockList.mockResolvedValue({ success: true, data: [armedRoute()] });
    render(<RouteSessionSection />);
    const modelSelect = await screen.findByLabelText('route-1 路由模型');
    expect(modelSelect).toHaveValue('');
    expect(screen.getByRole('option', { name: '选择模型' })).toBeInTheDocument();

    fireEvent.change(modelSelect, { target: { value: 'model-a' } });
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('route-1', { modelId: 'model-a' })
    );
  });

  it('shows stable session identity and edits display aliases without changing it', async () => {
    render(<RouteSessionSection />);
    expect(await screen.findByText('session-1')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-logo="codex"]')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText(/创建 /)).toBeInTheDocument();
    expect(screen.getByText(/最近 /)).toBeInTheDocument();
    expect(screen.getByTestId('route-session-card-route-1')).toHaveAttribute(
      'data-density',
      'compact'
    );
    expect(screen.getByTestId('route-session-grid-scroll')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('route-session-grid')).toHaveClass('grid-cols-3', 'min-w-[60rem]');
    expect(screen.getByLabelText('session-1 Agent 名称')).toHaveValue('Codex #1');
    expect(screen.getByTestId('route-session-grid').className).not.toMatch(
      /(?:sm|md|lg|xl):grid-cols/
    );

    const agentName = screen.getByLabelText('session-1 Agent 名称');
    fireEvent.change(agentName, { target: { value: 'My Codex' } });
    fireEvent.blur(agentName);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('route-1', { customAgentName: 'My Codex' })
    );
    expect(mockUpdate.mock.calls.flat().join(' ')).not.toContain('sessionId');
  });

  it('renders a different-model child with the parent sub-number', async () => {
    const parent = activeRoute();
    mockList.mockResolvedValue({
      success: true,
      data: [
        parent,
        {
          ...parent,
          id: 'route-child',
          routeKey: {
            agentId: 'codex',
            runtimeSlotId: 'child-session',
            sessionId: 'child-session',
          },
          parentInstanceId: parent.id,
          childOrdinal: 1,
          clientModelId: 'model-b',
          modelId: 'model-b',
          createdAt: 2_000,
        },
      ],
    });

    render(<RouteSessionSection />);

    const nameInputs = await screen.findAllByLabelText(/Agent 名称/);
    expect(nameInputs.map(input => (input as HTMLInputElement).value)).toEqual([
      'Codex #1',
      'Codex #1.1',
    ]);
  });

  it('describes session-scoped Codex routes without exposing context-window labels', async () => {
    const route = activeRoute();
    mockList.mockResolvedValue({
      success: true,
      data: [
        {
          ...route,
          routeKey: { ...route.routeKey!, runtimeSlotId: route.routeKey!.sessionId },
          display: {
            ...route.display,
            observedRuntimeSlotLabel: `${route.routeKey!.sessionId}:7`,
          },
        },
      ],
    });

    render(<RouteSessionSection />);

    expect(await screen.findByDisplayValue('会话级路由')).toBeInTheDocument();
    expect(screen.queryByText('未提供稳定物理窗口标识')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('session-1:7')).not.toBeInTheDocument();
    expect(screen.queryByText('session-1:7')).not.toBeInTheDocument();
  });

  it('describes session-scoped Claude Code routes without claiming a physical window', async () => {
    const route = activeRoute();
    mockList.mockResolvedValue({
      success: true,
      data: [
        {
          ...route,
          routeKey: {
            agentId: 'claudeCode',
            runtimeSlotId: 'claude-session-1',
            sessionId: 'claude-session-1',
          },
          display: {
            observedAgentName: 'Claude Code',
            observedRuntimeSlotLabel: 'Claude Code 会话',
          },
        },
      ],
    });

    render(<RouteSessionSection />);

    expect(await screen.findByDisplayValue('会话级路由')).toBeInTheDocument();
    expect(screen.queryByText('未提供稳定物理窗口标识')).not.toBeInTheDocument();
    expect(screen.getByText('claude-session-1')).toBeInTheDocument();
    expect(document.querySelector('[data-agent-logo="claudeCode"]')).toBeInTheDocument();
  });

  it('saves a custom reasoning effort and preserves the draft during polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockList.mockResolvedValueOnce({ success: true, data: [activeRoute()] }).mockResolvedValue({
      success: true,
      data: [{ ...activeRoute(), reasoningEffort: 'low' }],
    });

    render(<RouteSessionSection />);
    const effortSelect = await screen.findByLabelText('route-1 思考强度');
    fireEvent.change(effortSelect, { target: { value: '__custom__' } });
    const customInput = screen.getByLabelText('route-1 自定义思考强度');
    fireEvent.change(customInput, { target: { value: 'vendor-ultra' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mockList).toHaveBeenCalledTimes(2);
    expect(customInput).toHaveValue('vendor-ultra');
    fireEvent.blur(customInput);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('route-1', {
        reasoningEffort: 'vendor-ultra',
      })
    );
  });

  it('saves a session note on blur and skips saving when unchanged', async () => {
    render(<RouteSessionSection />);
    const noteInput = await screen.findByLabelText('route-1 备注');
    expect(noteInput).toHaveValue('');

    fireEvent.blur(noteInput);
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.change(noteInput, { target: { value: '重点客户会话' } });
    fireEvent.blur(noteInput);
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('route-1', { customNote: '重点客户会话' })
    );
  });

  it('offers an explicit close action because silence does not change state', async () => {
    render(<RouteSessionSection />);
    await screen.findByText('session-1');
    fireEvent.click(screen.getByRole('button', { name: '关闭 session-1 路由' }));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('route-1'));
  });

  it('offers restore before archive for a closed route card and reloads after restoring', async () => {
    const closed = { ...activeRoute(), routingState: 'closed' as const, closedAt: 3_000 };
    mockList.mockResolvedValue({ success: true, data: [closed] });
    mockRestore.mockResolvedValue({ success: true, data: { ...closed, routingState: 'active' } });

    render(<RouteSessionSection />);

    const card = await screen.findByTestId('route-session-card-route-1');
    const actionButtons = within(card).getAllByRole('button');
    expect(actionButtons.map(button => button.getAttribute('aria-label'))).toEqual([
      '恢复 session-1 路由',
      '归档 session-1 路由',
      '复制 session-1 Session ID',
    ]);

    fireEvent.click(actionButtons[0]);
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('route-1'));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('offers restore before archive for a cancelled pre-created route card', async () => {
    const cancelled: RouteInstance = {
      id: 'cancelled-route',
      display: {},
      modelId: 'model-a',
      reasoningEffort: 'high',
      routingState: 'cancelled',
      presenceState: 'unknown',
    };
    mockList.mockResolvedValue({ success: true, data: [cancelled] });

    render(<RouteSessionSection />);

    const card = await screen.findByTestId('route-session-card-cancelled-route');
    const actionButtons = within(card).getAllByRole('button');
    expect(actionButtons.map(button => button.getAttribute('aria-label'))).toEqual([
      '恢复 已取消 路由',
      '归档 已取消 路由',
    ]);

    fireEvent.click(actionButtons[0]);
    await waitFor(() => expect(mockRestore).toHaveBeenCalledWith('cancelled-route'));
  });

  it('renders a single-column mini density with restructured, simplified cards', async () => {
    render(<RouteSessionSection mini />);

    await screen.findByText('session-1');
    expect(screen.getByTestId('route-session-grid')).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('route-session-grid').className).not.toContain('grid-cols-3');
    expect(screen.getByTestId('route-session-grid').className).not.toContain('min-w-[60rem]');
    expect(screen.getByTestId('route-session-card-route-1')).toHaveAttribute(
      'data-density',
      'mini'
    );

    // mini 卡片的动作只保留图标，文字说明由 aria-label/title 承载
    const closeButton = screen.getByRole('button', { name: '关闭 session-1 路由' });
    expect(closeButton).toHaveTextContent('');
    expect(closeButton.querySelector('svg')).not.toBeNull();
    expect(closeButton.getAttribute('title')).toBe('关闭 session-1 路由');
    expect(screen.queryByText('为下一个新会话创建路由')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建路由' })).toBeInTheDocument();

    // 信息精简：运行范围输入、创建/最近时间与字段标签在 mini 密度下省略
    expect(screen.queryByDisplayValue('Terminal 1')).not.toBeInTheDocument();
    expect(screen.queryByText(/创建 /)).not.toBeInTheDocument();
    expect(screen.queryByText(/最近 /)).not.toBeInTheDocument();
    expect(screen.queryByText('Session')).not.toBeInTheDocument();
    expect(screen.getByLabelText('route-1 路由模型')).toBeInTheDocument();
    expect(screen.getByLabelText('route-1 思考强度')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制 session-1 Session ID' })).toBeInTheDocument();

    // 客户端名称直接展示不可编辑；备注内联在名称后且小一号（text-xs、h-4）
    expect(screen.getByText('Codex #1')).toBeInTheDocument();
    expect(screen.getByText('Codex #1')).toHaveClass('leading-4');
    expect(screen.queryByLabelText('session-1 Agent 名称')).not.toBeInTheDocument();
    const noteInput = screen.getByLabelText('route-1 备注');
    expect(noteInput.className).toContain('text-xs');
    expect(noteInput.className).toContain('h-4');
    expect(noteInput.getAttribute('placeholder')).toBe('备注');

    // 模型与思考强度同一行；卡片头标题与计数与映射工作区工具栏同字号
    expect(screen.getByLabelText('route-1 思考强度').closest('.w-20')).not.toBeNull();
    expect(screen.getByLabelText('route-1 路由模型').closest('.flex-1')).not.toBeNull();
    expect(screen.getByText('会话路由')).toHaveClass('text-xs', 'font-semibold');
    expect(screen.getByText('1 项')).toBeInTheDocument();

    // 幽灵下拉：去外框留箭头，压扁到 h-5
    expect(screen.getByLabelText('route-1 路由模型').className).toContain('!border-transparent');
    expect(screen.getByLabelText('route-1 路由模型').className).toContain('h-5');
    expect(screen.getByLabelText('route-1 思考强度').className).toContain('!border-transparent');
    expect(screen.getByLabelText('route-1 思考强度').className).toContain('h-5');

    // Session 行位于横线上方，横线下方是模型/思考强度行
    const modelRow = screen
      .getByLabelText('route-1 路由模型')
      .closest('div.border-t') as HTMLElement;
    expect(modelRow).not.toBeNull();
    expect(modelRow.previousElementSibling as HTMLElement).toHaveTextContent('session-1');
  });
});
