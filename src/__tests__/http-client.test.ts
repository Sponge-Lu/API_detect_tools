import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const mocks = vi.hoisted(() => ({
  electronFetchRaw: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: Buffer.from('{"ok":true}'),
    firstByteLatencyMs: 12,
  })),
}));

vi.mock('../main/utils/electron-fetch', () => ({
  electronFetch: vi.fn(),
  electronFetchRaw: mocks.electronFetchRaw,
  electronFetchStream: vi.fn(),
  isElectronNetAvailable: vi.fn(() => true),
  normalizeProxyUrl: vi.fn((proxyUrl?: string | null) => proxyUrl?.trim() || undefined),
}));

vi.mock('../main/utils/logger', () => ({
  Logger: {
    scope: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

import { httpRawRequest } from '../main/utils/http-client';

describe('httpRawRequest', () => {
  it('uses Electron net raw forwarding with the configured upstream proxy', async () => {
    const body = Buffer.from('{"input":"ping"}');

    const response = await httpRawRequest('https://anyrouter.top/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-empty': undefined,
      },
      body,
      timeout: 45000,
      proxyUrl: 'http://127.0.0.1:7890',
      preferElectronNet: true,
    });

    expect(mocks.electronFetchRaw).toHaveBeenCalledWith('https://anyrouter.top/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
      timeout: 45000,
      proxyUrl: 'http://127.0.0.1:7890',
    });
    expect(response).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"ok":true}'),
      firstByteLatencyMs: 12,
    });
  });
});
