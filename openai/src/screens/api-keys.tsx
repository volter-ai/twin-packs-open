// OPENAI'S API KEYS PAGE — a workspace screen (docs/contributing/architecture.md, "Screens"): a project's secret keys
// are made on platform.openai.com, never through the API (docs: platform.openai.com/docs/api-reference/project-api-keys
// lists, retrieves and deletes them; creating one is the dashboard's "Create new secret key"). The page lists the
// project's keys, makes a new one from its name and permissions and shows its secret once, and revokes a key. The
// Admin API then reads and deletes what the page made. Authored with @volter/world-ui's server-rendered page under OpenAI's
// skin; nothing of OpenAI's page is copied.
//
// The page acts for the person signed in to the dashboard (./login.tsx), never on an API key: a key is for the API,
// and a request whose session names nobody is sent to log in. A key the page makes is that person's: its owner is
// their user (https://platform.openai.com/docs/api-reference/project-api-keys/object, owner.user: id, email, name,
// created_at, role).
//
// Where the documentation stops and the twin decides: a key's secret is derived from its id, and shown once, as the
// dashboard does; any person of the organization may make and revoke a project's keys.
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, toSignIn } from '@volter/world-ui';
import { sha256 } from '@volter/world-core';
import { epoch, mintProjectKey, PROJECT_KEY } from '../semantics/shared.ts';
import { dashboardPath, PORTAL_PAGE_CSS, userOf, type User } from './shared.tsx';

// a key's owner as the spec's ProjectApiKeyOwnerUser gives it: the person's user, created_at being when they joined, and
// role their role in the project, "owner" or "member" (https://platform.openai.com/docs/api-reference/project-users/object).
// The twin keeps no project members: the organization's owner owns every project, and anyone else who makes a key there
// is a member of it.
const ownerOf = (user: User): Record<string, unknown> => ({ id: user.id, email: user.email, name: user.name, created_at: user.added_at, role: user.role === 'owner' ? 'owner' : 'member' });
const PERMISSIONS = [{ value: 'all', label: 'All' }, { value: 'restricted', label: 'Restricted' }, { value: 'read_only', label: 'Read only' }];
const redacted = (secret: string): string => `${secret.slice(0, 11)}...${secret.slice(-4)}`;

function page(ctx: HandlerContext, project: Record<string, unknown>, notice?: string, status = 200, secret?: string): Response {
  const id = String(project.id);
  const keys = ctx.rowsRaw(PROJECT_KEY).filter(k => k._project_id === id && k.deleted !== true).sort((a, b) => Number(b.created_at) - Number(a.created_at));
  return apiKeysPage(ctx, project, keys, { notice, secret, status });
}

