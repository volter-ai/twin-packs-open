// SLACK'S PREFERENCES — slack.com/account/notifications, where a person sets the hours they take notifications in;
// outside them Slack pauses notifications ("Set a notification schedule … Slack will automatically pause notifications
// outside the hours you set", https://slack.com/help/articles/214908388-Pause-notifications-with-Do-Not-Disturb). A
// workspace page (docs/contributing/architecture.md, "Screens") for the person signed in; dnd.info reads the schedule
// (../semantics/dnd.ts).
//
// Where the documentation stops and the twin decides: the schedule is every day's same hours, on the person's clock.
import type { HandlerContext } from '@volter/world-core';
import { field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const form = (s: Row | undefined, notice?: string): Response => page('Notifications', (
  <>
    <h1>Notifications</h1>
    {notice ? <p className="sk-notice" role="status">{notice}</p> : null}
    <form className="sk-card" method="post" action="/account/notifications">
      <label htmlFor="days">Notification schedule</label>
      <select id="days" name="days"><option value="every_day">Every day</option></select>
      <label htmlFor="start">From</label>
      <input id="start" name="start" type="time" defaultValue={String(s?.start ?? '09:00')} />
      <label htmlFor="end">To</label>
      <input id="end" name="end" type="time" defaultValue={String(s?.end ?? '18:00')} />
      <div className="sk-actions"><button type="submit">Save</button></div>
    </form>
  </>
));

export async function screen(ctx: HandlerContext): Promise<Response> {
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first');
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (path !== '/account/notifications') return refused(404, 'Page not found');
  if (ctx.call.request.method === 'GET') return form(who.row._dnd_schedule as Row | undefined);
  const days = field(ctx, 'days') || 'every_day';
  const start = field(ctx, 'start');
  const end = field(ctx, 'end');
  if (days !== 'every_day' || !HHMM.test(start) || !HHMM.test(end) || start === end) return refused(400, 'Choose the hours you take notifications in');
  const schedule = { days, start, end };
  await ctx.write('user', who.id, { _dnd_schedule: schedule }, 'user.notifications');
  return form(schedule, `Notifications every day from ${start} to ${end}`);
}
