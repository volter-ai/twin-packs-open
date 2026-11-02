// A SigV4 credential selects its AWS account before any lane reads or writes vendor state.
// The lane still verifies the complete signature and credential status in its normal front.
import { isWorldAccountName, type HandlerContext } from '@volter/world-core';
import { ACCESS_KEY, accessKeyId } from './shared.ts';

export function tenant(ctx: HandlerContext): string {
  if (new URL(ctx.call.request.url).pathname.startsWith('/_twin/')) {
    const body = ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Record<string, unknown> : {};
    const selected = body.account ?? 'default';
    return isWorldAccountName(selected) ? selected : '__unselected__';
  }
  const key = ctx.rowsRaw(ACCESS_KEY, { withDeleted: true }).find(k => k.id === accessKeyId(ctx.call.request));
  return key ? String(key._world_account ?? 'default') : '__unselected__';
}
