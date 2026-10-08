// What the console's pages share: its skin, its session cookie, and the page that sends a visitor to sign in.
import { flowPage, toSignIn } from '@volter/world-ui';
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;

export const COOKIE = 'upstash_twin_session';

export const SKIN = `
body { background: #fafafa; color: #18181b; }
.sign-in-mark { background: #00e9a3; border-radius: 8px; }
.sign-in-box { background: #ffffff; border-color: #e4e4e7; }
.sign-in-submit { background: #10b981; border-color: #10b981; color: #ffffff; }
.portal-side { background: #f4f4f5; border-right: 1px solid #e4e4e7; }
.portal-notice { background: #ecfdf5; border: 1px solid #10b981; font-family: ui-monospace, monospace; word-break: break-all; }
.portal-primary { background: #10b981; border-color: #10b981; color: #ffffff; }
`;

export const toLogin = (path: string, ctx?: HandlerContext): Response => toSignIn(ctx ? consolePath(ctx, '/login') : '/login', path);

/** Navigation stays under the public mount that served this vendor page. */
export function consolePath(ctx: HandlerContext, path: string): string {
  const base = new URL(ctx.publicBase).pathname.replace(/\/+$/, '');
  return base && (path === base || path.startsWith(`${base}/`)) ? path : `${base}${path}`;
}

