// THE RELAY'S FRONT: a request to a tunnel (its host `<tunnelId>.voltertest.xyz`, or `?__tunnel=<id>` on a direct host,
// as the relay's worker routes one) is sent down the control socket of the client holding the tunnel and answered with
// what the client sends back (the kernel's request answered by a session); anything else is the relay's own.
import type { HandlerContext } from '@volter/world-core';
import { b64encode, cors, DOMAIN, holder, requests, RESERVED } from './shared.ts';

const text = (status: number, body: string): Response => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
// World transport metadata belongs to the World; preserve the application's own x-volter-* headers.
const INTERNAL = new Set(['x-volter-token', 'x-volter-pass', 'x-volter-read-only', 'x-volter-twin-original-host', 'x-volter-scenario-decision', 'x-volter-path-prefix-params', 'x-volter-lane']);

/** The tunnel a request is for: its host's label, or `?__tunnel=` on a direct host (the relay's local testing). */
function tunnelOf(request: Request): string | undefined {
  const url = new URL(request.url);
  const host = (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? url.host).toLowerCase().replace(/:\d+$/, '');
  const label = host.endsWith(`.${DOMAIN}`) ? host.slice(0, -DOMAIN.length - 1) : undefined;
  if (label && !label.includes('.') && !RESERVED.has(label)) return label;
  // source: spec:/x-reference/routing "host.endsWith('.workers.dev')"
  const direct = host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  return direct ? url.searchParams.get('__tunnel') ?? undefined : undefined;
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  const id = tunnelOf(request);
  if (!id) return next();
  // source: spec:/x-reference/auth "The relay answers preflight itself"
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
  const client = holder(ctx, id);
  // source: spec:/x-reference/relay "Tunnel not connected"
  if (!client) return text(502, 'Tunnel not connected');
  const url = new URL(request.url);
  // source: spec:/x-reference/auth "u.searchParams.delete('__volter_token');"
  url.searchParams.delete('__tunnel');
  url.searchParams.delete('__volter_token');
  const body = request.method === 'GET' || request.method === 'HEAD' ? null : new Uint8Array(await request.arrayBuffer());
  // source: spec:/x-reference/relay "bodyBytes.length > 750_000"
  if (body && body.length > 750_000) return text(413, 'Request body too large to tunnel (limit ~750KB)');
  const headers = Object.fromEntries([...request.headers].filter(([k]) => !INTERNAL.has(k.toLowerCase())));
  // The injector preserves the visitor's vendor Host in the same metadata used by kernel host routing.
  headers.host = request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? url.host;
  // source: spec:/x-reference/relay "Never trust a visitor-supplied"
  delete headers['x-forwarded-for'];
  headers['x-forwarded-for'] = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  // source: spec:/x-reference/auth "Strip the __volter_auth cookie"
  if (headers.cookie) {
    const cookie = headers.cookie.split(';').filter((pair) => pair.trim().split('=')[0] !== '__volter_auth').join(';').trim();
    if (cookie) headers.cookie = cookie; else delete headers.cookie;
  }
  // the relay's correlation key for this request on this client's socket: the socket's own count, not World state (a
  // request the relay forwards is no subject of the World)
  const reqId = `${id}-${(client.state.requests = Number(client.state.requests ?? 0) + 1)}`;
  // Register the wait before sending so a synchronous client can answer the frame.
  requests(client).set(reqId, request);
  const answered = client.expect(reqId, 30_000);
  // source: spec:/x-reference/protocol "An inbound HTTP request to forward to the local server."
  client.send({ type: 'request', reqId, method: request.method, path: `${url.pathname}${url.search}`, headers, body: body?.length ? b64encode(body) : null });
  try {
    return (await answered) as Response;
  } catch {
    // source: spec:/x-reference/relay "Tunnel disconnected"
    return !ctx.sockets('control').includes(client) ? text(502, String(client.state.disconnectReason ?? 'Tunnel disconnected')) : timeout();
  } finally { requests(client).delete(reqId); }
}

// source: spec:/x-reference/relay "Tunnel timeout"
function timeout(): Response {
  return text(504, 'Tunnel timeout');
}
