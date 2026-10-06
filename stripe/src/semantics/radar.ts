// Stripe's radar operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { VL, VLI } from '../engine/radar.ts';
import { created, fail, listMissing, radarSyncItems } from './shared.ts';
export async function PostRadarValueListItems(ctx: HandlerContext): Promise<Response> {
  const listId = typeof ctx.params.value_list === 'string' ? ctx.params.value_list : '';
  if (!listId) return fail(ctx, 'Missing required param: value_list.', 400, 'parameter_missing');
  if (!ctx.row(VL, listId, { withDeleted: true })) return listMissing(ctx, listId, 400);
  if (ctx.params.value === undefined || ctx.params.value === '') return fail(ctx, 'Missing required param: value.', 400, 'parameter_missing');
  const item = await created(ctx, VLI, { value_list: listId, value: ctx.params.value }, { livemode: false, created_by: 'twin' });
  await radarSyncItems(ctx, listId);
  return ctx.reply(item);
}
