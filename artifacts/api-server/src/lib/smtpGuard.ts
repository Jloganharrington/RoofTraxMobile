import { lookup } from 'node:dns/promises';
import net from 'node:net';

// SSRF guard for user-supplied SMTP hosts. A malicious user could otherwise
// point their "SMTP server" at internal services (metadata endpoints, the DB,
// localhost admin ports) and use the API server as a port scanner / blind
// SSRF proxy. We resolve the hostname ourselves, reject any private /
// loopback / link-local / reserved address, and hand nodemailer the vetted
// IP directly (with servername for TLS) so a DNS-rebinding flip between our
// check and the connection cannot bypass the guard.

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d) — defer to the IPv4 rules.
  const v4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4?.[1]) return isPrivateIPv4(v4[1]);
  return false;
}

export function isPublicIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return !isPrivateIPv4(ip);
  if (kind === 6) return !isPrivateIPv6(ip);
  return false;
}

/**
 * Resolves an SMTP hostname and returns a vetted public IP to connect to.
 * Throws if the host is (or resolves to) a private/reserved address.
 */
export async function resolvePublicSmtpAddress(host: string): Promise<string> {
  // IP literal: vet it directly.
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new Error('SMTP host resolves to a private address');
    return host;
  }
  const results = await lookup(host, { all: true, verbatim: true });
  if (results.length === 0) throw new Error('SMTP host did not resolve');
  // Every record must be public — a single private record means the name is
  // hostile or misconfigured either way.
  for (const { address } of results) {
    if (!isPublicIp(address)) throw new Error('SMTP host resolves to a private address');
  }
  const first = results[0];
  if (!first) throw new Error('SMTP host did not resolve');
  return first.address;
}
