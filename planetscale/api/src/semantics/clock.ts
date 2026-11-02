// The dashboard's and API's own moves as the World clock passes (docs/contributing/architecture.md, clock.ts): a new
// database is ready a minute after it was made; a backup starts 30 seconds after it was asked for and completes two
// minutes after, its size the branch's stored rows' bytes then. The timings are the twin's decisions (./states.ts).
import type { HandlerContext } from '@volter/world-core';
import { BACKUP, DATABASE } from './shared.ts';

const due = (ctx: HandlerContext, from: string, ms: number): number | undefined => {
  const at = Date.parse(from) + ms;
  return at <= Date.parse(ctx.occurredAt) ? at : undefined;
};

export async function clock(ctx: HandlerContext): Promise<void> {
  for (const d of ctx.rowsRaw(DATABASE).filter((x) => x.state === 'pending' && x.deleted !== true)) {
    const at = due(ctx, String(d.created_at), 60_000);
    if (at === undefined) continue;
    const then = await ctx.at(new Date(at).toISOString());
    then.legal('Database', 'state', 'database.ready', 'pending', 'ready', String(d.id), 'time');
    await then.write(DATABASE, String(d.id), { state: 'ready', ready: true, updated_at: then.occurredAt }, 'database.ready');
  }
  for (const b of ctx.rowsRaw(BACKUP).filter((x) => (x.state === 'pending' || x.state === 'running') && x.deleted !== true)) {
    const started = due(ctx, String(b.created_at), 30_000);
    if (started !== undefined && b.state === 'pending') {
      const then = await ctx.at(new Date(started).toISOString());
      then.legal('Backup', 'state', 'backup.start', 'pending', 'running', String(b.id), 'time');
      await then.write(BACKUP, String(b.id), { state: 'running', started_at: then.occurredAt, updated_at: then.occurredAt }, 'backup.start');
    }
    const done = due(ctx, String(b.created_at), 120_000);
    if (done === undefined) continue;
    const then = await ctx.at(new Date(done).toISOString());
    const size = then.rowsRaw('row').filter((r) => r.database === b._database && r.deleted !== true).reduce((n, r) => n + JSON.stringify(r.cells).length, 0);
    then.legal('Backup', 'state', 'backup.complete', 'running', 'success', String(b.id), 'time');
    await then.write(BACKUP, String(b.id), { state: 'success', size, uncompressed_size: size, completed_at: then.occurredAt, updated_at: then.occurredAt }, 'backup.complete');
  }
}
