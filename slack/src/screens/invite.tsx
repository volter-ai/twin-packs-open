// SLACK'S INVITE PEOPLE — slack.com/invite (a hosted flow, docs/contributing/architecture.md, "Screens"). An owner or
// admin's invitation goes out at once, by email with a Join Now link; a member's goes to the admins as a request, with
// its reason ("If your workspace requires admin approval for invitations, … your request will be sent to the Workspace
// Admins", https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace). A guest is invited to one
// channel ("Single-channel guests: can only access one channel", https://slack.com/help/articles/202518103).
//
// Where the documentation stops and the twin decides: the invitation's email is the twin's words, its link
// https://slack.com/join/invite/<invitation id> (../screens/join.tsx); a request's id is `Ir<n>`.
import type { HandlerContext } from '@volter/world-core';
import { administers, field, page, refused, visitor } from './shared.tsx';
import { invite } from '../semantics/shared.ts';

const form = (ctx: HandlerContext, asAdmin: boolean): Response => page('Invite people', (
  <>
    <h1>Invite people to your workspace</h1>
    {asAdmin ? null : <p className="sk-lead">Your invitation will be sent to an admin for approval.</p>}
    <form className="sk-card" method="post" action={`${ctx.publicBase}/invite`}>
      <label htmlFor="email">To:</label>
      <input id="email" name="email" type="email" required placeholder="name@example.com" />
      {asAdmin ? (
        <>
          <label htmlFor="invite_type">Invite as</label>
          <select id="invite_type" name="invite_type"><option value="member">Member</option><option value="single_channel_guest">Single-channel guest</option></select>
          <label htmlFor="channel">Channel (for a guest)</label>
          <input id="channel" name="channel" />
        </>
      ) : (
        <>
          <label htmlFor="reason">Reason for request</label>
          <textarea id="reason" name="reason" />
        </>
      )}
      <div className="sk-actions"><button type="submit">Send</button></div>
    </form>
  </>
));

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first', `${ctx.publicBase}/signin`);
  const asAdmin = administers(who.row);
  if (method === 'GET') return form(ctx, asAdmin);
  if (method !== 'POST') return refused(405, 'Method not allowed');
  const email = field(ctx, 'email').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return refused(400, 'Enter an email address');
  const team = String(who.row.team_id);
  if (!asAdmin) {
    const id = ctx.mint('invite_request');
    await ctx.write('invite_request', id, { email, reason: field(ctx, 'reason'), requested_by: who.id, team_id: team, status: 'pending', date_created: Math.floor(Date.parse(ctx.occurredAt) / 1000) }, 'invite_request.create');
    return page('Request sent', <><h1>Your request was sent to an admin</h1></>, 201);
  }
  const guest = field(ctx, 'invite_type') === 'single_channel_guest';
  if (guest && !ctx.row('channel', field(ctx, 'channel'))) return refused(400, 'Choose the channel a guest joins');
  await invite(ctx, { email, team, by: who.id, guest, channels: guest ? [field(ctx, 'channel')] : [] });
  return page('Invitation sent', <><h1>Invitation sent to {email}</h1></>, 201);
}
