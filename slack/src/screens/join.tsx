// SLACK'S JOIN PAGE — an invitation's Join Now link, slack.com/join/invite/<invitation> (a hosted flow,
// docs/contributing/architecture.md, "Screens"): the invited person enters their name and joins the workspace, a
// member in its #general, a guest in the one channel they were invited to
// (https://slack.com/help/articles/212675257-Join-a-Slack-workspace). A link already used, or none, is gone.
//
// Where the documentation stops and the twin decides: the person's id is the one their client token names; their
// handle is their email's name.
import type { HandlerContext } from '@volter/world-core';
import { channelTeam, addMember, addToTeam } from '../semantics/shared.ts';
import { field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const id = /^\/join\/invite\/([A-Za-z0-9]+)\/?$/.exec(new URL(ctx.call.request.url).pathname)?.[1];
  const invitation = id ? ctx.row('invitation', id) : undefined;
  if (!invitation || invitation.accepted === true) return refused(404, 'This invitation link is no longer valid');
  const team = ctx.get('team', String(invitation.team_id));
  // the link is the invitation: whoever holds it sees the page; joining names who they are
  if (method === 'GET') {
    return page(`Join ${String(team?.name ?? '')}`, (
      <>
        <h1>Join {String(team?.name ?? 'your team')} on Slack</h1>
        <form className="sk-card" method="post" action={`${ctx.publicBase}${new URL(ctx.call.request.url).pathname}`}>
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" required />
          <div className="sk-actions"><button type="submit">Join</button></div>
        </form>
      </>
    ));
  }
  if (method !== 'POST') return refused(405, 'Method not allowed');
  const who = visitor(ctx);
  if (!who) return refused(401, 'Sign in to Slack first');
  const name = field(ctx, 'name').trim();
  if (!name) return refused(400, 'Enter your full name');
  const email = String(invitation.email);
  const at = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  const guest = invitation.guest === true;
  const [first, ...rest] = name.split(/\s+/);
  await ctx.write('user', who.id, {
    name: email.split('@')[0], team_id: invitation.team_id, deleted: false, created: at, updated: at,
    is_restricted: guest, is_ultra_restricted: guest, profile: { real_name: name, display_name: '', email, first_name: first, last_name: rest.join(' '), title: '' },
  }, 'user.join');
  await addToTeam(ctx, String(invitation.team_id), who.id);
  await ctx.write('invitation', String(id), { accepted: true, user: who.id }, 'invitation.accept');
  const channels: Row[] = guest
    ? ((invitation.channels as string[]) ?? []).map((c) => ctx.row('channel', c)).filter(Boolean) as Row[]
    : ctx.rowsRaw('channel').filter((c) => c.is_general === true && channelTeam(c) === invitation.team_id);
  for (const c of channels) await addMember(ctx, String(c.id), who.id);
  return page('Welcome', <><h1>Welcome to {String(team?.name ?? 'Slack')}, {name}</h1></>, 201);
}
