import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const setHeader = vi.fn();
  const state = {
    autoRespond: true,
    requestHandlers: {} as Record<string, (value: unknown) => void>,
    responseHandlers: {} as Record<string, (value?: unknown) => void>,
    lastRequest: null as { abort: ReturnType<typeof vi.fn> } | null,
    lastResponse: null as {
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
    } | null,
  };

  const startResponse = () => {
    const responseHandlers: Record<string, (value?: unknown) => void> = {};
    const response = {
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-type': 'text/plain' },
      on: vi.fn((event: string, handler: (value?: unknown) => void) => {
        responseHandlers[event] = handler;
      }),
      pause: vi.fn(),
      resume: vi.fn(),
    };

    state.responseHandlers = responseHandlers;
    state.lastResponse = response;
    state.requestHandlers.response?.(response);
    return responseHandlers;
  };

  const netRequest = vi.fn(() => {
    const requestHandlers: Record<string, (value: unknown) => void> = {};
    const request = {
      abort: vi.fn(),
      end: vi.fn(() => {
        if (!state.autoRespond) return;
        const responseHandlers = startResponse();
        responseHandlers.data?.(Buffer.from('ok'));
        responseHandlers.end?.();
      }),
      on: vi.fn((event: string, handler: (value: unknown) => void) => {
        requestHandlers[event] = handler;
      }),
      setHeader,
      write: vi.fn(),
    };

    state.requestHandlers = requestHandlers;
    state.lastRequest = request;
    return request;
  });

  return { netRequest, setHeader, startResponse, state };
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

import {
  electronFetchRaw,
  electronFetchRawStream,
  normalizeProxyUrl,
} from '../main/utils/electron-fetch';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.autoRespond = true;
  mocks.state.requestHandlers = {};
  mocks.state.responseHandlers = {};
  mocks.state.lastRequest = null;
  mocks.state.lastResponse = null;
});

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

  it('uses idle timeout semantics for active raw streaming responses', async () => {
    vi.useFakeTimers();
    mocks.state.autoRespond = false;

    try {
      const responsePromise = electronFetchRaw('https://generativelanguage.googleapis.com/stream', {
        method: 'POST',
        timeout: 1000,
        body: Buffer.from('{"stream":true}'),
      });

      await Promise.resolve();
      const responseHandlers = mocks.startResponse();

      await vi.advanceTimersByTimeAsync(900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.data?.(Buffer.from('chunk-1'));
      await vi.advanceTimersByTimeAsync(900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.data?.(Buffer.from('chunk-2'));
      await vi.advanceTimersByTimeAsync(900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.end?.();

      await expect(responsePromise).resolves.toMatchObject({
        status: 200,
        body: Buffer.from('chunk-1chunk-2'),
      });
    } finally {
      vi.useRealTimers();
      mocks.state.autoRespond = true;
    }
  });

  it('streams raw chunks to callbacks while retaining the complete response body', async () => {
    mocks.state.autoRespond = false;
    const events: string[] = [];
    const firstChunk = Buffer.from('data: one\n\n');
    const secondChunk = Buffer.from('data: two\n\n');

    const responsePromise = electronFetchRawStream('https://anyrouter.top/v1/responses', {
      method: 'POST',
      body: Buffer.from('{"stream":true}'),
      onResponse: response => {
        events.push(`response:${response.status}:${response.headers['content-type']}`);
        return true;
      },
      onData: async chunk => {
        events.push(`chunk:${chunk.toString('utf-8')}`);
      },
    });

    await Promise.resolve();
    const responseHandlers = mocks.startResponse();
    responseHandlers.data?.(firstChunk);
    await Promise.resolve();
    await Promise.resolve();
    responseHandlers.data?.(secondChunk);
    await Promise.resolve();
    await Promise.resolve();
    responseHandlers.end?.();

    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
      body: Buffer.concat([firstChunk, secondChunk]),
    });
    expect(events).toEqual([
      'response:200:text/plain',
      'chunk:data: one\n\n',
      'chunk:data: two\n\n',
    ]);
    expect(mocks.state.lastResponse?.pause).toHaveBeenCalledTimes(2);
    expect(mocks.state.lastResponse?.resume).toHaveBeenCalledTimes(2);
  });

  it('uses the initial timeout before the first raw stream chunk', async () => {
    vi.useFakeTimers();
    mocks.state.autoRespond = false;

    try {
      const responsePromise = electronFetchRawStream('https://anyrouter.top/v1/messages', {
        method: 'POST',
        timeout: 1000,
        streamIdleTimeout: 600000,
        body: Buffer.from('{"stream":true}'),
        onResponse: () => true,
        onData: vi.fn(),
      });
      const rejectionExpectation = expect(responsePromise).rejects.toThrow(
        'Request timeout after 1000ms'
      );

      await Promise.resolve();
      mocks.startResponse();

      await vi.advanceTimersByTimeAsync(1000);

      expect(mocks.state.lastRequest?.abort).toHaveBeenCalledTimes(1);
      await rejectionExpectation;
    } finally {
      vi.useRealTimers();
      mocks.state.autoRespond = true;
    }
  });

  it('uses the stream idle timeout after the first raw stream chunk', async () => {
    vi.useFakeTimers();
    mocks.state.autoRespond = false;
    const firstChunk = Buffer.from('data: one\n\n');
    const secondChunk = Buffer.from('data: two\n\n');

    try {
      const responsePromise = electronFetchRawStream('https://anyrouter.top/v1/messages', {
        method: 'POST',
        timeout: 1000,
        streamIdleTimeout: 5000,
        body: Buffer.from('{"stream":true}'),
        onResponse: () => true,
        onData: vi.fn(),
      });

      await Promise.resolve();
      const responseHandlers = mocks.startResponse();

      await vi.advanceTimersByTimeAsync(900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.data?.(firstChunk);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.data?.(secondChunk);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(4900);
      expect(mocks.state.lastRequest?.abort).not.toHaveBeenCalled();

      responseHandlers.end?.();

      await expect(responsePromise).resolves.toMatchObject({
        status: 200,
        body: Buffer.concat([firstChunk, secondChunk]),
      });
    } finally {
      vi.useRealTimers();
      mocks.state.autoRespond = true;
    }
  });
});
