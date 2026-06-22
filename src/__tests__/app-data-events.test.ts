import { afterEach, describe, expect, it, vi } from 'vitest';

type MockWindow = {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
    mainFrame: {
      send: ReturnType<typeof vi.fn>;
    };
  };
};

const getAllWindows = vi.fn<() => MockWindow[]>(() => []);
const loggerWarn = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    warn: loggerWarn,
  },
}));

function createMockWindow(params?: {
  destroyed?: boolean;
  webContentsDestroyed?: boolean;
  send?: ReturnType<typeof vi.fn>;
  mainFrameAccessError?: Error;
}): MockWindow {
  const webContents = {
    isDestroyed: vi.fn(() => params?.webContentsDestroyed ?? false),
    mainFrame: {
      send: params?.send ?? vi.fn(),
    },
  };

  if (params?.mainFrameAccessError) {
    Object.defineProperty(webContents, 'mainFrame', {
      get: () => {
        throw params.mainFrameAccessError;
      },
    });
  }

  return {
    isDestroyed: vi.fn(() => params?.destroyed ?? false),
    webContents,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('app data events', () => {
  it('broadcasts renderer events only to live windows', async () => {
    const liveWindow = createMockWindow();
    const destroyedWindow = createMockWindow({ destroyed: true });
    const destroyedWebContentsWindow = createMockWindow({ webContentsDestroyed: true });
    getAllWindows.mockReturnValue([liveWindow, destroyedWindow, destroyedWebContentsWindow]);

    const { broadcastRendererEvent } = await import('../main/app-data-events');
    const payload = { ok: true };

    broadcastRendererEvent('app-data:test', payload);

    expect(liveWindow.webContents.mainFrame.send).toHaveBeenCalledWith('app-data:test', payload);
    expect(destroyedWindow.webContents.mainFrame.send).not.toHaveBeenCalled();
    expect(destroyedWebContentsWindow.webContents.mainFrame.send).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('swallows the disposed renderer frame send race', async () => {
    const send = vi.fn(() => {
      throw new Error('Render frame was disposed before WebFrameMain could be accessed');
    });
    getAllWindows.mockReturnValue([createMockWindow({ send })]);

    const { broadcastRendererEvent } = await import('../main/app-data-events');

    expect(() => broadcastRendererEvent('app-data:test', { ok: true })).not.toThrow();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('skips the disposed renderer frame access race', async () => {
    getAllWindows.mockReturnValue([
      createMockWindow({
        mainFrameAccessError: new Error(
          'Render frame was disposed before WebFrameMain could be accessed'
        ),
      }),
    ]);

    const { broadcastRendererEvent } = await import('../main/app-data-events');

    expect(() => broadcastRendererEvent('app-data:test', { ok: true })).not.toThrow();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('logs unexpected renderer event send failures', async () => {
    const error = new Error('unexpected send failure');
    const send = vi.fn(() => {
      throw error;
    });
    getAllWindows.mockReturnValue([createMockWindow({ send })]);

    const { broadcastRendererEvent } = await import('../main/app-data-events');

    expect(() => broadcastRendererEvent('app-data:test', { ok: true })).not.toThrow();
    expect(loggerWarn).toHaveBeenCalledWith(
      'Failed to broadcast renderer event',
      'app-data:test',
      error
    );
  });
});
