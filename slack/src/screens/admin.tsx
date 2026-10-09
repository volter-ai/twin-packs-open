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

// Workspace member-table reference (2021 public capture, not an Enterprise dashboard):
// https://news.mynavi.jp/article/20211118-1978513/images/003.jpg
// Roles/actions: https://slack.com/help/articles/218124397-Change-a-members-role
const MEMBERS_CSS = `
body:has(.sk-members){background:#fff}.sk:has(.sk-members){max-width:none;margin:0;padding:0}.sk-members .workspace-bar{border-bottom:1px solid #ddd;display:flex;align-items:center;gap:28px;padding:18px 32px;background:#fff}.sk-members .workspace-name{font-size:20px;font-weight:700}.sk-members nav{display:flex;flex-wrap:wrap;gap:22px;margin-left:auto}.sk-members a{color:#616061;text-decoration:none}.sk-members nav a[aria-current=page]{color:#1d1c1d;font-weight:700}.sk-members .members-heading{background:#f8f8f8;border-bottom:1px solid #ddd}.sk-members .members-width{max-width:1200px;margin:auto;padding:32px 40px}.sk-members .members-title{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.sk-members h1{font-size:28px}.sk-members .invite-button{background:#007a5a;color:#fff;border-radius:4px;padding:10px 18px;font-weight:700;white-space:nowrap}.sk-members .member-filter{display:flex;gap:12px;align-items:center}.sk-members .member-filter input{flex:1;min-width:0}.sk-members .member-filter input,.sk-members .member-filter select{font:inherit;background:#fff;padding:10px 12px;border:1px solid #bbb;border-radius:4px}.sk-members .members-count{color:#616061;margin:0 0 16px}.sk-members table{width:100%;border-collapse:collapse;text-align:left}.sk-members th{font-size:13px;color:#616061;font-weight:700;padding:14px 16px;border-bottom:1px solid #ddd}.sk-members td{padding:18px 16px;border-bottom:1px solid #eee}.sk-members tr:hover td{background:#f8f8f8}.sk-members .member-name{font-weight:700}.sk-members .member-email{font-size:13px;color:#616061;margin-top:4px}.sk-members .member-actions{position:relative;width:36px;margin-left:auto}.sk-members summary{list-style:none;cursor:pointer;border:1px solid transparent;border-radius:4px;padding:5px 8px;font-size:20px;line-height:1}.sk-members summary:hover{border-color:#bbb}.sk-members summary::-webkit-details-marker{display:none}.sk-members .member-menu{position:absolute;right:0;top:34px;z-index:1;min-width:220px;border:1px solid #ddd;border-radius:6px;box-shadow:0 3px 12px #0002;background:#fff;padding:6px}.sk-members .member-menu button{display:block;width:100%;text-align:left;background:#fff;color:#1d1c1d;font-weight:400;white-space:nowrap;border:0}.sk-members .member-menu button:hover{background:#f8f8f8}.sk-members .member-menu button[value=deactivate]{color:#e01e5a}.sk-members .empty-members{text-align:center;padding:32px;color:#616061}@media(max-width:700px){.sk-members .workspace-bar{align-items:flex-start;gap:12px;padding:16px;flex-direction:column}.sk-members nav{margin-left:0;gap:14px}.sk-members .members-width{padding:24px 16px}.sk-members .members-title{align-items:flex-start;flex-direction:column}.sk-members .member-filter{flex-wrap:wrap}.sk-members .member-filter input{flex-basis:100%}.sk-members td,.sk-members th{padding:12px 8px}.sk-members .member-email{overflow-wrap:anywhere}}
`;

const roleOf = (u: Row): string => u.is_primary_owner === true ? 'Primary Owner' : u.is_owner === true ? 'Workspace Owner' : u.is_admin === true ? 'Workspace Admin' : u.is_restricted === true ? 'Guest' : 'Full Member';

function members(ctx: HandlerContext, team: string, notice?: string): Response {
  const people = ctx.rowsRaw('user', { withDeleted: true }).filter((u) => u.is_bot !== true && teamsOf(ctx, String(u.id)).includes(team));
  const query = field(ctx, 'q').trim();
  const status = field(ctx, 'status');
  const shown = people.filter(u => (status !== 'active' || u.deleted !== true) && (status !== 'deactivated' || u.deleted === true)
    && [nameOf(u), String(u.id), String((u.profile as Row | undefined)?.email ?? ''), String((u.profile as Row | undefined)?.display_name ?? '')].some(value => value.toLowerCase().includes(query.toLowerCase())));
  const workspace = String(ctx.row('team', team)?.name ?? 'Workspace');
  return page('Manage members', (
    <div className="sk-members">
      <header className="workspace-bar">
        <strong>Slack</strong><span className="workspace-name">{workspace}</span>
        <nav aria-label="Workspace administration">
          <a href={`${ctx.publicBase}/client/${team}`}>Open Slack</a>
          <a href={`${ctx.publicBase}/admin`} aria-current="page">Manage members</a>
          <a href={`${ctx.publicBase}/admin/invites`}>Invitation requests</a>
          <a href={`${ctx.publicBase}/apps/manage`}>Manage apps</a>
          <a href={`${ctx.publicBase}/account/notifications`}>Notifications</a>
        </nav>
      </header>
      <section className="members-heading">
        <div className="members-width">
          <div className="members-title"><h1>Manage members</h1><a className="invite-button" href={`${ctx.publicBase}/invite`}>Invite people</a></div>
          {notice ? <p className="sk-notice" role="status">{notice}</p> : null}
          <form className="member-filter" method="get" action={`${ctx.publicBase}/admin`}>
            <input aria-label="Search members" type="search" name="q" placeholder="Search current members by name, email or ID" defaultValue={query} />
            <select aria-label="Member status" name="status" defaultValue={status === 'active' || status === 'deactivated' ? status : ''}>
              <option value="">All members</option><option value="active">Active members</option><option value="deactivated">Deactivated members</option>
            </select>
            <button className="sk-quiet" type="submit">Search</button>
          </form>
        </div>
      </section>
      <div className="members-width">
        <p className="members-count">{shown.length} of {people.length} {people.length === 1 ? 'member' : 'members'}</p>
        <table aria-label="Workspace members">
          <thead><tr><th scope="col">Name</th><th scope="col">Account type</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>{shown.map(u => <tr key={String(u.id)}>
            <td><div className="member-name">{nameOf(u)}</div><div className="member-email">{String((u.profile as Row | undefined)?.email ?? '')}</div></td>
            <td>{roleOf(u)}</td><td>{u.deleted === true ? 'Deactivated' : 'Active'}</td>
            <td>{u.is_primary_owner === true ? null : <details className="member-actions">
              <summary aria-label={`Manage ${nameOf(u)}`}>···</summary>
              <form className="member-menu" method="post" action={`${ctx.publicBase}/admin`}>
                <input type="hidden" name="user" value={String(u.id)} />
                {u.deleted === true ? <button name="action" value="reactivate">Activate account</button> : <>
                  {u.is_admin === true || u.is_restricted === true ? null : <button name="action" value="make_admin">Make Workspace Admin</button>}
                  <button name="action" value="deactivate">Deactivate account</button>
                </>}
              </form>
            </details>}</td>
          </tr>)}{shown.length === 0 ? <tr><td className="empty-members" colSpan={4}>No members match this search.</td></tr> : null}</tbody>
        </table>
      </div>
    </div>
  ), notice ? 201 : 200, [MEMBERS_CSS]);
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
