// PostHog's own moves as time passes (docs/contributing/architecture.md, "What an author writes": clock): the work the
// World clock makes due, done when the clock's mover asks the twin (`POST /twin/due`, ADR 0036 §4), never by a request.
import type { HandlerContext } from '@volter/world-core';
import { deleteDueEvents, PROJECT } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  // a person deleted with their events: the events go at the queued deletion's run, the next Sunday 05:00 UTC
  for (const project of ctx.rowsRaw(PROJECT).filter((p) => p.deleted !== true)) await deleteDueEvents(ctx, project);
}
