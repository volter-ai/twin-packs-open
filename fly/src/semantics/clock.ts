// Fly's own move as the World clock passes (docs/contributing/architecture.md, clock.ts): a deleted volume, pending
// destroy, is removed. Where the documentation stops: the reference gives no delay; the twin removes it a day later.
import type { HandlerContext } from '@volter/world-core';
import { VOLUME, MACHINE, observeMachine } from './shared.ts';

const REMOVAL_MS = 24 * 60 * 60 * 1000;

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const m of ctx.rowsRaw(MACHINE).filter(m => m.state === 'started')) {
    // source: https://docs.fly.io/machines/machine-states/ "Exited, either on its own or explicitly stopped"
    await observeMachine(ctx, m);
  }
  for (const v of ctx.rowsRaw(VOLUME).filter((x) => x.state === 'pending_destroy' && typeof x._deleted_at === 'string')) {
    const due = Date.parse(String(v._deleted_at)) + REMOVAL_MS;
    // Observed vendor volumes have no local deletion timestamp; only locally scheduled removals advance here.
    if (!Number.isFinite(due) || due > now) continue;
    const then = await ctx.at(new Date(due).toISOString());
    const refused = then.legal(VOLUME, 'state', 'volume.removed', 'pending_destroy', 'destroyed', String(v.id), 'vendor');
    if (refused) throw new Error(refused.message);
    await then.write(VOLUME, String(v.id), { state: 'destroyed' }, 'volume.removed');
  }
}
