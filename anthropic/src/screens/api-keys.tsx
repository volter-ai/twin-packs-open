// THE CONSOLE'S API KEYS — platform.claude.com/settings/keys: "click **Create key**. Name the key and choose an
// expiration" (a preset of 3 hours, 1 day, 7 days or 30 days, or Never); the key is shown once. Each key's row can
// Disable it (reversible, Re-enable) or Delete it (permanent). Every key made here acts in the organization's Default
// workspace (https://platform.claude.com/docs/en/manage-claude/authentication). Where the documentation stops: a custom
// duration and the linked account are not offered (no application's key needs them), and the page's words are the
// twin's. A workspace (docs/contributing/architecture.md, "Screens").
import type { HandlerContext } from '@volter/world-core';
import { flowPage, formOf, signedIn } from '@volter/world-ui';
import { KEY, keyValue, WORKSPACE } from '../semantics/shared.ts';
import { consolePath, COOKIE, notAllowed, type Row, toLogin } from './shared.tsx';

// source: https://platform.claude.com/docs/en/manage-claude/authentication "a preset (3 hours, 1 day, 7 days, or 30 days), a custom duration, or Never"
const EXPIRATIONS: Record<string, number | null> = { Never: null, '3 hours': 3 * 3_600_000, '1 day': 86_400_000, '7 days': 7 * 86_400_000, '30 days': 30 * 86_400_000 };

function page(ctx: HandlerContext, person: Row, notice?: string, status = 200, secret?: string): Response {
  const keys = ctx.rowsRaw(KEY).filter(k => k._organization === person.organization && k.status !== 'archived' && k.deleted !== true);
  return apiKeysPage(ctx, person, keys, Object.keys(EXPIRATIONS), notice, status, secret);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(ctx, '/settings/keys');
  if (request.method === 'GET') return page(ctx, person);
  if (request.method !== 'POST') return notAllowed();
  const f = formOf(ctx);
  const act = new URL(request.url).searchParams.get('do');
  if (act === 'disable' || act === 'enable' || act === 'delete') {
    const k = ctx.rowsRaw(KEY).find((x) => x.id === f.key && x._organization === person.organization && x.status !== 'archived');
    if (!k) return page(ctx, person, 'Choose a key of this organization.', 422);
    const to = act === 'disable' ? 'inactive' : act === 'enable' ? 'active' : 'archived';
    const refused = ctx.legal(KEY, 'status', `api_key.${act}`, k.status, to, String(k.id), 'external');
    if (refused) return page(ctx, person, refused.message, 422);
    await ctx.write(KEY, String(k.id), { status: to }, `api_key.${act}`);
    return page(ctx, person, `Key ${String(k.name)} ${act === 'disable' ? 'disabled' : act === 'enable' ? 're-enabled' : 'deleted'}.`);
  }
  const name = (f.name ?? '').trim();
  const lifetime = EXPIRATIONS[f.expiration ?? ''];
  if (!name || lifetime === undefined) return page(ctx, person, 'A key needs a name and an expiration.', 422);
  const workspace = ctx.rowsRaw(WORKSPACE).find((w) => w.organization === person.organization && w.name === 'Default' && w.deleted !== true);
  if (!workspace) return page(ctx, person, 'This organization has no Default workspace.', 422);
  const id = `apikey_01${ctx.mint(KEY)}`;
  const value = await keyValue(ctx, id);
  await ctx.write(KEY, id, {
    name, workspace: workspace.id, _organization: person.organization, created_by: person.email, created_at: ctx.occurredAt, hint: `${value.slice(0, 14)}...${value.slice(-4)}`,
    _sha256: ctx.crypto.sha256(value), expires_at: lifetime === null ? null : new Date(Date.parse(ctx.occurredAt) + lifetime).toISOString(), status: 'active', deleted: false,
  }, 'api_key.create');
  return page(ctx, person, `Key ${name} created: ${value} — save it now; you won't be able to see it again.`, 201, value);
}

