// Slack's dnd.* methods (https://docs.slack.dev/reference/methods?family=dnd): a person's Do Not Disturb, their schedule
// (the hours they take notifications, set in Preferences: ../screens/account.tsx) and their snooze.
import type { HandlerContext } from '@volter/world-core';
import { arg, fail, now, ok, who } from './shared.ts';

type Row = Record<string, unknown>;
const DAY = 86400;
const minutes = (hhmm: unknown): number => { const [h, m] = String(hhmm).split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** A person's scheduled Do Not Disturb: the hours outside those they take notifications in, on their own clock
 *  (`tz_offset`). The window named is the one in force, else the next. */
// source: https://docs.slack.dev/reference/methods/dnd.info "next_dnd_start_ts"
function scheduleOf(u: Row, at: number): Row {
  const s = u._dnd_schedule as Row | undefined;
  if (!s) return { dnd_enabled: false, next_dnd_start_ts: 1, next_dnd_end_ts: 1 };
  const offset = Number(u.tz_offset ?? 0);
  const from = minutes(s.end) * 60;
  const length = (((minutes(s.start) - minutes(s.end)) % 1440 + 1440) % 1440 || 1440) * 60;
  const day = Math.floor((at + offset) / DAY) * DAY - offset;
  // from yesterday's window on, the first not yet over (a day's window ends within a day, so one is found by tomorrow's)
  let start = day - DAY + from;
  while (start + length <= at) start += DAY;
  return { dnd_enabled: true, next_dnd_start_ts: start, next_dnd_end_ts: start + length };
}

/** dnd.setSnooze: "Turns on Do Not Disturb mode for the current user, or changes its duration" for `num_minutes`. */
export async function dnd_setSnooze(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const n = Number(arg(ctx, 'num_minutes'));
  if (!Number.isFinite(n) || n <= 0) return fail(ctx, 'invalid_arguments');
  const end = now(ctx) + Math.round(n * 60);
  await ctx.write('user', by.user, { _snooze: { end } }, 'user.snooze');
  return ok(ctx, { snooze_enabled: true, snooze_endtime: end, snooze_remaining: end - now(ctx), snooze_is_indefinite: false });
}

/** dnd.endSnooze: "Ends the current user's snooze mode immediately"; "snooze_not_active" when none is on. Her
 *  schedule stands: ending a scheduled session is dnd.endDnd's (unmodeled). */
// source: spec:/paths/~1dnd.endSnooze/post/responses/200/schema/properties "next_dnd_start_ts"
export async function dnd_endSnooze(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const u = ctx.row('user', by.user)!;
  const at = now(ctx);
  if (Number((u._snooze as Row | undefined)?.end ?? 0) <= at) return fail(ctx, 'snooze_not_active');
  await ctx.write('user', by.user, { _snooze: { end: 0 } }, 'user.snooze');
  return ok(ctx, { ...scheduleOf(u, at), snooze_enabled: false });
}
