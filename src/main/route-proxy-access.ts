import { isIPv4 } from 'net';
import { networkInterfaces } from 'os';

function ipv4Number(address: string): number | null {
  if (!isIPv4(address)) return null;
  return address.split('.').reduce((value, octet) => (value << 8) | Number(octet), 0) >>> 0;
}

function isPrivateIpv4(address: string): boolean {
  const [first, second] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function isAllowedRouteProxyClient(
  remoteAddress: string | undefined,
  host: string
): boolean {
  const address = (remoteAddress || '').replace(/^::ffff:/i, '');
  if (address === '::1') return true;
  const remote = ipv4Number(address);
  if (remote === null) return false;
  if (address.startsWith('127.')) return true;
  if (host !== '0.0.0.0' || !isPrivateIpv4(address)) return false;

  try {
    return Object.values(networkInterfaces()).some(entries =>
      entries?.some(entry => {
        if (entry.internal || entry.family !== 'IPv4' || !isPrivateIpv4(entry.address))
          return false;
        const local = ipv4Number(entry.address);
        const mask = ipv4Number(entry.netmask);
        if (local === null || mask === null || mask === 0) return false;
        const inverse = ~mask >>> 0;
        if ((inverse & (inverse + 1)) !== 0) return false;
        return (remote & mask) === (local & mask);
      })
    );
  } catch {
    return false;
  }
}
