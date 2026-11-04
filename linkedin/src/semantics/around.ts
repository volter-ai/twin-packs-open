// What LinkedIn does around every request to its API (docs/contributing/architecture.md, around.ts): on its versioned
// REST surface (/rest) the Linkedin-Version header is checked first; on /rest and on /v2 the bearer token is resolved
// to its member, and the application's daily limit for the resource is counted. The upload URLs on www.linkedin.com
// carry their own authorization and pass to their handlers.
import type { HandlerContext } from '@volter/world-core';
import { callerOf, limitedResource, spend, versionRefusal } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname;
  if (!/^\/(rest|v2)\//.test(path)) return next();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "All APIs require the request header Linkedin-Version: {Version in YYYYMM format}."
  if (path.startsWith('/rest/')) {
    const refused = versionRefusal(ctx);
    if (refused) return refused;
  }
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const limited = await spend(ctx, who, limitedResource(path));
  if (limited) return limited;
  return next();
}
