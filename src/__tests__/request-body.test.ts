// @vitest-environment node
import * as http from 'node:http';
import { describe, it, expect } from 'vitest';
import { readRequestBody } from '../main/utils/request-body';
import { normalizeRouteBodyLimit } from '../shared/types/route-proxy';

describe('bounded request bodies', () => {
  it.each([undefined, NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER])(
    'normalizes %s',
    value => {
      expect(normalizeRouteBodyLimit(value)).toBe(64 * 1024 * 1024);
    }
  );
  it.each([
    ['abc', 200],
    ['abcd', 200],
    ['abcde', 413],
  ] as const)('handles chunked payload %s with status %s', async (payload, expected) => {
    let forwarded = 0;
    const server = http.createServer((req, res) => {
      void readRequestBody(req, 4, () => new Error('cancelled')).then(
        body => {
          forwarded++;
          res.end(body);
        },
        () => {
          res.writeHead(413, { Connection: 'close' });
          res.end('too large');
        }
      );
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as import('node:net').AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            method: 'POST',
            headers: { 'Transfer-Encoding': 'chunked' },
          },
          res => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          }
        );
        req.on('error', reject);
        req.write(payload.slice(0, 2));
        req.end(payload.slice(2));
      });
      expect(status).toBe(expected);
      expect(forwarded).toBe(expected === 200 ? 1 : 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
    }
  });
});
