// What X does around every request to its API (docs/contributing/architecture.md, around.ts). On the /2 resource
// surface: a body that is not a JSON object is X's invalid request (a multipart upload passes to its handler); an armed
// 15-minute-window refusal is answered (the World's door); the caller is resolved from its credential — an OAuth 2.0
// access token or an OAuth 1.0a signature, both issued by X's own authorization server, this pack — and named to the
// handler in a header only this front sets; and a refusal the kernel answers is typed as X's problem. On the OAuth legs:
// a body labelled JSON that does not parse is read as the text it is, since each leg reads its own body and answers an
// unreadable one in its own family (a token leg's `invalid_request`, an OAuth 1.0a leg's code 215). Everywhere, a
// failure no handler answered is answered in the family of the endpoint that failed.
import type { HandlerContext } from '@volter/world-core';
import { CALLER_HEADER, callerOf, internalServerProblem, invalidRequestProblem, isAnswer, oauthError, ofType, rateLimitExceeded, send, tree, type XResponse } from './shared.ts';

/** The OAuth 2.0 legs under /2 (the authorization server's, answered in the OAuth body), and the one /2 path the spec
 *  declares no `security` for. */
const NOT_THE_RESOURCE_SURFACE = new Set(['/2/oauth2/token', '/2/openapi.json']);
/** The upload path a multipart body may be sent to (spec:appendMediaUpload). */
const MULTIPART_UPLOAD_PATH = /^\/2\/media\/upload\/\d{1,19}\/append\/?$/;

/** A request's body read once, and the request made again from its bytes: a served request's body read through a
 *  clone and then forwarded tees a stream whose second branch a Bun server never finishes, and the request hung (the
 *  kernel's own scenario path reads its body so, pack-fetch.ts `decided`). */
async function readOnce(request: Request): Promise<{ text: string; again: (headers?: Headers) => Request }> {
  const bytes = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer());
  const text = bytes ? new TextDecoder().decode(bytes) : '';
  return { text, again: (headers = request.headers) => new Request(request.url, { method: request.method, headers, ...(bytes ? { body: bytes } : {}) }) };
}

/** A body labelled JSON that does not parse, as the text it is. */
function parseableBody(request: Request, read: { text: string; again: (headers?: Headers) => Request }): Request {
  if (request.method === 'GET' || request.method === 'HEAD' || !(request.headers.get('content-type') ?? '').toLowerCase().includes('json')) return read.again();
  if (read.text.trim() === '') return read.again();
  try { JSON.parse(read.text); return read.again(); } catch { return asText(request, read.text); }
}

/** A body labelled JSON that is not: the request again, labelled as the text it is. */
function asText(request: Request, text: string): Request {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'text/plain; charset=utf-8');
  return new Request(request.url, { method: request.method, headers, body: text });
}

/** A /2 body that is not a JSON object, refused as X refuses it; a multipart upload passes to its handler. */
function bodyRefusal(request: Request, text: string): XResponse | undefined {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const type = request.headers.get('content-type') ?? '';
  if (request.method === 'POST' && MULTIPART_UPLOAD_PATH.test(new URL(request.url).pathname) && /^multipart\/form-data/i.test(type)) return undefined;
  if (text.trim() === '') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidRequestProblem({ body: ['(unparseable)'] }, 'The request body could not be parsed as a JSON object.');
  return undefined;
}

/** An armed 15-minute-window refusal (the World's door): 429 with legacy code 88, as X's rate-limit page documents. */
// source: https://docs.x.com/x-api/fundamentals/rate-limits "Exceeding limits results in a 429 error until the window resets."
function armedRateRefusal(ctx: HandlerContext): XResponse | undefined {
  const armed = ofType(tree(ctx), 'rate_limit').find((r) => String(r.id) === 'armed');
  if (!armed || armed.armed !== true) return undefined;
  const limit = typeof armed.limit === 'number' ? armed.limit : 200;
  const reset = typeof armed.reset === 'number' ? armed.reset : 900;
  return rateLimitExceeded({ 'x-rate-limit-limit': String(limit), 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(reset) });
}

/** A refusal the kernel answers around a handler (a write to a read-only World) in X's `about:blank` problem form, with
 *  the media type and caching X's problems carry. */
async function problemTyped(res: Response): Promise<Response> {
  if (res.status < 400 || !(res.headers.get('content-type') ?? '').startsWith('application/json')) return res;
  const text = await res.text();
  let type: unknown;
  try { type = (JSON.parse(text) as { type?: unknown }).type; } catch { type = undefined; }
  const headers = new Headers(res.headers);
  if (type === 'about:blank') { headers.set('content-type', 'application/problem+json'); headers.set('cache-control', 'no-cache, no-store, max-age=0'); }
  return new Response(text, { status: res.status, headers });
}

/** A failure no handler answered: a TypeError or URIError is the caller's malformed request (the flat OAuth 400: the only
 *  decode that raises them is the token and revoke endpoints' Basic credential); anything else is a 500, X's problem on
 *  the /2 resource surface and the OAuth body elsewhere. */
function answerOfFailure(error: unknown, path: string): XResponse {
  if (error instanceof TypeError || error instanceof URIError) return oauthError('invalid_request', 'Request contains an invalid argument.', 400);
  if (path.startsWith('/2/') && !NOT_THE_RESOURCE_SURFACE.has(path)) return internalServerProblem();
  return oauthError('server_error', 'The authorization server could not complete the request.', 500);
}



export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '') || '/';
  return aroundRequest(ctx, next, path).catch((error: unknown) => send(answerOfFailure(error, path)));
}

/** The request through the front: its body read once, a /2 body refused or its caller named, then the handler. */
async function aroundRequest(ctx: HandlerContext, next: (request?: Request) => Promise<Response>, path: string): Promise<Response> {
  const read = await readOnce(ctx.call.request);
  if (!path.startsWith('/2/') || NOT_THE_RESOURCE_SURFACE.has(path)) return await next(parseableBody(ctx.call.request, read));
  // only this front names a caller
  const headers = new Headers(ctx.call.request.headers);
  headers.delete(CALLER_HEADER);
  const refused = bodyRefusal(ctx.call.request, read.text) ?? armedRateRefusal(ctx);
  if (refused) return send(refused);
  const caller = callerOf(ctx);
  if (isAnswer(caller)) return send(caller);
  headers.set(CALLER_HEADER, JSON.stringify(caller));
  return await problemTyped(await next(read.again(headers)));
}
