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
  electronFetchRawStream: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/event-stream' },
    body: Buffer.from('data: ok\n\n'),
    firstByteLatencyMs: 8,
  })),
}));

vi.mock('../main/utils/electron-fetch', () => ({
  electronFetch: vi.fn(),
  electronFetchRaw: mocks.electronFetchRaw,
  electronFetchRawStream: mocks.electronFetchRawStream,
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

import { httpRawRequest, httpRawStreamRequest } from '../main/utils/http-client';

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

describe('httpRawStreamRequest', () => {
  it('uses Electron net raw streaming with proxy and callback forwarding', async () => {
    const body = Buffer.from('{"stream":true}');
    const onResponse = vi.fn(() => true);
    const onChunk = vi.fn();

    const response = await httpRawStreamRequest('https://anyrouter.top/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-empty': undefined,
      },
      body,
      timeout: 45000,
      streamIdleTimeout: 600000,
      proxyUrl: 'http://127.0.0.1:7890',
      preferElectronNet: true,
      onResponse,
      onChunk,
    });

    expect(mocks.electronFetchRawStream).toHaveBeenCalledWith(
      'https://anyrouter.top/v1/responses',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body,
        timeout: 45000,
        streamIdleTimeout: 600000,
        proxyUrl: 'http://127.0.0.1:7890',
        onResponse,
        onData: onChunk,
      }
    );
    expect(response).toEqual({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Buffer.from('data: ok\n\n'),
      firstByteLatencyMs: 8,
    });
  });
});
