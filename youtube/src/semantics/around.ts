// What YouTube does around every request to its API (architecture, around.ts): a request is made with an OAuth 2.0
// access token Google issued (the googleoauth twin, read across packs), or, on the list methods that read public data,
// with a Google Cloud project's API key (issued by the same Google side, read across packs too). YouTube refuses a
// request with neither, a token Google does not hold or one that has expired, a key Google did not issue, a key on a
// method that takes none, and a token whose scopes reach none the method names, before the method runs. A method that
// needs the person (their channel, `mine`) asks for the token itself (./shared.ts callerOf). A path the API does not
// have passes to the gap.
import type { HandlerContext } from '@volter/world-core';
import { apiKeyOf, callerOf, heldApiKey, refuse, scoped, takesApiKey, tokenOf } from './shared.ts';

// source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/transition "This request requires authorization with at least one of the following scopes."
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (ctx.call.operation.id === 'unmatched') return next();
  const key = tokenOf(ctx) ? undefined : apiKeyOf(ctx);
  if (key !== undefined) {
    // source: https://developers.google.com/youtube/v3/docs/core_errors "The API key provided in the request is invalid, which means the API server is unable to check the quota limit for the application making the request."
    if (!heldApiKey(ctx, key)) return refuse(ctx, 400, 'global', 'keyInvalid', 'The API key provided in the request is invalid, which means the API server is unable to check the quota limit for the application making the request. Use the Google Developers Console to find your API key or to obtain one.');
    // a key on a method that inserts, updates or deletes, or reads only what is the person's: it needs the person's token
    // source: https://developers.google.com/youtube/v3/getting-started "Operations that insert, update, or delete resources always require user authorization ."
    if (takesApiKey(ctx)) return next();
  }
  // a request with neither a token nor a key: the core API error the errors page names first
  // source: https://developers.google.com/youtube/v3/docs/errors "Access forbidden. The request may not be properly authorized."
  if (!tokenOf(ctx) && key === undefined) return refuse(ctx, 403, 'global', 'forbidden', 'Access forbidden. The request may not be properly authorized.');
  const caller = callerOf(ctx);
  if (caller instanceof Response) return caller;
  const refused = scoped(ctx, caller);
  if (refused) return refused;
  return next();
}
