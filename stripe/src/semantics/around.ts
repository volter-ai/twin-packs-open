// What Stripe does around every API request (docs/contributing/architecture.md, "What an author writes": around): a
// request's key is one Stripe issued (the platform's, or a connected account's OAuth key); an OAuth key acts as its
// connected account; a publishable key is held to the client-side calls, a revoked account is
// refused and the parameters are checked against the operation's; a metadata hash merges; and every answer is rendered
// in the caller's API version (../engine/front.ts).
import type { HandlerContext } from '@volter/world-core';
import { platformKeyRefused, publishableKeyRefused, refuseParameters, rendered, withMetadata } from './shared.ts';
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const arrived = ctx.call.request;
  const unkeyed = platformKeyRefused(ctx, arrived);
  if (unkeyed) return unkeyed;
  if (ctx.call.operation.id !== 'unmatched') {
    const refused = publishableKeyRefused(ctx) ?? refuseParameters(ctx);
    if (refused) return refused;
  }
  return rendered(arrived, await next(withMetadata(ctx, arrived.clone())));
}