/** platform.openai.com/settings/{project}/api-keys: the project's keys, a new one made (its secret shown once), a key
 *  revoked — for the person signed in. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const m = /^\/settings\/(proj[-_][A-Za-z0-9_-]+)\/api-keys\/?$/.exec(url.pathname);
  if (!m || (request.method !== 'GET' && request.method !== 'POST')) return new Response('Not Found', { status: 404 });
  const user = userOf(ctx);
  if (!user) return toSignIn(dashboardPath(ctx, '/login'), dashboardPath(ctx, url.pathname + url.search), 'return_to');
  const project = ctx.get('Project', m[1]!);
  if (!project) return flowPage({ title: 'OpenAI Platform', status: 404, css: PORTAL_PAGE_CSS, body: <main className="portal-main"><h1>Project not found</h1></main> });
  if (request.method === 'GET') return page(ctx, project);
  const form = formOf(ctx);
  if (form.revoke) {
    const key = ctx.row(PROJECT_KEY, form.revoke);
    if (!key || key._project_id !== project.id) return page(ctx, project, 'That key no longer exists.', 404);
    await ctx.write(PROJECT_KEY, form.revoke, { deleted: true }, 'api_key.delete');
    return page(ctx, project, `Revoked ${String(key.name)}. Requests using it will now fail.`);
  }
  const name = (form.name ?? '').trim() || 'Secret key';
  const id = ctx.mint(PROJECT_KEY);
  const secret = await mintProjectKey(ctx, id);
  await ctx.write(PROJECT_KEY, id, {
    object: 'organization.project.api_key', name, redacted_value: redacted(secret), created_at: epoch(ctx), last_used_at: null, _sha256: sha256(secret),
    _project_id: project.id, owner: { type: 'user', user: ownerOf(user) }, owner_project_access: 'active', _permissions: PERMISSIONS.some((p) => p.value === form.permissions) ? form.permissions : 'all',
  }, 'api_key.create');
  return page(ctx, project, undefined, 201, secret);
}

// Authored layout reference: OpenAI Help Center, "Managing projects in the API platform", images
// Frame_12.png and Frame_13.png, read 2026-10-08. The published images illustrate the settings rail,
// key-table columns and create-key dialog; no vendor DOM, scripts, fonts or image assets are shipped.
// Visual reference: https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform

type Row = Record<string, unknown>;
const CSS = `
*{box-sizing:border-box}body{margin:0;background:#f7f7f8;color:#202123;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}a{color:inherit}button,a,input,select{outline-offset:3px}button{cursor:pointer}button:disabled{cursor:default}button,.button{border:1px solid #d9d9e3;border-radius:6px;background:#fff;color:inherit;padding:7px 12px;text-decoration:none}button:hover:not(:disabled){background:#f7f7f8}.primary{background:#10a37f;color:#fff;border-color:#10a37f}.primary:hover:not(:disabled){background:#0e9272}header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid #ececf1;gap:16px}.context{display:flex;align-items:center;gap:12px;min-width:0}.context strong{font-weight:500}.context span{color:#6e6e80}.top-links{display:flex;gap:20px;align-items:center}.top-links a{text-decoration:none;color:#6e6e80}.layout{display:grid;grid-template-columns:216px minmax(0,1fr);min-height:calc(100vh - 56px)}aside{padding:20px 12px;border-right:1px solid #ececf1;display:flex;flex-direction:column;gap:16px}aside h2{margin:0 12px 8px;font-size:11px;font-weight:600;letter-spacing:.06em}aside ul{list-style:none;margin:0;padding:0}aside a,aside .unavailable{display:block;padding:7px 12px;border-radius:5px;text-decoration:none;font-size:13px}aside .unavailable{color:#8e8ea0}aside a[aria-current=page]{background:#e9e9ed;color:#202123;font-weight:500}.rail-foot{margin-top:auto;border-top:1px solid #ececf1;padding-top:12px}.rail-foot a{color:#6e6e80}main{background:#fff;margin:8px;border-radius:8px;min-width:0}.page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #ececf1;padding:16px 24px}h1{font-size:18px;margin:0;font-weight:600}.page-body{padding:24px}.description{font-size:13px;margin:0 0 16px;color:#353740}.description a{color:#10a37f}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;text-align:left;white-space:nowrap;font-size:13px}th{font-size:10px;font-weight:500;letter-spacing:.04em;padding:12px 12px 10px 0;border-bottom:1px solid #ececf1}td{padding:14px 12px 14px 0;border-bottom:1px solid #ececf1;color:#555766}td:first-child{color:#202123}code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}.key-action{padding:3px 8px;color:#c53a3a;border-color:transparent;background:transparent}.empty{text-align:center;padding:48px;color:#6e6e80}.notice{margin:0 0 20px;padding:12px 16px;background:#f7f7f8;border:1px solid #ececf1;border-radius:6px}.notice[role=alert]{color:#c53a3a}dialog{border:0;border-radius:12px;padding:24px;width:min(460px,calc(100vw - 32px));color:#202123;background:#fff;max-height:calc(100vh - 48px);overflow:auto}dialog::backdrop{background:rgba(0,0,0,.45)}dialog h2{font-size:18px;margin:0 0 20px}.field{display:block;margin:0 0 18px;font-size:13px}.field>span{display:block;margin:0 0 7px}.optional,.help{color:#6e6e80;font-size:12px}.field input,.field select{display:block;width:100%;border:1px solid #d9d9e3;border-radius:6px;padding:9px 12px;background:#fff;color:#202123}.help{margin:8px 0 18px}fieldset{border:0;padding:0;margin:0 0 20px}legend{font-size:13px;margin-bottom:8px}.permissions{display:flex;gap:0;border-radius:6px;padding:3px;background:#f0f0f3;width:max-content}.permissions label{position:relative}.permissions input{position:absolute;opacity:0;width:1px;height:1px}.permissions span{display:block;padding:5px 10px;border-radius:4px;color:#6e6e80;font-size:12px;cursor:pointer}.permissions input:checked+span{color:#10a37f;background:#fff}.permissions input:focus-visible+span{outline:2px solid #10a37f}.dialog-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:24px}.saved-key{word-break:break-all;display:block;padding:12px;background:#f7f7f8;border:1px solid #d9d9e3;border-radius:6px}.warning{color:#6e6e80;font-size:13px}@media(max-width:760px){.layout{grid-template-columns:160px minmax(0,1fr)}.top-links{display:none}.page-heading,.page-body{padding:16px}.context{font-size:12px}}@media(max-width:520px){.layout{grid-template-columns:1fr}aside{border-right:0;border-bottom:1px solid #ececf1;padding:10px 16px;flex-direction:row}aside section:not(.project-nav),.rail-foot{display:none}aside h2{display:none}aside ul{display:flex}aside .unavailable{display:none}.page-heading{align-items:flex-start;flex-wrap:wrap}header{padding:0 16px}main{margin:0;border-radius:0}}
`;
const SCRIPT = `
document.querySelectorAll('[data-open-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.openDialog).showModal()));
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
const saved=document.getElementById('saved-key');if(saved)saved.showModal();
`;
const date = (value: unknown): string => value ? new Date(Number(value) * 1000).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'Never';

function apiKeysPage(ctx: HandlerContext, project: Row, keys: Row[], options: { notice?: string; secret?: string; status: number }): Response {
  const action = dashboardPath(ctx, `/settings/${String(project.id)}/api-keys`);
  const section = (title: string, labels: string[], active = false) => <section className={active ? 'project-nav' : undefined}><h2>{title}</h2><ul>{labels.map(label => <li key={label}>{active && label === 'API keys' ? <a href={action} aria-current="page">{label}</a> : <span className="unavailable" title="This page is outside this twin's declared screen scope">{label}</span>}</li>)}</ul></section>;
  return flowPage({ title: 'API keys - OpenAI API', css: [CSS], status: options.status, body: <>
    <header><div className="context"><strong>OpenAI</strong><span>/</span><strong>{String(project.name)}</strong></div><nav className="top-links" aria-label="Resources"><a href="https://platform.openai.com/docs">Docs</a><a href="https://platform.openai.com/docs/api-reference">API reference</a><span>Settings</span></nav></header>
    <div className="layout"><aside aria-label="Settings navigation">
      {section('SETTINGS', ['Your profile'])}{section('ORGANIZATION', ['General', 'API keys', 'Admin keys', 'Members', 'Projects', 'Billing', 'Limits', 'Usage', 'Data controls'])}
      {section('PROJECT', ['General', 'API keys', 'Members', 'Limits'], true)}
      <div className="rail-foot"><a href="https://cookbook.openai.com">Cookbook</a><a href="https://help.openai.com">Help</a></div>
    </aside><main><div className="page-heading"><h1>API keys</h1><button className="primary" type="button" data-open-dialog="create-key">+ Create new secret key</button></div>
      <div className="page-body"><p className="description">You can view and manage the API keys in this project.</p><p className="description">Do not share your API key with others or expose it in the browser or other client-side code.</p>
      {options.notice && !options.secret ? <p className="notice" role={options.status >= 400 ? 'alert' : 'status'}>{options.notice}</p> : null}
      <div className="table-scroll"><table aria-label="Project API keys"><thead><tr>{['NAME', 'SECRET KEY', 'CREATED', 'LAST USED', 'PROJECT ACCESS', 'CREATED BY', 'PERMISSIONS', ''].map((label, i) => <th scope="col" key={i}>{label || <span className="optional">Actions</span>}</th>)}</tr></thead><tbody>
        {keys.map(key => <tr key={String(key.id)}><td>{String(key.name)}</td><td><code>{String(key.redacted_value)}</code></td><td>{date(key.created_at)}</td><td>{date(key.last_used_at)}</td><td>{String(project.name)}</td><td>{String((key.owner as { user?: { name?: string }; service_account?: { name?: string } } | undefined)?.user?.name ?? (key.owner as { service_account?: { name?: string } } | undefined)?.service_account?.name ?? '')}</td><td>{key._permissions === 'read_only' ? 'Read only' : key._permissions === 'restricted' ? 'Restricted' : 'All'}</td><td><button className="key-action" type="button" data-open-dialog={`revoke-${String(key.id)}`} aria-label={`Revoke key ${String(key.name)}`}>Revoke</button></td></tr>)}
        {!keys.length ? <tr><td className="empty" colSpan={8}>This project has no API keys yet.</td></tr> : null}
      </tbody></table></div></div></main></div>
    <dialog id="create-key" aria-labelledby="create-title"><h2 id="create-title">Create new secret key</h2><form method="post" action={action}><div className="field"><span>Owned by</span><span>You</span></div><p className="help">This API key is tied to your user and can make requests against the selected project.</p><label className="field"><span>Name <span className="optional">Optional</span></span><input name="name" placeholder="My Test Key" autoComplete="off"/></label><label className="field"><span>Project</span><input value={String(project.name)} readOnly/></label><fieldset><legend>Permissions</legend><div className="permissions">{[{ value: 'all', label: 'All' }, { value: 'restricted', label: 'Restricted' }, { value: 'read_only', label: 'Read only' }].map(p => <label key={p.value}><input type="radio" name="permissions" value={p.value} defaultChecked={p.value === 'all'}/><span>{p.label}</span></label>)}</div></fieldset><div className="dialog-actions"><button type="button" data-close-dialog>Cancel</button><button type="submit" className="primary">Create secret key</button></div></form></dialog>
    {keys.map(key => <dialog key={String(key.id)} id={`revoke-${String(key.id)}`} aria-labelledby={`revoke-title-${String(key.id)}`}><h2 id={`revoke-title-${String(key.id)}`}>Revoke secret key?</h2><p>Requests using <strong>{String(key.name)}</strong> will stop working.</p><form method="post" action={action}><input type="hidden" name="revoke" value={String(key.id)}/><div className="dialog-actions"><button type="button" data-close-dialog>Cancel</button><button className="key-action" type="submit">Revoke key</button></div></form></dialog>)}
    {options.secret ? <dialog id="saved-key" aria-labelledby="saved-title"><h2 id="saved-title">Save your key</h2><p className="warning">You won't be able to view this secret key again. Keep it somewhere safe.</p><code className="saved-key">{options.secret}</code><div className="dialog-actions"><button type="button" className="primary" data-close-dialog>Done</button></div></dialog> : null}
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }}/>
  </> });
}
