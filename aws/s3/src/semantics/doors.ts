// The World's doors on S3 (docs/contributing/architecture.md, "Doors, screens and the gap"): the application's access
// key, as the runtime issues it (the descriptor's credentialDoor), answered on the default lane from what the vendor's
// lanes share (../../../src/semantics/shared.ts).
import type { HandlerContext } from '@volter/world-core';
import { issueAppCredentials } from './shared.ts';

/** POST /_twin/app-credentials: the access key the World's application holds, the same at every boot. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  return issueAppCredentials(ctx);
}
