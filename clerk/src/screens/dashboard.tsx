// Clerk's operator workspace, authored from its public Dashboard guides and reference images.
// The World authorizes access to its operator pages; this is not Clerk application sign-in or a Dashboard account login.
// source: https://clerk.com/docs/guides/users/managing "navigate to the Users"
// source: https://clerk.com/docs/guides/dashboard/user-profile "Personal information (name, avatar, etc.)"
// source: https://clerk.com/docs/guides/dashboard/user-profile "Metadata (public, private, and unsafe metadata attached to the account)"
import { twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { flowPage, formOf, Portal, PORTAL_CSS, redirect } from '@volter/world-ui';
import { instanceRow, membershipsOf, membershipView } from '../semantics/shared.ts';
import { GetUserList, GetUsersCount, UpdateUser } from '../semantics/users.ts';
import { GetSessionList, RevokeSession } from '../semantics/sessions.ts';

type Row = Record<string, unknown>;
type Body = Parameters<typeof flowPage>[0]['body'];
const at = (ctx: HandlerContext, path: string): string => `${ctx.publicBase}${path}`;
const userPath = (id: unknown): string => `/users/${encodeURIComponent(String(id))}`;
const name = (user: Row): string => [user.first_name, user.last_name].filter(Boolean).join(' ') || String(user.username || primaryEmail(user) || user.id);
const objects = (value: unknown): Row[] => Array.isArray(value) ? value.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row)) : [];
const primaryEmail = (user: Row): string => {
  const emails = objects(user.email_addresses);
  return String((emails.find((email) => email.id === user.primary_email_address_id) ?? emails[0])?.email_address ?? '');
};
const date = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  const parsed = new Date(Number(value));
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};