// Authored from the database screenshot published in Upstash's Redis getting-started guide,
// read 2026-10-08. No vendor screenshot, DOM or scripts are shipped. Unmodeled metrics are omitted.
export const CONSOLE_CSS = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#18181b;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}button,a,input,select{outline-offset:3px}button{cursor:pointer;border:1px solid #e4e4e7;border-radius:6px;padding:8px 14px;background:#fff;color:inherit}button:disabled{cursor:default;color:#a1a1aa}.up-top{height:64px;padding:0 max(24px,calc((100vw - 1120px)/2));display:flex;align-items:center;gap:22px;background:#18181b;color:#fafafa}.up-wordmark{font-size:19px;font-weight:650;color:#59d5b3;letter-spacing:-.5px}.up-project{font-size:12px;padding:5px 10px;border:1px solid #3f3f46;border-radius:5px}.up-products{display:flex;gap:5px;margin:auto}.up-products a,.up-products button{padding:6px 12px;border:0;border-radius:6px;font-size:12px;background:none;color:#a1a1aa}.up-products [aria-current=page]{background:#fff;color:#18181b}.up-person{font-size:12px;white-space:nowrap}.up-banner{background:#f6f6f6;border-bottom:1px solid #ededed}.up-banner-inner{max-width:1120px;margin:auto;padding:24px}.up-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.up-heading h1{margin:0;font-size:23px;font-weight:600}.up-heading h1 a{color:#dc2626}.up-tags{display:flex;gap:8px;margin-top:12px;color:#71717a;font-size:12px}.up-tags span{background:#fff;border:1px solid #ededed;border-radius:5px;padding:3px 9px}.up-main{max-width:1120px;margin:auto;padding:0 24px 60px}.up-tabs{display:flex;gap:22px;border-bottom:1px solid #e4e4e7;margin:24px 0 30px}.up-tabs span,.up-tabs a{padding:12px 0;font-size:13px;color:#71717a}.up-tabs [aria-current=page]{color:#059669;border-bottom:2px solid #10b981}.up-primary{background:#00e9a3;border-color:#00e9a3;color:#18181b;font-weight:600}.up-card{border:1px solid #e4e4e7;border-radius:12px;padding:24px;margin:24px 0}.up-card h2{font-size:20px;font-weight:600;margin:0 0 4px}.up-muted{color:#71717a;font-size:13px}.up-notice{border:1px solid #e4e4e7;padding:12px 16px;border-radius:8px;margin:24px 0}.up-notice[role=alert]{color:#b91c1c}.up-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.up-database{display:block;border:1px solid #e4e4e7;border-radius:10px;padding:20px}.up-database[hidden]{display:none}.up-database:hover{border-color:#10b981}.up-database strong{display:block;font-size:17px;margin-bottom:10px}.up-search{width:260px;max-width:100%;padding:8px 12px;border:1px solid #e4e4e7;border-radius:6px;margin-bottom:20px}.up-connection{display:grid;grid-template-columns:2fr 2fr 1fr 1fr;gap:22px}.up-connection small{display:block;color:#71717a;margin-bottom:5px}.up-connection code{font-size:12px;overflow-wrap:anywhere}.up-env{background:#f5f7f7;border:1px solid #e4e4e7;border-radius:7px;margin-top:18px;overflow:hidden}.up-env-header{padding:10px 16px;border-bottom:1px solid #e4e4e7;display:flex;justify-content:space-between;gap:20px;color:#059669;font-size:12px}.up-env-row{display:flex;align-items:center;gap:10px;padding:9px 16px;font:12px ui-monospace,SFMono-Regular,monospace}.up-env-row label{min-width:220px}.up-env-row input{min-width:0;flex:1;border:0;background:transparent;color:#059669;font:inherit}.up-env-row button{font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px 8px}.up-danger{color:#b91c1c}.up-field{display:block;margin:20px 0}.up-field span{display:block;margin-bottom:6px;font-size:13px}.up-field input,.up-field select{width:100%;border:1px solid #d4d4d8;border-radius:6px;padding:9px 12px;background:#fff}.up-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}dialog{border:1px solid #e4e4e7;border-radius:12px;padding:26px;width:min(480px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto}dialog::backdrop{background:rgba(0,0,0,.4)}dialog h2{font-size:21px;margin:0 0 20px}@media(max-width:850px){.up-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.up-connection{grid-template-columns:repeat(2,minmax(0,1fr))}.up-person{display:none}.up-products{margin-left:auto;margin-right:0}.up-project{display:none}}@media(max-width:560px){.up-top{padding:0 16px;gap:12px}.up-products button{display:none}.up-grid{grid-template-columns:1fr}.up-main,.up-banner-inner{padding-left:16px;padding-right:16px}.up-tabs{gap:14px;overflow:auto;white-space:nowrap}.up-env-row{flex-wrap:wrap}.up-env-row label{min-width:100%;}.up-heading{align-items:flex-start}.up-heading h1{font-size:20px}}
`;

export function consolePage(ctx: HandlerContext, person: Row, body: Parameters<typeof flowPage>[0]['body'], notice?: string, status = 200): Response {
  return flowPage({ title: 'Redis | Upstash Console', css: [CONSOLE_CSS], status, body: <>
    <header className="up-top"><a className="up-wordmark" href={consolePath(ctx, '/redis')}>Upstash</a><span className="up-project">Personal</span><nav className="up-products" aria-label="Products"><a href={consolePath(ctx, '/redis')} aria-current="page">Redis</a><a href={consolePath(ctx, '/qstash')}>QStash</a>{['Workflow', 'Vector', 'Box'].map(label => <button key={label} type="button" disabled title="Outside this twin’s declared screen scope">{label}</button>)}</nav><span className="up-person">{String(person.email)}</span></header>
    {notice ? <div className="up-main"><p className="up-notice" role={status >= 400 ? 'alert' : 'status'}>{notice}</p></div> : null}{body}
    <script dangerouslySetInnerHTML={{ __html: `document.querySelectorAll('[data-open-dialog]').forEach(b=>b.addEventListener('click',()=>document.getElementById(b.dataset.openDialog).showModal()));document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));document.querySelectorAll('[data-reveal]').forEach(b=>b.addEventListener('click',()=>{const f=document.getElementById(b.dataset.reveal);f.type=f.type==='password'?'text':'password';b.textContent=f.type==='password'?'Show':'Hide';}));document.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',async()=>{const f=document.getElementById(b.dataset.copy);try{await navigator.clipboard.writeText(f.value);b.textContent='Copied';}catch{f.focus();f.select();b.textContent='Select and copy';}}));const search=document.querySelector('[data-database-search]');if(search)search.addEventListener('input',()=>document.querySelectorAll('[data-database-name]').forEach(d=>d.hidden=!d.dataset.databaseName.includes(search.value.toLowerCase())));` }}/>
  </> });
}

/** A page is opened with GET, and its forms post to it. The twin's own answer for any other method: 405. */
export const notAllowed = (): Response => new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET, POST' } });
