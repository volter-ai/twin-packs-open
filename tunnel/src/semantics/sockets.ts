// The relay's control channel (the manifest's socket `control`, the kernel's sockets.ts): a client registers a tunnel id
// with its token and is told the tunnel's URL; then the relay sends it each public request (./../semantics/around.ts)
// and the client answers with a whole `response` or a stream (`response-start`, `response-chunk`s, `response-end`),
// which settle the request waiting on it by its `reqId`. Frames as volter-tunnel's protocol.ts defines them.
import type { HandlerContext, SocketEngine, SocketSession } from '@volter/world-core';
import { ACCOUNT, b64decode, bufferedBody, claimant, requests, responseHeaders, type Row, sha256, TUNNEL, tunnelUrl } from './shared.ts';

type Streams = Map<string, ReadableStreamDefaultController<Uint8Array>>;
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const streams = (s: SocketSession): Streams => (s.state.streams ??= new Map()) as Streams;
const headersOf = (v: unknown): Headers => { const h = new Headers(); for (const [k, x] of Object.entries(obj(v))) h.set(k, String(x)); return h; };

/** A rejected registration: the error frame, then the close (protocol.ts `ErrorMsg`; tunnel-do's rejection). */
function reject(s: SocketSession, message: string, code: number, reason: string): void {
  s.send({ type: 'error', message });
  s.close(code, reason);
}

async function register(s: SocketSession, msg: Row, ctx: HandlerContext): Promise<void> {
  const token = typeof msg.secret === 'string' ? msg.secret : '';
  const account = token ? ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.token_sha256 === sha256(ctx, token)) : undefined;
  // source: spec:/x-reference/relay "Invalid tunnel secret"
  if (!account) return reject(s, 'Invalid tunnel secret', 4003, 'Invalid tunnel secret');
  // the control URL's ?id= names the tunnel (the routing relay's authority), else the register frame's, else one minted
  // This id names a stored reservation: mint it, then record the reservation with its owner below. ctx.issue is for
  // issued ids whose subjects the vendor does not store; its empty row would look like another account's reservation.
  // source: spec:/x-reference/relay "Prefer the ?id= captured at accept (authoritative"
  const id = String(s.state.tunnelId || msg.tunnelId || ctx.mint(TUNNEL));
  const held = ctx.row(TUNNEL, id);
  // source: spec:/x-reference/relay "Tunnel ID reserved"
  if (held && held._owner !== account.id) return reject(s, `Tunnel ID '${id}' is reserved by another account.`, 4002, 'Tunnel ID reserved');
  const live = claimant(ctx, id);
  if (live && live !== s) {
    // source: spec:/x-reference/relay "Pass { replace: true } to take over."
    if (msg.replace !== true) return reject(s, `Tunnel ID '${id}' is already in use by another client. Pass { replace: true } to take over.`, 4002, 'Tunnel ID already in use');
    // source: spec:/x-reference/relay "Tunnel replaced"
    live.state.superseded = true;
    live.state.disconnectReason = 'Tunnel replaced';
    live.state.registered = false;
    // source: spec:/x-reference/relay "Replaced by new client"
    live.close(4001, 'Replaced by new client');
  }
  Object.assign(s.state, { registering: true, tunnelId: id });
  try { if (!held) await ctx.record(TUNNEL, { _owner: account.id, reservedAt: ctx.occurredAt }, id); }
  finally { s.state.registering = false; }
  if (s.state.superseded === true || !ctx.sockets('control').includes(s)) return;
  Object.assign(s.state, { registered: true, tunnelId: id });
  // source: spec:/x-reference/protocol "Acknowledges a successful registration; carries the public URL + usage."
  s.send({ type: 'registered', tunnelId: id, url: tunnelUrl(id) });
}

export const control: SocketEngine<HandlerContext> = {
  open(s, ctx) {
    s.state.tunnelId = new URL(ctx.call.request.url).searchParams.get('id') ?? '';
  },
  async message(s, data, ctx) {
    let msg: Row;
    try { msg = obj(JSON.parse(data)); } catch { return; }
    if (msg.type === 'register') return register(s, msg, ctx);
    if (s.state.registered !== true) return;
    const reqId = String(msg.reqId ?? '');
    const request = requests(s).get(reqId);
    // source: spec:/x-reference/protocol "A complete (buffered) response"
    if (msg.type === 'response') {
      if (!request) return;
      const headers = responseHeaders(headersOf(msg.headers), request);
      const body = bufferedBody(msg.body);
      // source: spec:/x-reference/relay "Malformed tunnel response"
      if (body === undefined) s.fulfil(reqId, new Response('Malformed tunnel response', { status: 502, headers }));
      else s.fulfil(reqId, new Response(request.method === 'HEAD' ? null : body, { status: Number(msg.status || 200), headers }));
    // source: spec:/x-reference/protocol "Start of a streamed response"
    } else if (msg.type === 'response-start') {
      if (!request) return;
      const status = Number(msg.status || 200);
      const headers = responseHeaders(headersOf(msg.headers), request);
      // source: spec:/x-reference/relay "HEAD is bodyless by contract too."
      if (request.method === 'HEAD' || status === 204 || status === 205 || status === 304) {
        s.fulfil(reqId, new Response(null, { status, headers }));
      } else {
        const body = new ReadableStream<Uint8Array>({ start: (c) => { streams(s).set(reqId, c); }, cancel: () => cancelStream(s, reqId) });
        armStreamIdle(s, reqId, ctx);
        s.fulfil(reqId, new Response(body, { status, headers }));
      }
    // source: spec:/x-reference/protocol "One streamed response body chunk."
    } else if (msg.type === 'response-chunk') {
      const stream = streams(s).get(reqId);
      if (stream) {
        try { stream.enqueue(b64decode(String(msg.data ?? ''))); s.fulfil(`idle:${reqId}`, null); armStreamIdle(s, reqId, ctx); }
        catch { streams(s).delete(reqId); s.fulfil(`idle:${reqId}`, null); }
      }
    // source: spec:/x-reference/protocol "End of a streamed response."
    } else if (msg.type === 'response-end') {
      const stream = streams(s).get(reqId);
      streams(s).delete(reqId);
      s.fulfil(`idle:${reqId}`, null);
      if (stream) { try { stream.close(); } catch { /* already closed */ } }
    }
  },
  close(s) {
    s.state.registered = false;
    for (const c of streams(s).values()) { try { c.error(new Error('Tunnel closed')); } catch { /* already ended */ } }
    streams(s).clear();
  },
};

// source: spec:/x-reference/relay "Idle watchdog for a streaming response"
function armStreamIdle(s: SocketSession, reqId: string, ctx: HandlerContext): void {
  // source: spec:/x-reference/relay "120000"
  void s.expect(`idle:${reqId}`, 120_000).catch(() => { if (ctx.sockets('control').includes(s)) expireStream(s, reqId); });
}

// source: spec:/x-reference/relay "stream idle timeout"
function expireStream(s: SocketSession, reqId: string): void {
  const stream = streams(s).get(reqId);
  if (!stream) return;
  streams(s).delete(reqId);
  try { stream.error(new Error('stream idle timeout')); } catch { /* already closed */ }
  s.send({ type: 'request-abort', reqId });
}

// source: spec:/x-reference/protocol "The relay asks the client to abort an in-flight request."
function cancelStream(s: SocketSession, reqId: string): void {
  streams(s).delete(reqId);
  s.fulfil(`idle:${reqId}`, null);
  s.send({ type: 'request-abort', reqId });
}
