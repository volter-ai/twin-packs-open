// What the relay shares: accounts and their tokens (each by its SHA-256), the tunnel ids they hold, the relay's domain,
// and a tunnel's control session found among the World's open sockets.
import type { HandlerContext, SocketSession } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
export const ACCOUNT = '_account';
export const TUNNEL = '_tunnel';
// source: spec:/x-reference/domain "voltertest.xyz"
export const DOMAIN = 'voltertest.xyz';
/** Labels of the domain that are not tunnels: the relay's own front (`www`, its RESERVED_HOSTS default) and the twins
 *  cloud Volter serves there. */
export const RESERVED = new Set(['www', 'twins']);

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v);
export const tunnelUrl = (id: string): string => `https://${id}.${DOMAIN}`;



/** The registered control session holding a tunnel, if a client holds it now. */
export const holder = (ctx: Pick<HandlerContext, 'sockets'>, id: string): SocketSession | undefined =>
  ctx.sockets('control').find((s) => s.state.registered === true && s.state.tunnelId === id);

export const b64encode = (bytes: Uint8Array): string => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
export const b64decode = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// source: spec:/x-reference/auth "The relay answers preflight itself"
export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': request.headers.get('access-control-request-headers') || 'Content-Type, Authorization, X-Sandbox-Id',
    'access-control-allow-credentials': 'true',
  } : {};
}

/** Request metadata lasts only until the local client starts its reply, on that live connection. */
export function requests(s: SocketSession): Map<string, Request> {
  return (s.state.pendingRequests ??= new Map()) as Map<string, Request>;
}

// source: spec:/x-reference/auth "Build the downstream response headers: drop hop-by-hop + downstream CORS"
export function responseHeaders(downstream: Headers, request: Request): Headers {
  const headers = new Headers(downstream);
  for (const key of ['transfer-encoding', 'connection', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-allow-credentials', 'x-frame-options']) headers.delete(key);
  // source: spec:/x-reference/auth "strip CSP frame-ancestors / X-Frame-Options"
  for (const key of ['content-security-policy', 'content-security-policy-report-only']) {
    const value = headers.get(key);
    if (value) {
      const kept = value.split(';').filter((d) => !d.trim().startsWith('frame-ancestors')).join(';').trim();
      if (kept) headers.set(key, kept); else headers.delete(key);
    }
  }
  // source: spec:/x-reference/auth "only a downstream response that clearly says"
  const cache = (headers.get('cache-control') ?? '').toLowerCase();
  const publicCache = /(?:^|,)\s*public(?:\s|,|$)/.test(cache) && !/(?:^|,)\s*(?:private|no-store|no-cache)(?:\s|,|=|$)/.test(cache);
  const path = new URL(request.url).pathname;
  if (!publicCache || path === '/api' || path.startsWith('/api/')) {
    headers.set('cache-control', 'private, no-store, max-age=0');
    headers.set('cloudflare-cdn-cache-control', 'no-store');
    headers.set('cdn-cache-control', 'no-store');
    const vary = new Set((headers.get('vary') ?? '').split(',').map((v) => v.trim()).filter(Boolean));
    vary.add('Cookie'); vary.add('Authorization'); headers.set('vary', [...vary].join(', '));
  }
  for (const [key, value] of Object.entries(cors(request))) headers.set(key, value);
  return headers;
}

// source: spec:/x-reference/relay "Malformed tunnel response"
export function bufferedBody(text: unknown): Uint8Array<ArrayBuffer> | null | undefined {
  try { return text ? b64decode(String(text)) : null; } catch { return undefined; }
}

/** A provisional connection claim prevents two initial registrants passing the live-session decision. */
export function claimant(ctx: Pick<HandlerContext, 'sockets'>, id: string): SocketSession | undefined {
  return ctx.sockets('control').find((s) => s.state.superseded !== true && (s.state.registered === true || s.state.registering === true) && s.state.tunnelId === id);
}