// A screen hands the same native input to the existing operation; its writes, state refusals and answer remain that operation's.
function operation(ctx: HandlerContext, id: string, method: string, path: string, params: Record<string, string>, body?: Row): HandlerContext {
  const url = new URL(ctx.call.request.url);
  url.pathname = path.split('?')[0]!;
  url.search = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  const request = new Request(url, { method, headers: ctx.call.request.headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { ...ctx, body, text: body ? JSON.stringify(body) : '', params, call: { request, params, operation: { ...ctx.call.operation, id, method, path: url.pathname } } };
}

function dashboard(ctx: HandlerContext, title: string, body: Body, status = 200): Response {
  const environment = instanceRow(ctx)?.environment_type === 'production' ? 'Production' : 'Development';
  return flowPage({ title: `${title} | Clerk`, css: [PORTAL_CSS, CSS], status, body:
    <div className="clerk-dashboard">
      <header className="clerk-top"><a className="clerk-word" href={at(ctx, '/users')}>Clerk</a><span className="clerk-divider"/><span>Application</span><span className="environment">{environment}</span></header>
      <div className="clerk-layout"><aside className="clerk-nav"><div className="nav-heading">User management</div><nav aria-label="Clerk Dashboard"><a href={at(ctx, '/users')} aria-current="page">Users</a></nav></aside>
        <main className="clerk-main"><header className="page-heading"><h1>{title}</h1></header>{body}</main>
      </div>
    </div> });
}
const message = (ctx: HandlerContext, text: string, status: number): Response => dashboard(ctx, 'Users', <p className="error" role="alert">{text}</p>, status);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return request.method === 'POST' ? message(ctx, 'Unsupported Dashboard action', 400) : redirect(at(ctx, '/users'));
  if (path === '/users') {
    if (request.method === 'POST') return message(ctx, 'Unsupported Users action', 400);
    return users(ctx, url);
  }
  const selected = /^\/users\/([^/]+)$/.exec(path);
  if (!selected) return message(ctx, 'Page not found', 404);
  let id: string;
  try { id = decodeURIComponent(selected[1]!); } catch { return message(ctx, 'User not found', 404); }
  const user = ctx.get('User', id);
  if (!user) return message(ctx, 'User not found', 404);
  const formKey = await ctx.secret(`clerk-dashboard-form:${String(user.id)}`);
  let error = '';
  let status = 200;
  if (request.method === 'POST') {
    const form = formOf(ctx);
    if (form.formKey !== formKey) return message(ctx, 'Unable to save: invalid form', 403);
    let response: Response;
    if (form.action === 'profile') {
      if (Object.keys(form).some((key) => !['action', 'formKey', 'first_name', 'last_name'].includes(key))) return message(ctx, 'Unsupported profile field', 400);
      if (!('first_name' in form) || !('last_name' in form)) return message(ctx, 'Enter the profile name fields', 400);
      response = await UpdateUser(operation(ctx, 'UpdateUser', 'PATCH', `/v1/users/${encodeURIComponent(String(user.id))}`, { user_id: String(user.id) }, { first_name: form.first_name || null, last_name: form.last_name || null }));
    } else if (form.action === 'revoke') {
      if (Object.keys(form).some((key) => !['action', 'formKey', 'session_id'].includes(key))) return message(ctx, 'Unsupported session field', 400);
      const session = ctx.get('Session', form.session_id ?? '');
      if (!session || session.user_id !== user.id) return message(ctx, 'Session not found for this user', 404);
      // source: spec:RevokeSession "which is an unauthenticated state."
      response = await RevokeSession(operation(ctx, 'RevokeSession', 'POST', `/v1/sessions/${encodeURIComponent(String(session.id))}/revoke`, { session_id: String(session.id) }));
    } else return message(ctx, 'Unsupported user action', 400);
    if (response.ok) return redirect(at(ctx, `${userPath(user.id)}?saved=${form.action === 'profile' ? 'profile' : 'session'}`));
    status = response.status;
    const payload = await response.json() as { errors?: Array<{ long_message?: string; message?: string }> };
    error = payload.errors?.map((item) => item.long_message || item.message || 'Unable to save').join(' ') || 'Unable to save';
  }
  return profile(ctx, user, formKey, url, error, status);
}

async function users(ctx: HandlerContext, url: URL): Promise<Response> {
  const query = url.searchParams.get('query') ?? '';
  const supplied = Number(url.searchParams.get('offset') ?? 0);
  const offset = Number.isSafeInteger(supplied) && supplied >= 0 ? supplied : 0;
  const filters = new URLSearchParams({ query, limit: '25', offset: String(offset), order_by: '-created_at' });
  const list = await GetUserList(operation(ctx, 'GetUserList', 'GET', `/v1/users?${filters}`, {}));
  if (!list.ok) return list;
  const rows = await list.json() as Row[];
  const counted = await GetUsersCount(operation(ctx, 'GetUsersCount', 'GET', `/v1/users/count?${new URLSearchParams({ query })}`, {}));
  if (!counted.ok) return counted;
  const total = Number((await counted.json() as Row).total_count);
  const pagination = (next: number): string => at(ctx, `/users?${new URLSearchParams({ query, offset: String(next) })}`);
  return dashboard(ctx, 'Users', <>
    <div className="list-toolbar"><form method="get" action={at(ctx, '/users')}><label className="sr-only" htmlFor="user-search">Search users</label><input id="user-search" type="search" name="query" defaultValue={query} placeholder="Search users"/><button type="submit">Search</button></form><span>{total} {total === 1 ? 'user' : 'users'}</span></div>
    <div className="table-wrap"><table className="users-table"><thead><tr><th scope="col">User</th><th scope="col">User ID</th><th scope="col">Created</th><th scope="col">Last sign in</th></tr></thead><tbody>
      {rows.map((user) => <tr key={String(user.id)}><td><a className="user-cell" href={at(ctx, userPath(user.id))}><strong>{name(user)}</strong>{primaryEmail(user) ? <span>{primaryEmail(user)}</span> : null}</a></td><td><code>{String(user.id)}</code>{user.banned === true ? <span className="badge">Banned</span> : user.locked === true ? <span className="badge">Locked</span> : null}</td><td>{date(user.created_at)}</td><td>{date(user.last_sign_in_at)}</td></tr>)}
    </tbody></table>{!rows.length ? <div className="empty"><h2>{query ? 'No matching users' : 'No users yet'}</h2><p>{query ? 'Try another name, identifier or user ID.' : 'Users created in this application will appear here.'}</p></div> : null}</div>
    <footer className="pagination"><span>{rows.length ? `Showing ${offset + 1}–${offset + rows.length} of ${total}` : `Showing 0 of ${total}`}</span><div>{offset > 0 ? <a href={pagination(Math.max(0, offset - 25))}>Previous</a> : null}{offset + rows.length < total ? <a href={pagination(offset + 25)}>Next</a> : null}</div></footer>
  </>);
}

async function profile(ctx: HandlerContext, user: Row, formKey: string, url: URL, error: string, status: number): Promise<Response> {
  const path = at(ctx, userPath(user.id));
  const sessionsResponse = await GetSessionList(operation(ctx, 'GetSessionList', 'GET', `/v1/sessions?${new URLSearchParams({ user_id: String(user.id), limit: '500' })}`, {}));
  if (!sessionsResponse.ok) return sessionsResponse;
  const sessions = await sessionsResponse.json() as Row[];
  const memberships = membershipsOf(ctx, String(user.id)).map((row) => membershipView(ctx, row));
  const identifiers = [
    ...objects(user.email_addresses).map((row) => ({ title: String(row.email_address), detail: 'Email address', badge: row.id === user.primary_email_address_id ? 'Primary' : undefined, note: String((row.verification as Row | undefined)?.status ?? '') })),
    ...objects(user.phone_numbers).map((row) => ({ title: String(row.phone_number), detail: 'Phone number', badge: row.id === user.primary_phone_number_id ? 'Primary' : undefined })),
    ...objects(user.external_accounts).map((row) => ({ title: String(row.provider), detail: String(row.email_address ?? row.username ?? row.provider_user_id ?? '') })),
  ];
  return dashboard(ctx, name(user), <>
    <a className="back-link" href={at(ctx, '/users')}>All users</a>
    <div className="profile-header">{user.has_image === true && user.image_url ? <img className="profile-image" src={twinVendorUrl(ctx.call.request, String(user.image_url))} alt=""/> : null}<div><h2>{name(user)}</h2><p>{primaryEmail(user)}</p><code>{String(user.id)}</code></div><dl><dt>Created</dt><dd>{date(user.created_at)}</dd><dt>Last sign in</dt><dd>{date(user.last_sign_in_at)}</dd></dl></div>
    <nav className="profile-tabs" aria-label="User profile"><a href={`${path}#user-details`}>User details</a><a href={`${path}#organizations`}>Organizations</a><a href={`${path}#sessions`}>Sessions</a></nav>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {['profile', 'session'].includes(url.searchParams.get('saved') ?? '') ? <p className="notice" role="status">{url.searchParams.get('saved') === 'profile' ? 'Personal information updated.' : 'Session revoked.'}</p> : null}
    <section id="user-details" className="detail-section"><h2>User details</h2><div className="split-card"><div><h3>Personal information</h3><p>Manage personal information settings</p></div><form method="post" action={path}><input type="hidden" name="action" value="profile"/><input type="hidden" name="formKey" value={formKey}/><label>First name<input name="first_name" defaultValue={String(user.first_name ?? '')}/></label><label>Last name<input name="last_name" defaultValue={String(user.last_name ?? '')}/></label>{user.username ? <p>Username <code>{String(user.username)}</code></p> : null}<button type="submit" className="primary">Save</button></form></div>
      <Portal merchant="" sections={[{ heading: 'Identifiers', items: identifiers, empty: 'No identifiers' }]}/>
      <div className="metadata-grid">{['public_metadata', 'private_metadata', 'unsafe_metadata'].map((field) => <section className="metadata-card" key={field}><h3>{field === 'public_metadata' ? 'Public metadata' : field === 'private_metadata' ? 'Private metadata' : 'Unsafe metadata'}</h3><pre>{JSON.stringify(user[field] ?? {}, null, 2)}</pre></section>)}</div>
    </section>
    <section id="organizations" className="detail-section"><Portal merchant="" sections={[{ heading: 'Organizations', empty: 'No organization memberships', items: memberships.map((membership) => ({ title: String((membership.organization as Row | undefined)?.name ?? membership.organization_id ?? ''), detail: String(membership.role ?? '') })) }]}/></section>
    <section id="sessions" className="detail-section"><Portal merchant="" sections={[{ heading: 'Sessions', empty: 'No sessions', items: sessions.map((session) => ({ title: String(session.id), badge: String(session.status), detail: `Last active ${date(session.last_active_at)}`, note: `Created ${date(session.created_at)} · Expires ${date(session.expire_at)}`, actions: session.status === 'active' ? [{ label: 'Revoke session', action: path, tone: 'danger', fields: { action: 'revoke', formKey, session_id: String(session.id) } }] : [] })) }]}/></section>
  </>, status);
}

// Vendor skin: a light Clerk Dashboard, personal-information split panels and native user table.
// Official visual references and the omitted production controls are recorded in spec/screen-references.json.
const CSS = `
*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#18181b;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input{font:inherit}button{cursor:pointer;background:#fff;border:1px solid #d4d4d8;border-radius:6px;padding:7px 13px;color:#27272a}button:hover{background:#f4f4f5}a:focus-visible,button:focus-visible,input:focus-visible{outline:2px solid #6c47ff;outline-offset:3px}input{background:#fff;color:#18181b;border:1px solid #d4d4d8;border-radius:6px;padding:9px 12px}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.clerk-top{height:64px;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid #e4e4e7;background:#fff}.clerk-word{font-size:22px;font-weight:650;letter-spacing:-.8px}.clerk-divider{height:23px;width:1px;background:#e4e4e7}.environment{font-size:12px;color:#6c47ff;background:#f4f0ff;border:1px solid #e5dcff;border-radius:5px;padding:3px 9px}.clerk-layout{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:calc(100vh - 64px)}.clerk-nav{padding:29px 16px;border-right:1px solid #e4e4e7;background:#fff}.nav-heading{font-size:11px;font-weight:600;color:#71717a;margin:0 12px 12px}.clerk-nav a{display:block;border-radius:6px;padding:8px 12px;background:#f3efff;color:#5b36dc;font-weight:500}.clerk-main{padding:28px 38px 60px;min-width:0;max-width:1500px;width:100%;margin:0 auto}.page-heading h1{font-size:23px;font-weight:600;margin:0 0 26px;letter-spacing:-.4px}.list-toolbar{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:18px;color:#71717a;font-size:13px}.list-toolbar form{display:flex;gap:8px}.list-toolbar input{width:280px}.table-wrap{border:1px solid #e4e4e7;border-radius:9px;overflow:auto;background:#fff}.users-table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}.users-table th{font-size:12px;color:#71717a;font-weight:500;background:#fafafa;padding:12px 18px;border-bottom:1px solid #e4e4e7}.users-table td{font-size:13px;padding:16px 18px;border-bottom:1px solid #f0f0f2}.users-table tr:last-child td{border-bottom:0}.users-table tr:hover td{background:#faf9ff}.user-cell{display:flex;flex-direction:column;gap:2px}.user-cell strong{font-weight:500}.user-cell span{color:#71717a}.badge{display:inline-block;font-size:11px;padding:2px 6px;border:1px solid #e4e4e7;background:#f4f4f5;border-radius:4px;margin-left:8px}.empty{text-align:center;padding:55px 24px;color:#71717a}.empty h2{font-size:16px;font-weight:500;color:#3f3f46}.pagination{display:flex;justify-content:space-between;gap:12px;color:#71717a;font-size:12px;margin:18px 2px}.pagination div{display:flex;gap:16px}.pagination a{color:#5b36dc}.back-link{display:inline-block;font-size:13px;color:#71717a;margin-bottom:20px}.profile-header{display:flex;align-items:center;gap:16px;margin-bottom:28px}.profile-header h2{font-size:20px;margin:0;font-weight:600}.profile-header p{margin:3px 0;color:#71717a}.profile-header code{color:#71717a}.profile-header dl{margin-left:auto;font-size:12px;color:#71717a;display:grid;grid-template-columns:auto auto;column-gap:14px;row-gap:5px}.profile-header dd{margin:0;color:#3f3f46}.profile-image{width:48px;height:48px;border-radius:50%;object-fit:cover}.profile-tabs{display:flex;gap:27px;border-bottom:1px solid #e4e4e7;margin-bottom:28px;font-size:13px}.profile-tabs a{padding:0 0 12px}.profile-tabs a:first-child{border-bottom:2px solid #6c47ff;color:#5b36dc}.detail-section{scroll-margin-top:20px;margin-bottom:28px}.detail-section>h2{font-size:16px;font-weight:600;margin-bottom:15px}.split-card{display:grid;grid-template-columns:1fr 1.5fr;gap:35px;padding:28px;border:1px solid #e4e4e7;border-radius:9px;background:#fff;margin-bottom:20px}.split-card h3{font-size:14px;font-weight:600;margin:0}.split-card p{font-size:13px;color:#71717a;margin-top:5px}.split-card label{display:block;font-size:13px;margin-bottom:16px}.split-card input:not([type=hidden]){display:block;width:100%;margin-top:6px}.primary{background:#6c47ff;border-color:#6c47ff;color:#fff}.primary:hover{background:#5a36de}.portal{display:block;min-height:0;border:1px solid #e4e4e7;border-radius:9px;background:#fff;margin-bottom:20px}.portal-side{display:none}.portal-main{padding:24px 28px;max-width:none}.portal-section{margin-bottom:0}.portal-section h2{font-size:14px;text-transform:none;letter-spacing:0;border-color:#e4e4e7;padding-bottom:14px;margin-bottom:0}.portal-item{padding:16px 0;border-bottom:1px solid #f0f0f2}.portal-item:last-child{border:0}.portal-item strong{font-size:13px;font-weight:500}.portal-detail,.portal-note{font-size:12px;color:#71717a}.portal-badge{border:1px solid #e4e4e7;color:#52525b;background:#f4f4f5;margin:5px 0}.portal-danger{border-color:#fecaca;color:#b91c1c}.portal-empty{font-size:13px;color:#71717a;margin:20px 0 0}.metadata-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.metadata-card{border:1px solid #e4e4e7;border-radius:9px;background:#fff;min-width:0}.metadata-card h3{font-size:13px;font-weight:500;padding:14px 18px;margin:0;border-bottom:1px solid #e4e4e7}.metadata-card pre{margin:0;padding:18px;overflow:auto;color:#52525b;white-space:pre-wrap;overflow-wrap:anywhere}.error,.notice{font-size:13px;padding:12px 16px;border-radius:6px;margin:0 0 20px}.error{color:#991b1b;background:#fff1f2;border:1px solid #fecaca}.notice{color:#166534;background:#f0fdf4;border:1px solid #bbf7d0}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.clerk-layout{grid-template-columns:170px minmax(0,1fr)}.clerk-main{padding:25px 24px}.metadata-grid{grid-template-columns:1fr}.profile-header dl{display:none}.split-card{grid-template-columns:1fr;gap:22px}}@media(max-width:640px){.clerk-layout{display:block}.clerk-nav{padding:10px 18px;border-right:0;border-bottom:1px solid #e4e4e7}.nav-heading{display:none}.clerk-nav a{display:inline-block}.clerk-main{padding:24px 18px}.clerk-top{padding:0 18px;gap:14px}.list-toolbar{display:block}.list-toolbar>span{display:block;margin-top:10px}.list-toolbar input{width:200px}.split-card,.portal-main{padding:22px}.portal-item{flex-direction:column;gap:10px}.profile-tabs{gap:20px}}
`;
