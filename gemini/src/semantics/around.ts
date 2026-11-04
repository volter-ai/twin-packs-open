// What the Gemini API does around every request (architecture, around.ts): a request carries an API key the World
// issued (`x-goog-api-key`, or the `key` query parameter). Where the documentation stops: the refusals' wording is the
// API's as its clients report it (a missing key's PERMISSION_DENIED, an unknown key's API_KEY_INVALID).
import type { HandlerContext } from '@volter/world-core';
import { googleError, keyOf } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (!new URL(ctx.call.request.url).pathname.startsWith('/v1')) return next();
  const key = keyOf(ctx);
  if (!key.given) return googleError(403, 'PERMISSION_DENIED', 'Method doesn\'t allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.');
  if (!key.row) return googleError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', domain: 'googleapis.com', metadata: { service: 'generativelanguage.googleapis.com' } }]);
  return next();
}
