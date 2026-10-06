// OpenAI's own work over time (docs/contributing/architecture.md, "Moves no API call makes": time), caught up to the
// World's clock before anything is answered, so every read finds the organization as it stands now: a file expiring,
// and an Assistants run moving on, each at the moment it fell due.
import type { HandlerContext } from '@volter/world-core';
import { expireFiles, expireRuns, inFlight, THREAD_RUN, workRun } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  await expireFiles(ctx);
  await expireRuns(ctx);
  // Extrapolation: cancellation may catch a newly queued run as its processing starts.
  // Its handler observes that first vendor move before the API guard, rather than completing
  // all of its placeholder work before the cancellation request is considered.
  const path = new URL(ctx.call.request.url).pathname;
  for (const r of ctx.rowsRaw(THREAD_RUN)) {
    if (r.status === 'queued' && path.endsWith(`/runs/${r.id}/cancel`)) continue;
    if (inFlight(THREAD_RUN, r)) await workRun(ctx, String(r.id));
  }
}
