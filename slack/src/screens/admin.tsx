// SLACK'S ADMIN PAGES — slack.com/admin, where a workspace's owners and admins manage its members (deactivate one, make
// one a Workspace Admin: https://slack.com/help/articles/360052445454-Manage-members-and-their-roles) and
// slack.com/admin/invites, where they approve or deny members' invitation requests
// (https://slack.com/help/articles/115004854783-Manage-invitation-requests). A workspace (docs/contributing/
// architecture.md, "Screens"): only its owners and admins reach it (403).
import type { HandlerContext } from '@volter/world-core';
import { invite, teamsOf, TOKENS } from '../semantics/shared.ts';
import { administers, field, page, refused, visitor } from './shared.tsx';

type Row = Record<string, unknown>;

const nameOf = (u: Row): string => String((u.profile as Row | undefined)?.real_name ?? u.name);

function members(ctx: HandlerContext, team: string, notice?: string): Response {
  const people = ctx.rowsRaw('user', { withDeleted: true }).filter((u) => u.is_bot !== true && teamsOf(ctx, String(u.id)).includes(team));
  return page('Manage members', (
    <>
      <h1>Manage members</h1>
      {notice ? <p className="sk-notice" role="status">{notice}</p> : null}
      <div className="sk-card">
        {people.map((u) => (
          <form key={String(u.id)} className="sk-row" method="post" action={`${ctx.publicBase}/admin`}>
            <span>{nameOf(u)} {u.deleted === true ? '(deactivated)' : u.is_primary_owner === true ? '(Primary Owner)' : u.is_admin === true ? '(Workspace Admin)' : u.is_restricted === true ? '(Guest)' : ''}</span>
            <input type="hidden" name="user" value={String(u.id)} />
            {u.is_primary_owner === true ? null : u.deleted === true ? <button name="action" value="reactivate">Activate account</button> : (
              <span>
                {u.is_admin === true || u.is_restricted === true ? null : <button name="action" value="make_admin">Make Workspace Admin</button>}
                <button className="sk-quiet" name="action" value="deactivate">Deactivate account</button>
              </span>
            )}
          </form>
        ))}
      </div>
    </>
  ), notice ? 201 : 200);
}

function requests(ctx: HandlerContext, team: string, notice?: string): Response {
  const pending = ctx.rowsRaw('invite_request').filter((r) => r.team_id === team && r.status === 'pending');
  return page('Invitation requests', (
    <>
      <h1>Invitation requests</h1>
      {notice ? <p className="sk-notice" role="status">{notice}</p> : null}
      <div className="sk-card">
        {pending.length === 0 ? <p>No pending requests.</p> : pending.map((r) => (
          <form key={String(r.id)} className="sk-row" method="post" action={`${ctx.publicBase}/admin/invites`}>
            <span>{String(r.email)}: {String(r.reason ?? '')}</span>
            <input type="hidden" name="request" value={String(r.id)} />
            <span><button name="answer" value="approve">Approve</button><button className="sk-quiet" name="answer" value="deny">Deny</button></span>
          </form>
        ))}
      </div>
    </>
  ), notice ? 201 : 200);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  const who = visitor(ctx);
  if (!who?.row) return refused(401, 'Sign in to Slack first', `${ctx.publicBase}/signin`);
  if (!administers(who.row)) return refused(403, 'Only owners and admins can manage this workspace');
  const team = String(who.row.team_id);
  const path = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '');
  if (path === '/admin/invites') {
    if (method === 'GET') return requests(ctx, team);
    const id = field(ctx, 'request');
    const r = ctx.row('invite_request', id);
    if (!r || r.team_id !== team) return refused(404, 'No such request');
    const approve = field(ctx, 'answer') === 'approve';
    const refusal = ctx.legal('invite_request', 'status', 'admin-invites', String(r.status), approve ? 'approved' : 'denied', id, 'external');
    if (refusal) return refused(409, 'This request was already decided');
    await ctx.write('invite_request', id, { status: approve ? 'approved' : 'denied', decided_by: who.id }, approve ? 'invite_request.approve' : 'invite_request.deny');
    if (approve) await invite(ctx, { email: String(r.email), team, by: String(r.requested_by) });
    return requests(ctx, team, approve ? `Invitation sent to ${String(r.email)}` : `Request from ${String(r.email)} denied`);
  }
  if (path !== '/admin') return refused(404, 'Page not found');
  if (method === 'GET') return members(ctx, team);
  const id = field(ctx, 'user');
  const u = ctx.row('user', id, { withDeleted: true });
  if (!u || !teamsOf(ctx, String(u.id)).includes(team) || u.is_primary_owner === true) return refused(404, 'No such member');
  const action = field(ctx, 'action');
  if (action === 'make_admin') {
    await ctx.write('user', id, { is_admin: true }, 'user.role');
    return members(ctx, team, `${nameOf(u)} is now a Workspace Admin`);
  }
  if (action === 'reactivate') {
    // source: https://slack.com/help/articles/360002061747-Reactivate-a-members-account "Click Activate account"
    const refusal = ctx.legal('user', 'deleted', 'admin-members', String(u.deleted === true), 'false', id, 'external');
    if (refusal) return refused(409, 'Already active');
    await ctx.write('user', id, { deleted: false, updated: Math.floor(Date.parse(ctx.occurredAt) / 1000) }, 'user.reactivate');
    // Previous grants remain revoked and channel membership remains removed.
    return members(ctx, team, `${nameOf(u)} was reactivated`);
  }
  // the page's buttons each name their action
  if (action !== 'deactivate') return refused(400, 'Choose an action');
  // source: https://slack.com/help/articles/204475027-Deactivate-a-members-account "Deactivate Workspace Admins"
  if (u.is_owner === true && who.row.is_primary_owner !== true) return refused(403, 'Only the Primary Owner can deactivate an owner');
  if (u.is_admin === true && who.row.is_owner !== true) return refused(403, 'Only an owner can deactivate an admin');
  const refusal = ctx.legal('user', 'deleted', 'admin-members', String(u.deleted === true), 'true', id, 'external');
  if (refusal) return refused(409, 'Already deactivated');
  await ctx.write('user', id, { deleted: true, updated: Math.floor(Date.parse(ctx.occurredAt) / 1000) }, 'user.deactivate');
  // source: https://slack.com/help/articles/204475027-Deactivate-a-members-account "They'll be removed from all channels"
  for (const member of ctx.rowsRaw('channel_member').filter((m) => m._user === id)) await ctx.remove('channel_member', String(member.id), 'user.deactivate');
  // a deactivated member is signed out everywhere: their tokens stop working
  for (const t of ctx.rowsRaw(TOKENS)) if (t.user === id && t.revoked !== true) await ctx.write(TOKENS, String(t.id), { revoked: true }, 'token.revoke');
  return members(ctx, team, `${nameOf(u)} was deactivated`);
}
