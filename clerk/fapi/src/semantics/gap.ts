// The Frontend API's answer for what it does not serve (docs/contributing/architecture.md, gap.ts): Clerk's own instance
// answered Go's plain `404 page not found` to a path it does not have, and 401 `signed_out` to one of its operations asked
// with no client (`/v1/organizations/org_nope`, `/v1/client/sign_ins/sia_nope`: ../../spec/recordings/
// 2026-09-28-clerk-clerk-com-signed-out.json), before it looked for what the path names.
import type { HandlerContext } from '@volter/world-core';
import { frontendGap } from './shared.ts';

export async function gap(ctx: HandlerContext, authenticatedFlow = false): Promise<Response> {
  return frontendGap(ctx, authenticatedFlow);
}
