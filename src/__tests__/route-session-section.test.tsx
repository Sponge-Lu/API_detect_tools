import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteSessionSection } from '../renderer/components/Route/RouteSessionSection';
import type { RouteInstance, RoutingConfig } from '../shared/types/route-proxy';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockClose = vi.fn();
const mockCancel = vi.fn();
const mockArchive = vi.fn();
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
  const route = window.electronAPI.route;
  if (!route) throw new Error('Route bridge is unavailable');
  route.listRouteInstances = mockList;
  route.createArmedRouteInstance = mockCreate;
  route.updateRouteInstance = mockUpdate;
  route.closeRouteInstance = mockClose;
  route.cancelArmedRouteInstance = mockCancel;
  route.archiveRouteInstance = mockArchive;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('route session instance cards', () => {
  it('precreates a route using only model and reasoning effort', async () => {
    render(<RouteSessionSection />);
    await screen.findByText('session-1');
    fireEvent.click(screen.getByRole('button', { name: '为下一个新会话创建路由' }));
    fireEvent.change(screen.getByLabelText('预创建路由模型'), {
      target: { value: 'model-a' },
    });
    fireEvent.change(screen.getByLabelText('预创建路由思考强度'), {
      target: { value: 'xhigh' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ modelId: 'model-a', reasoningEffort: 'xhigh' })
    );
  });

  it('cancels the next-session route form without creating an armed route', async () => {
    render(<RouteSessionSection />);
    await screen.findByText('session-1');
    fireEvent.click(screen.getByRole('button', { name: '为下一个新会话创建路由' }));
    expect(screen.getByLabelText('预创建路由模型')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByLabelText('预创建路由模型')).not.toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows stable session identity and edits display aliases without changing it', async () => {
    render(<RouteSessionSection />);
    expect(await screen.findByText('session-1')).toBeInTheDocument();
    const stateLabel = screen.getByText('当前');
    expect(stateLabel).toBeInTheDocument();
    expect(stateLabel.nextElementSibling).toHaveAttribute('data-agent-logo', 'codex');
    expect(screen.getByDisplayValue('Terminal 1')).toBeInTheDocument();
    expect(screen.getByText(/创建 /)).toBeInTheDocument();
    expect(screen.getByText(/最近 /)).toBeInTheDocument();
    expect(screen.getByTestId('route-session-card-route-1')).toHaveAttribute(
      'data-density',
      'compact'
    );
    expect(screen.getByTestId('route-session-grid-scroll')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('route-session-grid')).toHaveClass('grid-cols-3', 'min-w-[60rem]');
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
    expect(screen.getByText('未提供稳定物理窗口标识')).toBeInTheDocument();
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
    expect(screen.getByText('未提供稳定物理窗口标识')).toBeInTheDocument();
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

  it('offers an explicit close action because silence does not change state', async () => {
    render(<RouteSessionSection />);
    await screen.findByText('session-1');
    fireEvent.click(screen.getByRole('button', { name: '关闭 session-1 路由' }));
    await waitFor(() => expect(mockClose).toHaveBeenCalledWith('route-1'));
  });
});
