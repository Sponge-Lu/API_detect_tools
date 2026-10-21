import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

const mocks = vi.hoisted(() => ({
  electronFetch: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    data: { ok: true },
    headers: { 'content-type': 'application/json' },
  })),
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
  axiosGet: vi.fn(async () => ({ data: { ok: true }, status: 200 })),
  axiosPost: vi.fn(async () => ({ data: { ok: true }, status: 200 })),
}));

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
    post: mocks.axiosPost,
  },
}));

vi.mock('../main/utils/electron-fetch', () => ({
  electronFetch: mocks.electronFetch,
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

import axios from 'axios';
import { app } from 'electron';
import {
  httpDelete,
  httpGet,
  httpPost,
  httpPostStream,
  httpRawRequest,
  httpRawStreamRequest,
  httpRequest,
} from '../main/utils/http-client';
import { electronFetchStream, isElectronNetAvailable } from '../main/utils/electron-fetch';

afterEach(() => {
  (app as any).isPackaged = false;
  vi.mocked(isElectronNetAvailable).mockReturnValue(true);
  vi.clearAllMocks();
});

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

  it('passes abort signals to Electron net raw forwarding', async () => {
    const signal = new AbortController().signal;

    await httpRawRequest('https://anyrouter.top/v1/responses', {
      method: 'POST',
      body: Buffer.from('{"input":"ping"}'),
      preferElectronNet: true,
      signal,
    });

    expect(mocks.electronFetchRaw).toHaveBeenCalledWith('https://anyrouter.top/v1/responses', {
      method: 'POST',
      headers: {},
      body: Buffer.from('{"input":"ping"}'),
      timeout: 30000,
      proxyUrl: undefined,
      signal,
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

  it('passes abort signals to Electron net raw streaming', async () => {
    const signal = new AbortController().signal;
    const onChunk = vi.fn();

    await httpRawStreamRequest('https://anyrouter.top/v1/responses', {
      method: 'POST',
      body: Buffer.from('{"stream":true}'),
      preferElectronNet: true,
      signal,
      onChunk,
    });

    expect(mocks.electronFetchRawStream).toHaveBeenCalledWith(
      'https://anyrouter.top/v1/responses',
      {
        method: 'POST',
        headers: {},
        body: Buffer.from('{"stream":true}'),
        timeout: 30000,
        streamIdleTimeout: undefined,
        proxyUrl: undefined,
        onResponse: undefined,
        onData: onChunk,
        signal,
      }
    );
  });

  it('forwards an explicit streamed-body retention opt-out', async () => {
    const onChunk = vi.fn();

    await httpRawStreamRequest('https://anyrouter.top/v1/responses', {
      method: 'POST',
      preferElectronNet: true,
      retainStreamedBody: false,
      onChunk,
    });

    expect(mocks.electronFetchRawStream).toHaveBeenLastCalledWith(
      'https://anyrouter.top/v1/responses',
      {
        method: 'POST',
        headers: {},
        body: undefined,
        timeout: 30000,
        streamIdleTimeout: undefined,
        proxyUrl: undefined,
        onResponse: undefined,
        onData: onChunk,
        retainStreamedBody: false,
      }
    );
  });
});

describe('httpGet/httpPost proxy support', () => {
  it('maps proxyUrl to axios when Electron net is unavailable (GET)', async () => {
    vi.mocked(isElectronNetAvailable).mockReturnValue(false);
    await httpGet('https://agentrouter.org/api/status', {
      timeout: 15000,
      proxyUrl: 'http://127.0.0.1:7890',
    });

    expect(mocks.axiosGet).toHaveBeenCalledWith('https://agentrouter.org/api/status', {
      timeout: 15000,
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: 7890,
        auth: undefined,
      },
      validateStatus: expect.any(Function),
    });
    expect(mocks.electronFetch).not.toHaveBeenCalled();
  });

  it('maps proxyUrl with credentials to the axios proxy config (POST)', async () => {
    vi.mocked(isElectronNetAvailable).mockReturnValue(false);
    await httpPost('https://agentrouter.org/api/signin', { a: 1 }, {
      proxyUrl: 'http://user:p%40ss@127.0.0.1:7890',
    } as any);

    expect(mocks.axiosPost).toHaveBeenCalledWith(
      'https://agentrouter.org/api/signin',
      { a: 1 },
      expect.objectContaining({
        proxy: expect.objectContaining({
          protocol: 'http',
          host: '127.0.0.1',
          port: 7890,
          auth: { username: 'user', password: 'p@ss' },
        }),
      })
    );
  });

  it('keeps direct connection when proxyUrl is omitted (GET)', async () => {
    vi.mocked(isElectronNetAvailable).mockReturnValue(false);
    await httpGet('https://example.com/api/status', { timeout: 5000 });

    expect(mocks.axiosGet).toHaveBeenCalledWith(
      'https://example.com/api/status',
      expect.objectContaining({ timeout: 5000, proxy: undefined })
    );
  });

  it('forwards proxyUrl to Electron net when packaged (GET)', async () => {
    (app as any).isPackaged = true;

    await httpGet('https://agentrouter.org/api/status', {
      timeout: 15000,
      proxyUrl: 'socks5://127.0.0.1:1080',
    });

    expect(mocks.electronFetch).toHaveBeenCalledWith(
      'https://agentrouter.org/api/status',
      expect.objectContaining({
        method: 'GET',
        timeout: 15000,
        proxyUrl: 'socks5://127.0.0.1:1080',
      })
    );
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('forwards proxyUrl to Electron net when packaged (POST)', async () => {
    (app as any).isPackaged = true;

    await httpPost(
      'https://agentrouter.org/api/signin',
      { a: 1 },
      {
        timeout: 15000,
        proxyUrl: 'http://127.0.0.1:7890',
      }
    );

    expect(mocks.electronFetch).toHaveBeenCalledWith(
      'https://agentrouter.org/api/signin',
      expect.objectContaining({
        method: 'POST',
        timeout: 15000,
        proxyUrl: 'http://127.0.0.1:7890',
      })
    );
  });
});

describe.each([false, true])('HTTP runtime parity (isPackaged=%s)', isPackaged => {
  it('uses Electron net for every request entrypoint, including default raw forwarding', async () => {
    (app as { isPackaged: boolean }).isPackaged = isPackaged;
    const url = 'https://example.com/api/status';
    const config = { proxyUrl: 'socks5://127.0.0.1:1080', timeout: 15000 };
    await httpGet(url, config);
    await httpPost(url, { ok: true }, config);
    await httpDelete(url, config);
    await httpRequest({ ...config, url, method: 'PUT', data: { ok: true } });
    await httpPostStream(url, { stream: true }, config);
    await httpRawRequest(url, config);
    await httpRawStreamRequest(url, config);

    expect(mocks.electronFetch).toHaveBeenCalledTimes(4);
    for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
      expect(mocks.electronFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ ...config, method })
      );
    }
    expect(mocks.electronFetchRaw).toHaveBeenCalledWith(url, expect.objectContaining(config));
    expect(mocks.electronFetchRawStream).toHaveBeenCalledWith(url, expect.objectContaining(config));
    expect(electronFetchStream).toHaveBeenCalledWith(url, expect.objectContaining(config));
    expect(mocks.axiosGet).not.toHaveBeenCalled();
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it('preserves the caller status policy without switching transport on errors', async () => {
    (app as { isPackaged: boolean }).isPackaged = isPackaged;
    mocks.electronFetch.mockResolvedValueOnce({
      status: 503,
      statusText: 'Service Unavailable',
      data: { ok: false },
      headers: { 'content-type': 'application/json' },
    });
    await expect(
      httpGet('https://example.com/api/status', { validateStatus: status => status < 400 })
    ).rejects.toMatchObject({ isAxiosError: true, response: { status: 503 } });
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });
});
