// What Twitch does around every request to the Twitch API (docs/contributing/architecture.md, around.ts): a request is
// made with an access token id.twitch.tv issued and the client id of the application it was issued to, and Helix
// refuses one without them before any endpoint runs. The caller is resolved here, from the two headers, and named to
// the handler in a header only this front sets (./shared.ts CALLER_HEADER). A path the API does not have passes to the
// gap.
import type { HandlerContext } from '@volter/world-core';
import { CALLER_HEADER, heldAccessToken, twitchError, type Caller } from './shared.ts';

/** A request's body read once, and the request made again from its bytes with new headers: a request read through a
 *  clone and then forwarded tees a stream a Bun server never finishes. */
async function readOnce(request: Request): Promise<(headers: Headers) => Request> {
  const bytes = request.method === 'GET' || request.method === 'HEAD' ? undefined : new Uint8Array(await request.arrayBuffer());
  return (headers) => new Request(request.url, { method: request.method, headers, ...(bytes ? { body: bytes } : {}) });
}

/** Who the request's credentials name, or Twitch's 401 in Get Users' words. */
function resolve(ctx: HandlerContext): Caller | Response {
  const authorization = ctx.call.request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  // source: spec:/paths/~1users/get/responses/401/description "The Authorization header is required and must contain an app access token or user access token."
  if (!bearer) return twitchError(401, 'The Authorization header is required and must contain an app access token or user access token.');
  const held = heldAccessToken(ctx, bearer);
  // source: spec:/paths/~1users/get/responses/401/description "The access token is not valid."
  if (!held) return twitchError(401, 'The access token is not valid.');
  // source: spec:/paths/~1users/get/responses/401/description "The ID specified in the Client-Id header does not match the client ID specified in the access token."
  if ((ctx.call.request.headers.get('client-id') ?? '') !== held.client_id) return twitchError(401, 'The ID specified in the Client-Id header does not match the client ID specified in the access token.');
  return { kind: held.user_id ? 'user' : 'app', clientId: String(held.client_id), ...(held.user_id ? { userId: String(held.user_id) } : {}), scopes: (held.scopes as string[] | undefined) ?? [] };
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const again = await readOnce(ctx.call.request);
  const headers = new Headers(ctx.call.request.headers);
  // only this front names a caller
  headers.delete(CALLER_HEADER);
  if (ctx.call.operation.id === 'unmatched') return next(again(headers));
  const caller = resolve(ctx);
  if (caller instanceof Response) return caller;
  headers.set(CALLER_HEADER, JSON.stringify(caller));
  return next(again(headers));
}