// Authored visual reference, read 2026-10-08: the firsthand Console screenshot in
// https://www.sean-lloyd.com/post/how-to-get-your-claude-api-key (2026-03-22).
// The vendor's own documentation supplies the actions, workspace and expiration contract.
// No reference image, vendor DOM or scripts are shipped with this page.
// Action contract: https://platform.claude.com/docs/en/manage-claude/authentication

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#faf9f5;color:#141413;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}a{color:inherit;text-decoration:none}button,a,input,select{outline-offset:3px}button{cursor:pointer}button{border:1px solid #d7d5cc;border-radius:7px;padding:7px 12px;background:#fff;color:#141413}.primary{background:#141413;border-color:#141413;color:#faf9f5}.console{display:grid;grid-template-columns:248px 260px minmax(0,1fr);min-height:100vh}.product-rail{background:#f5f4ed;border-right:1px solid #e8e6dc;padding:10px 12px;display:flex;flex-direction:column}.wordmark{font:24px/1.4 Georgia,serif;letter-spacing:-.8px;margin-bottom:16px}.nav-section{padding:14px 0;border-bottom:1px solid #d7d5cc}.nav-section h2{font-size:11px;font-weight:500;color:#73726b;letter-spacing:.03em;margin:0 0 8px}.nav-item{display:block;padding:8px;border-radius:6px;font-size:13px}.unavailable{color:#67665f}.nav-item[aria-current=page]{background:#e8e6dc}.organization{margin-top:auto;padding:18px 8px;font-size:12px;color:#73726b}.organization strong{display:block;color:#141413;font-weight:500;font-size:13px}.settings-rail{padding:26px 16px}.org-card{border:1px solid #d7d5cc;border-radius:9px;padding:14px 18px;margin-bottom:20px}.org-card small{display:block;color:#73726b}.settings-rail .nav-item{padding:13px 18px;margin-bottom:5px}main{min-width:0;padding:28px 28px 48px 16px}.heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}h1{margin:0;font-size:22px;font-weight:500}.key-intro{border:1px solid #bcbab0;border-radius:12px;background:#f5f4ed;padding:18px;margin-bottom:24px}.key-intro .heading{margin-bottom:8px}.key-intro h1{font-size:20px}.key-intro p{margin:0;max-width:720px}.key-intro a{text-decoration:underline}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;font-size:13px}th{font-size:12px;font-weight:500;color:#73726b;padding:14px 12px;border-bottom:1px solid #d7d5cc}td{padding:16px 12px;border-bottom:1px solid #e8e6dc}td strong{font-weight:500}.hint{display:block;color:#73726b;font:11px ui-monospace,SFMono-Regular,monospace;margin-top:4px}.status{font-size:11px;padding:2px 7px;border:1px solid #d7d5cc;border-radius:5px}.notice{padding:12px 16px;border:1px solid #d7d5cc;border-radius:7px;overflow-wrap:anywhere}.notice[role=alert]{color:#a33728}.empty{color:#73726b;padding:36px 12px}.actions{display:flex;gap:6px}.actions form{margin:0}.actions button{font-size:12px}.danger{color:#a33728}dialog{border:1px solid #d7d5cc;border-radius:12px;background:#faf9f5;color:#141413;width:min(480px,calc(100vw - 32px));padding:26px;max-height:calc(100vh - 48px);overflow:auto}dialog::backdrop{background:rgba(20,20,19,.4)}dialog h2{font-size:21px;font-weight:500;margin:0 0 24px}.field{display:block;margin:0 0 20px}.field>span{display:block;margin-bottom:7px;font-size:13px}.field input,.field select{width:100%;border:1px solid #d7d5cc;border-radius:6px;padding:9px 12px;background:#fff;color:#141413}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:26px}.secret{word-break:break-all;display:block;padding:14px;background:#fff;border:1px solid #d7d5cc;border-radius:6px;font:13px/1.7 ui-monospace,SFMono-Regular,monospace}.muted{color:#73726b;font-size:13px}@media(max-width:1100px){.console{grid-template-columns:200px 210px minmax(0,1fr)}main{padding:24px 18px 40px 8px}}@media(max-width:820px){.console{grid-template-columns:180px minmax(0,1fr)}.settings-rail{display:none}main{padding:24px}.heading{flex-wrap:wrap}}@media(max-width:520px){.console{grid-template-columns:1fr}.product-rail{border:0;border-bottom:1px solid #e8e6dc;padding:12px 16px}.wordmark{margin:0;font-size:22px}.nav-section,.organization{display:none}main{padding:24px 16px}}
`;
const SCRIPT = `document.querySelectorAll('[data-open-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.openDialog).showModal()));document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));const saved=document.getElementById('saved-key');if(saved)saved.showModal();`;
const date = (value: unknown) => value ? String(value).slice(0, 10) : 'Never';

function apiKeysPage(ctx: HandlerContext, person: Row, keys: Row[], expirations: string[], notice: string | undefined, status: number, secret?: string): Response {
  const action = consolePath(ctx, '/settings/keys');
  const organization = String(ctx.get('organization', String(person.organization))?.name ?? person.organization);
  const nav = (label: string) => label === 'API keys' ? <a key={label} className="nav-item" href={action} aria-current="page">{label}</a> : <span key={label} className="nav-item unavailable" title="Outside this twin's declared screen scope">{label}</span>;
  return flowPage({ title: 'API keys | Claude Console', css: [CSS], status, body: <><div className="console"><aside className="product-rail" aria-label="Console navigation"><div className="wordmark">Claude Console</div>{[{ title: 'BUILD', items: ['Dashboard', 'Workbench', 'Files', 'Skills'] }, { title: 'ANALYTICS', items: ['Usage', 'Cost', 'Logs', 'Batches'] }, { title: 'CLAUDE CODE', items: ['Usage', 'Preferences'] }, { title: 'MANAGE', items: ['API keys', 'Limits'] }].map(section => <section className="nav-section" key={section.title}><h2>{section.title}</h2>{section.items.map(nav)}</section>)}<div className="organization"><strong>{String(person.email)}</strong>{organization}</div></aside>
    <nav className="settings-rail" aria-label="Organization settings"><div className="org-card">Organization<small>{organization}</small></div>{['Profile', 'Appearance', 'Organization', 'Workspaces', 'Billing', 'Limits', 'API keys', 'Privacy controls'].map(nav)}</nav>
    <main><section className="key-intro"><div className="heading"><h1>{keys.length ? 'API keys' : 'Create an API key'}</h1><button className="primary" type="button" data-open-dialog="create-key">+ Create key</button></div><p>Create a key to integrate with the Claude API. You can use the API directly or through a <a href="https://platform.claude.com/docs/en/api/client-sdks">client SDK</a>.</p></section>
    {notice && !secret ? <p className="notice" role={status >= 400 ? 'alert' : 'status'}>{notice}</p> : null}
    {keys.length ? <div className="table-scroll"><table aria-label="API keys"><thead><tr>{['Key', 'Workspace', 'Created by', 'Created at', 'Last used at', 'Expires at', 'Status', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{keys.map(key => <tr key={String(key.id)}><td><strong>{String(key.name)}</strong><code className="hint">{String(key.hint)}</code></td><td>Default</td><td>{String(key.created_by ?? '')}</td><td>{date(key.created_at)}</td><td>{date(key.last_used_at)}</td><td>{date(key.expires_at)}</td><td><span className="status">{key.status === 'active' ? 'Active' : 'Disabled'}</span></td><td><div className="actions"><form method="post" action={`${action}?do=${key.status === 'active' ? 'disable' : 'enable'}`}><input type="hidden" name="key" value={String(key.id)}/><button type="submit">{key.status === 'active' ? 'Disable' : 'Re-enable'}</button></form><button className="danger" type="button" data-open-dialog={`delete-${String(key.id)}`}>Delete</button></div></td></tr>)}</tbody></table></div> : null}
    </main></div>
    <dialog id="create-key" aria-labelledby="create-title"><h2 id="create-title">Create key</h2><form method="post" action={`${action}?do=create`}><label className="field"><span>Name</span><input name="name" required autoComplete="off"/></label><label className="field"><span>Workspace</span><input value="Default" readOnly/></label><label className="field"><span>Expiration</span><select name="expiration" defaultValue="Never">{expirations.map(value => <option key={value} value={value}>{value}</option>)}</select></label><div className="dialog-actions"><button type="button" data-close-dialog>Cancel</button><button className="primary" type="submit">Create key</button></div></form></dialog>
    {keys.map(key => <dialog key={String(key.id)} id={`delete-${String(key.id)}`} aria-labelledby={`delete-title-${String(key.id)}`}><h2 id={`delete-title-${String(key.id)}`}>Delete API key?</h2><p><strong>{String(key.name)}</strong> will be permanently deleted.</p><form method="post" action={`${action}?do=delete`}><input type="hidden" name="key" value={String(key.id)}/><div className="dialog-actions"><button type="button" data-close-dialog>Cancel</button><button className="danger" type="submit">Delete</button></div></form></dialog>)}
    {secret ? <dialog id="saved-key" aria-labelledby="saved-title"><h2 id="saved-title">API key created</h2><p className="muted">Save it now; you won't be able to see it again.</p><code className="secret">{secret}</code><div className="dialog-actions"><button type="button" className="primary" data-close-dialog>Done</button></div></dialog> : null}
    <script dangerouslySetInnerHTML={{ __html: SCRIPT }}/>
  </> });
}
