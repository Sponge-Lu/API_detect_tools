import * as os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAllowedRouteProxyClient } from '../main/route-proxy-access';
import { buildRouteProxyBaseUrl } from '../main/route-target-lock';

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  const mocked = { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) };
  return { ...mocked, default: mocked };
});

const lanInterface = {
  address: '192.168.10.5',
  netmask: '255.255.255.0',
  family: 'IPv4' as const,
  internal: false,
  mac: '00:11:22:33:44:55',
  cidr: '192.168.10.5/24',
};

beforeEach(() => {
  vi.mocked(os.networkInterfaces).mockReturnValue({ Ethernet: [lanInterface] });
});

afterEach(() => vi.restoreAllMocks());

describe('route proxy LAN access policy', () => {
  it.each(['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])(
    'keeps loopback client %s available in both modes',
    address => {
      expect(isAllowedRouteProxyClient(address, '127.0.0.1')).toBe(true);
      expect(isAllowedRouteProxyClient(address, '0.0.0.0')).toBe(true);
    }
  );

  it.each(['192.168.10.20', '::ffff:192.168.10.20'])(
    'requires LAN mode for a directly connected private client %s',
    address => {
      expect(isAllowedRouteProxyClient(address, '127.0.0.1')).toBe(false);
      expect(isAllowedRouteProxyClient(address, '0.0.0.0')).toBe(true);
    }
  );

  it.each([
    '192.168.11.20',
    '10.0.0.2',
    '172.16.0.2',
    '8.8.8.8',
    '100.64.0.1',
    '169.254.1.2',
    '0.0.0.0',
    '255.255.255.255',
    '2001:db8::1',
    'fd00::1',
    '::ffff:8.8.8.8',
    '127.invalid',
    '192.168.10.020',
    '',
    undefined,
  ])('rejects public, unrelated, IPv6, or invalid peer %s', address => {
    expect(isAllowedRouteProxyClient(address, '0.0.0.0')).toBe(false);
  });

  it.each([
    ['10.20.30.1', '255.255.0.0', '10.20.40.2', '10.21.40.2'],
    ['172.20.1.1', '255.255.255.0', '172.20.1.20', '172.20.2.20'],
  ])('uses the actual netmask of interface %s', (address, netmask, allowed, denied) => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      Ethernet: [{ ...lanInterface, address, netmask }],
    });
    expect(isAllowedRouteProxyClient(allowed, '0.0.0.0')).toBe(true);
    expect(isAllowedRouteProxyClient(denied, '0.0.0.0')).toBe(false);
  });

  it.each(['0.0.0.0', '255.0.255.0', 'invalid'])('fails closed for invalid netmask %s', netmask => {
    vi.mocked(os.networkInterfaces).mockReturnValue({ Ethernet: [{ ...lanInterface, netmask }] });
    expect(isAllowedRouteProxyClient('192.168.10.20', '0.0.0.0')).toBe(false);
  });

  it('does not trust public or internal interfaces and refreshes interface data', () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      Ethernet: [{ ...lanInterface, address: '8.8.8.1' }],
    });
    expect(isAllowedRouteProxyClient('8.8.8.2', '0.0.0.0')).toBe(false);
    vi.mocked(os.networkInterfaces).mockReturnValue({
      Ethernet: [{ ...lanInterface, internal: true }],
    });
    expect(isAllowedRouteProxyClient('192.168.10.20', '0.0.0.0')).toBe(false);
    vi.mocked(os.networkInterfaces).mockReturnValue({});
    expect(isAllowedRouteProxyClient('192.168.10.20', '0.0.0.0')).toBe(false);
    vi.mocked(os.networkInterfaces).mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(isAllowedRouteProxyClient('192.168.10.20', '0.0.0.0')).toBe(false);
  });

  it('keeps generated local client URLs on loopback when LAN mode is enabled', () => {
    expect(buildRouteProxyBaseUrl({ host: '0.0.0.0', port: 3210 })).toBe('http://127.0.0.1:3210');
  });
});
