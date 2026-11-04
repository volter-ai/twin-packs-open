// A model repository's `info/`: git's advertisement (`info/refs?service=`) and git-lfs's batch API
// (`info/lfs/objects/batch`), over ./shared.ts.
import type { HandlerContext } from '@volter/world-core';
import { lfsBatch, smartHttp } from './shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const path = new URL(ctx.call.request.url).pathname;
  if (/\/info\/lfs\/objects\/batch$/.test(path)) return lfsBatch(ctx);
  return smartHttp(ctx, 'info/refs');
}
