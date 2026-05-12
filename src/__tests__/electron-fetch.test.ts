import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setHeader = vi.fn();
  const netRequest = vi.fn(() => {
    const requestHandlers: Record<string, (value: unknown) => void> = {};
    return {
      abort: vi.fn(),
      end: vi.fn(() => {
        const responseHandlers: Record<string, (value?: unknown) => void> = {};
        const response = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: { 'content-type': 'text/plain' },
          on: vi.fn((event: string, handler: (value?: unknown) => void) => {
            responseHandlers[event] = handler;
          }),
        };

        requestHandlers.response?.(response);
        responseHandlers.data?.(Buffer.from('ok'));
        responseHandlers.end?.();
      }),
      on: vi.fn((event: string, handler: (value: unknown) => void) => {
        requestHandlers[event] = handler;
      }),
      setHeader,
      write: vi.fn(),
    };
  });

  return { netRequest, setHeader };
});

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'test-user-data'),
    isReady: vi.fn(() => true),
    on: vi.fn(),
  },
  net: {
    request: mocks.netRequest,
  },
  session: undefined,
}));

vi.mock('../main/utils/logger', () => ({
  default: {
    scope: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
  Logger: {
    scope: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

import { electronFetchRaw, normalizeProxyUrl } from '../main/utils/electron-fetch';

describe('electron-fetch proxy URL normalization', () => {
  it('defaults bare host:port values to an HTTP proxy URL', () => {
    expect(normalizeProxyUrl('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
  });

  it('keeps supported proxy schemes without trailing path noise', () => {
    expect(normalizeProxyUrl('socks5://127.0.0.1:1080/')).toBe('socks5://127.0.0.1:1080');
  });

  it('ignores unsupported proxy schemes', () => {
    expect(normalizeProxyUrl('file://127.0.0.1:7890')).toBeUndefined();
  });
});

describe('electronFetchRaw request headers', () => {
  it('skips Chromium-restricted request headers before calling setHeader', async () => {
    await electronFetchRaw('https://anyrouter.top/v1/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk-upstream',
        'content-length': '17',
        connection: 'upgrade',
        host: 'anyrouter.top',
        'transfer-encoding': 'chunked',
      },
      body: Buffer.from('{"ok":true}'),
    });

    expect(mocks.setHeader).toHaveBeenCalledWith('authorization', 'Bearer sk-upstream');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('content-length', '17');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('connection', 'upgrade');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('host', 'anyrouter.top');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('transfer-encoding', 'chunked');
  });

  it('skips Chromium-managed browser headers commonly sent by Gemini CLI clients', async () => {
    await electronFetchRaw(
      'https://generativelanguage.googleapis.com/v1beta/models/raw:streamGenerateContent',
      {
        method: 'POST',
        headers: {
          'accept-encoding': 'gzip, deflate, br',
          cookie: 'session=local-client-cookie',
          origin: 'http://127.0.0.1:48123',
          'proxy-authorization': 'Basic local-proxy-auth',
          referer: 'http://127.0.0.1:48123/',
          'sec-fetch-mode': 'cors',
          'user-agent': 'GeminiCLI/0.1.0 google-api-nodejs-client/9.15.1',
          'x-goog-api-client': 'gl-node/22.0.0',
          'x-goog-api-key': 'sk-upstream',
        },
        body: Buffer.from('{"contents":[]}'),
      }
    );

    expect(mocks.setHeader).not.toHaveBeenCalledWith('accept-encoding', 'gzip, deflate, br');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('cookie', 'session=local-client-cookie');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('origin', 'http://127.0.0.1:48123');
    expect(mocks.setHeader).not.toHaveBeenCalledWith(
      'proxy-authorization',
      'Basic local-proxy-auth'
    );
    expect(mocks.setHeader).not.toHaveBeenCalledWith('referer', 'http://127.0.0.1:48123/');
    expect(mocks.setHeader).not.toHaveBeenCalledWith('sec-fetch-mode', 'cors');
    expect(mocks.setHeader).toHaveBeenCalledWith(
      'user-agent',
      'GeminiCLI/0.1.0 google-api-nodejs-client/9.15.1'
    );
    expect(mocks.setHeader).toHaveBeenCalledWith('x-goog-api-client', 'gl-node/22.0.0');
    expect(mocks.setHeader).toHaveBeenCalledWith('x-goog-api-key', 'sk-upstream');
  });
});
