// Screen helpers use the shared person/session kit and the vendor's ordinary credential lifecycle.
import type { HandlerContext } from '@volter/world-core';
import type { PortalForm } from '@volter/world-ui';
import { flowPage, signedIn, toSignIn } from '@volter/world-ui';
import { sameAccount, API_TOKEN, permissionGroups, groupRef, makeApiToken, rollApiToken, r2Policy, publicToken, type Row, type R2Permission } from '../semantics/shared.ts';

/** A dashboard path as the page links it: under the place a World serves the twin at (the context's publicBase), so a link or a
 *  form stays in the World; the path itself on dash.cloudflare.com. */
export const at = (ctx: HandlerContext, path: string): string => `${new URL(ctx.publicBase).pathname.replace(/\/+$/, '')}${path}`;
export const safeReturn = (ctx: HandlerContext, path: string): string => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : at(ctx, '/profile/api-tokens');
export function person(ctx: HandlerContext): { email: string; id: string } | Response {
  const who = signedIn(ctx, 'cf_session');
  const user = who ? ctx.rowsRaw('cf_user').find(row => row.email === who.email) : undefined;
  const here = new URL(ctx.call.request.url);
  return who && user ? { email: who.email, id: String(user.id) } : toSignIn(at(ctx, '/login'), at(ctx, here.pathname + here.search));
}
export function memberships(ctx: HandlerContext, email: string): Row[] {
  return ctx.rowsRaw('account_member').filter(member => member.email === email && member.status === 'accepted');
}
export async function dashboardToken(ctx: HandlerContext, email: string, id: string, account: string | undefined,
  form: Record<string, string>, groups: string[]): Promise<{ notice: string } | Response> {
  const token = form.token_id ? ctx.row(API_TOKEN, form.token_id) : undefined;
  const accessible = (held: Row): boolean => account ? held._kind === 'account' && sameAccount(ctx, held._account, account) || held._kind === 'user' && held._owner === email : held._kind === 'user' && held._owner === email;
  if (['roll', 'delete'].includes(form.action ?? '')) {
    if (!token || !accessible(token)) return new Response('Token not found.', { status: 404 });
    if (form.action === 'delete') { await ctx.remove(API_TOKEN, String(token.id), 'api_token.delete'); return { notice: 'Token deleted.' }; }
    return { notice: `New token value (shown once): ${await rollApiToken(ctx, token)}` };
  }
  if (!form.name?.trim()) return new Response('A token name is required.', { status: 400 });
  let policies: Row[];
  if (account) {
    if (!['admin-rw', 'admin-ro', 'object-rw', 'object-ro'].includes(form.permission ?? '')) return new Response('Choose a valid permission.', { status: 400 });
    if (form.permission.startsWith('object') && !form.bucket?.trim()) return new Response('A bucket scope is required.', { status: 400 });
    policies = [r2Policy(account, form.permission as R2Permission, form.bucket || '*', form.jurisdiction || 'default')];
  } else {
    const selected = (form.groups || groups.join(',')).split(',').map(name => name.trim()).filter(Boolean);
    if (!selected.length || selected.some(name => !permissionGroups().some(group => group.name === name))) return new Response('Choose published permission groups.', { status: 400 });
    const selectedAccount = form.account_id;
    if (!selectedAccount || !memberships(ctx, email).some(member => sameAccount(ctx, member.account_id, selectedAccount))) return new Response('Choose one of your accounts.', { status: 403 });
    policies = [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${selectedAccount}`]: '*', [`com.cloudflare.api.user.${id}`]: '*' }, permission_groups: selected.map(groupRef) }];
  }
  const made = await makeApiToken(ctx, { name: form.name.trim(), kind: account && form.token_kind !== 'user' ? 'account' : 'user', owner: email, account, policies });
  return { notice: `Token value (shown once): ${made.value}; S3 Access Key ID: ${made.token.id}; Secret Access Key: ${ctx.crypto.sha256(made.value)}` };
}
export function shownTokens(ctx: HandlerContext, email: string, account?: string): Row[] {
  return ctx.rowsRaw(API_TOKEN).filter(token => account ? (token._kind === 'account' && sameAccount(ctx, token._account, account) || token._kind === 'user' && token._owner === email && JSON.stringify(token.policies).includes(account)) : token._kind === 'user' && token._owner === email).map(token => publicToken(ctx, token));
}

// Authored from Cloudflare's public dashboard screenshots, read 2026-10-08:
// https://developers.cloudflare.com/changelog/product-group/developer-platform/4/
// (protect-one-worker.BSpeeOry.png), and the application-list screenshot in
// https://blog.cloudflare.com/pages-and-workers-are-converging-into-one-experience/ .
// References inform navigation and layout only; no upstream page or asset is embedded.

export const DASHBOARD_CSS = `
*{box-sizing:border-box}body{margin:0;background:#fafafa;color:#1f1f1f;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default}button,a,input,select{outline-offset:3px}.cf-top{height:64px;border-bottom:1px solid #dedede;display:flex;align-items:center;justify-content:space-between;background:#fff;padding:0 24px;gap:16px}.cf-top strong{font-size:20px}.cf-top .cf-account{font-size:13px;color:#555}.cf-frame{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:calc(100vh - 64px)}.cf-sidebar{border-right:1px solid #dedede;padding:20px 14px;background:#fafafa}.cf-sidebar a,.cf-sidebar .cf-unavailable{display:block;padding:9px 12px;text-decoration:none;border-radius:7px;font-size:13px}.cf-sidebar a[aria-current=page]{background:#eee;font-weight:500}.cf-unavailable{color:#7d7d7d}.cf-sidebar h2{font-size:13px;color:#666;font-weight:400;margin:24px 12px 10px}.cf-subnav{padding-left:14px}.cf-main{min-width:0;padding:40px 44px}.cf-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:28px}.cf-heading h1{font-size:26px;line-height:1.3;font-weight:600;margin:0 0 8px}.cf-heading p{margin:0;color:#666;font-size:14px}.cf-button{display:inline-block;border:1px solid #d7d7d7;border-radius:6px;background:#fff;color:#1f1f1f;padding:8px 14px;text-decoration:none;white-space:nowrap;font-size:13px}.cf-button:hover:not(:disabled){background:#f1f1f1}.cf-primary{background:#0055dc;color:#fff;border-color:#0055dc}.cf-primary:hover:not(:disabled){background:#0047b8}.cf-button:disabled{color:#777;background:#f3f3f3}.cf-toolbar{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:20px}.cf-search{width:min(420px,100%);padding:9px 12px;border:1px solid #d7d7d7;border-radius:6px;background:#fff}.cf-count{color:#666;font-size:13px}.cf-applications{background:#fff;border:1px solid #dedede;border-radius:8px;overflow:hidden}.cf-app{padding:22px 24px;border-bottom:1px solid #e8e8e8}.cf-app:last-child{border-bottom:0}.cf-app-header{display:flex;align-items:center;justify-content:space-between;gap:20px}.cf-app h2{margin:0;font-size:17px;font-weight:600}.cf-badge{display:inline-block;font-size:11px;border:1px solid #dedede;border-radius:5px;color:#666;padding:2px 7px;margin-left:10px;font-weight:400}.cf-app p{margin:8px 0 0;color:#666;font-size:13px}.cf-domains{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}.cf-domains a{color:#0055dc;font-size:13px;text-decoration:none}.cf-domains a:hover{text-decoration:underline}.cf-empty{text-align:center;padding:56px 24px;color:#666}.cf-notice{padding:14px 16px;background:#fff;border:1px solid #dedede;border-radius:6px;margin-bottom:20px;overflow-wrap:anywhere}.cf-table-scroll{overflow-x:auto;background:#fff;border:1px solid #dedede;border-radius:8px}table{border-collapse:collapse;width:100%;text-align:left;white-space:nowrap}th{background:#f7f7f7;color:#555;font-size:12px;font-weight:500;padding:14px 20px;border-bottom:1px solid #dedede}td{font-size:13px;padding:16px 20px;border-bottom:1px solid #e8e8e8}tr:last-child td{border-bottom:0}.cf-actions{display:flex;gap:8px}.cf-actions form{margin:0}.cf-danger{color:#b42318}.cf-create-actions{display:flex;gap:10px;flex-wrap:wrap}dialog{border:1px solid #dedede;border-radius:10px;padding:28px;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;background:#fff;color:#1f1f1f}dialog::backdrop{background:rgba(0,0,0,.35)}dialog h2{margin:0 0 24px;font-size:22px}.cf-field{display:block;margin:0 0 20px;font-size:13px}.cf-field span{display:block;margin-bottom:7px}.cf-field input,.cf-field select{width:100%;padding:9px 12px;border:1px solid #d7d7d7;border-radius:5px;background:#fff;color:#1f1f1f}.cf-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:28px}[hidden]{display:none!important}@media(max-width:900px){.cf-frame{grid-template-columns:200px minmax(0,1fr)}.cf-main{padding:28px 24px}.cf-heading{flex-wrap:wrap}}@media(max-width:600px){.cf-top{padding:0 16px}.cf-frame{grid-template-columns:1fr}.cf-sidebar{border-right:0;border-bottom:1px solid #dedede;padding:8px 16px}.cf-sidebar .cf-unavailable,.cf-sidebar h2{display:none}.cf-subnav{padding:0;display:flex;flex-wrap:wrap}.cf-main{padding:24px 16px}.cf-app{padding:20px 16px}.cf-app-header{flex-wrap:wrap}.cf-heading h1{font-size:24px}}
`;
export const DASHBOARD_SCRIPT = `
document.querySelectorAll('[data-open-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.openDialog).showModal()));
document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
const search=document.querySelector('[data-application-search]');if(search)search.addEventListener('input',()=>{let count=0;document.querySelectorAll('[data-application-name]').forEach(row=>{row.hidden=!row.dataset.applicationName.toLowerCase().includes(search.value.toLowerCase());if(!row.hidden)count++});document.querySelector('[data-search-empty]').hidden=count!==0});
`;

type ScreenBody = Parameters<typeof flowPage>[0]['body'];
export function Dashboard({ ctx, account, accountName, active, children }: { ctx: HandlerContext; account?: string; accountName: string; active: 'workers' | 'r2' | 'profile'; children: ScreenBody | (ScreenBody | null)[] }) {
  const link = (path: string, label: string, selected = false) => <a href={at(ctx, path)} aria-current={selected ? 'page' : undefined}>{label}</a>;
  const unavailable = (label: string) => <span className="cf-unavailable" title="Outside this twin's declared screen scope">{label}</span>;
  return <><header className="cf-top"><strong>Cloudflare</strong><span className="cf-account">{accountName}</span>{link('/profile/api-tokens', 'My Profile', active === 'profile')}</header><div className="cf-frame"><nav className="cf-sidebar" aria-label="Cloudflare navigation">
    {unavailable('Account home')}{unavailable('Recents')}{unavailable('Domains')}
    <h2>Observe</h2>{unavailable('Investigate')}{unavailable('Analytics')}
    <h2>Build</h2>{unavailable('Compute')}<div className="cf-subnav">{account ? link(`/${account}/workers-and-pages`, 'Workers & Pages', active === 'workers') : null}{unavailable('Observability')}{unavailable('Workers for Platforms')}{unavailable('Containers')}{unavailable('Durable Objects')}{unavailable('Queues')}{unavailable('Workflows')}{unavailable('Browser Run')}</div>
    <h2>Storage & databases</h2><div className="cf-subnav">{unavailable('R2 Object Storage')}{account ? link(`/${account}/r2/api-tokens`, 'API Tokens', active === 'r2') : null}</div>
    {active === 'profile' ? <><h2>My Profile</h2>{unavailable('Preferences')}{link('/profile/api-tokens', 'API Tokens', true)}</> : null}
  </nav><main className="cf-main">{children}</main></div><script dangerouslySetInnerHTML={{ __html: DASHBOARD_SCRIPT }}/></>;
}

export function TokenPage({ ctx, title, account, accountName, notice, tokens, forms, action, deleteLabel }: { ctx: HandlerContext; title: string; account?: string; accountName: string; notice?: string; tokens: Record<string, unknown>[]; forms: PortalForm[]; action: string; deleteLabel: string }) {
  return <Dashboard ctx={ctx} account={account} accountName={accountName} active={account ? 'r2' : 'profile'}><div className="cf-heading"><div><h1>{title}</h1></div><div className="cf-create-actions">{forms.map((form, i) => <button key={i} className="cf-button cf-primary" type="button" data-open-dialog={`create-token-${i}`}>{form.submit.label}</button>)}</div></div>
    {notice ? <p className="cf-notice" role="status">{notice}</p> : null}
    <div className="cf-table-scroll"><table aria-label={title}><thead><tr><th scope="col">Token name</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{tokens.map(token => <tr key={String(token.id)}><td>{String(token.name)}</td><td>{String(token.status)}</td><td><div className="cf-actions"><form method="post" action={action}><input type="hidden" name="action" value="roll"/><input type="hidden" name="token_id" value={String(token.id)}/><button className="cf-button" type="submit">Roll</button></form><form method="post" action={action}><input type="hidden" name="action" value="delete"/><input type="hidden" name="token_id" value={String(token.id)}/><button className="cf-button cf-danger" type="submit">{deleteLabel}</button></form></div></td></tr>)}{!tokens.length ? <tr><td colSpan={3} className="cf-empty">No API tokens yet.</td></tr> : null}</tbody></table></div>
    {forms.map((form, i) => <dialog key={i} id={`create-token-${i}`} aria-labelledby={`token-title-${i}`}><h2 id={`token-title-${i}`}>{form.heading}</h2><form method="post" action={form.action}>{form.fields.map(field => <label className="cf-field" key={field.id}><span>{field.label}</span>{field.options ? <select name={field.id} defaultValue={field.value}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input name={field.id} defaultValue={field.value} placeholder={field.placeholder}/>}</label>)}<div className="cf-dialog-actions"><button className="cf-button" type="button" data-close-dialog>Cancel</button><button className="cf-button cf-primary" type="submit">{form.submit.label}</button></div></form></dialog>)}
  </Dashboard>;
}
