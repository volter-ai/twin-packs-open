// SLACK'S JOIN PAGE — an invitation's Join Now link, slack.com/join/invite/<invitation> (a hosted flow,
// docs/contributing/architecture.md, "Screens"): the invited person enters their name and joins the workspace, a
// member in its #general, a guest in the one channel they were invited to
// (https://slack.com/help/articles/212675257-Join-a-Slack-workspace). A link already used, or none, is gone.
//
// Where the documentation stops and the twin decides: the handle is the email's name.
import { startBrowserSession, type HandlerContext } from '@volter/world-core';
import { channelTeam, addMember, addToTeam } from '../semantics/shared.ts';
import { CLIENT_COOKIE, field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const id = /^\/join\/invite\/([A-Za-z0-9]+)\/?$/.exec(new URL(ctx.call.request.url).pathname)?.[1];
  const invitation = id ? ctx.row('invitation', id) : undefined;
  if (!invitation || invitation.accepted === true) return refused(404, 'This invitation link is no longer valid');
  const teamId = String(invitation.team_id);
  const team = ctx.get('team', teamId);
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
  if (!who) return refused(401, 'Sign in to Slack first', `${ctx.publicBase}/signin`);
  const name = field(ctx, 'name').trim();
  if (!name) return refused(400, 'Enter your full name');
  const email = String(invitation.email).toLowerCase();
  const signedInProfile = who.row?.profile as Row | undefined;
  if (who.row && String(signedInProfile?.email ?? '').toLowerCase() !== email) return refused(403, 'This invitation was sent to a different email address');
  const guest = invitation.guest === true;
  let member = ctx.rowsRaw('user').find((user) => user.team_id === teamId && String((user.profile as Row | undefined)?.email ?? '').toLowerCase() === email);
  if (!member) {
    const at = Math.floor(Date.parse(ctx.occurredAt) / 1000);
    const [first, ...rest] = name.split(/\s+/);
    const fields = {
      name: email.split('@')[0], team_id: teamId, deleted: false, created: at, updated: at,
      is_restricted: guest, is_ultra_restricted: guest, profile: { real_name: name, display_name: '', email, first_name: first, last_name: rest.join(' '), title: '' },
    };
    member = !ctx.row('user', who.id, { withDeleted: true })
      ? await ctx.write('user', who.id, fields, 'user.join') : await ctx.create('user', fields, 'user.join');
  }
  const memberId = String(member.id);
  await addToTeam(ctx, teamId, memberId);
  await ctx.write('invitation', String(id), { accepted: true, user: memberId }, 'invitation.accept');
  const channels: Row[] = guest
    ? ((invitation.channels as string[]) ?? []).map((c) => ctx.row('channel', c)).filter(Boolean) as Row[]
    : ctx.rowsRaw('channel').filter((c) => c.is_general === true && channelTeam(c) === teamId);
  for (const c of channels) await addMember(ctx, String(c.id), memberId);
  const response = page('Welcome', <><h1>Welcome to {String(team?.name ?? 'Slack')}, {name}</h1></>, 201);
  if (!ctx.call.request.headers.has('authorization')) response.headers.set('set-cookie', await startBrowserSession(ctx, email, CLIENT_COOKIE, teamId));
  return response;
}
