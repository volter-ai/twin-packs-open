import type { HandlerContext } from '@volter/world-core';
import { appKey } from './shared.ts';
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  return Response.json({api_key:await appKey(ctx)},{status:201});
}
