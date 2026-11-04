import type { HandlerContext } from '@volter/world-core';
import { callerOf } from './shared.ts';

// source: spec:CurrentToken_show "Get information about the current macaroon token(s), including organizations, apps, user identity hashes, and machine restrictions"
export async function CurrentToken_show(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx);
  return c instanceof Response ? c : Response.json({ tokens: [{ org_slug: c.org, organization: c.org, apps: c.app ? [c.app] : [] }] });
}
