// Slack's own moves as time passes (docs/contributing/architecture.md, "What an author writes": clock): a scheduled
// message is sent at its `post_at`, as its poster, into its channel (chat.scheduleMessage).
import type { HandlerContext } from '@volter/world-core';
import { now, post } from './shared.ts';

type Row = Record<string, unknown>;

export async function clock(ctx: HandlerContext): Promise<void> {
  const due = ctx.rowsRaw('scheduled_message').filter((s) => s._sent !== true && Number(s.post_at) <= now(ctx)).sort((a, b) => Number(a.post_at) - Number(b.post_at));
  for (const s of due) {
    const at = await ctx.at(new Date(Number(s.post_at) * 1000).toISOString());
    const c = at.row('channel', String(s.channel_id));
    const by = s._by as Row;
    // a channel archived or a poster gone since: Slack does not send it (the twin's decision: it is dropped, sent never)
    if (c && c.is_archived !== true) {
      await post(at, c, { kind: 'bot', token: '', user: String(by.user), team: String(c.team_id), scopes: [], ...(by.bot ? { bot: String(by.bot), app: String(by.app) } : {}) }, {
        ...(s._content as Row), ...(s.thread_ts ? { thread_ts: s.thread_ts } : {}),
      });
    }
    await at.write('scheduled_message', String(s.id), { _sent: true }, 'scheduled_message.send');
  }
}
