import type { HandlerContext } from '@volter/world-core';
import { fail, identity, settings } from './shared.ts';
// source: recording:worker-source.txt "Managed-service admission is unavailable."
export async function inferenceGrant(ctx: HandlerContext): Promise<Response> {
  const userId = await identity(ctx); if (userId instanceof Response) return userId;
  // source: recording:deployment-source.txt "binding = \"VGAI_BILLING\""
  // Ledger admission and gateway-decodable grants are unmodeled; a bound production ledger answers the pack gap.
  if (settings(ctx).billingBound) return fail(404, 'Not found');
  return fail(503, 'Managed-service admission is unavailable.');
}
