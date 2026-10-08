// The dashboard's Workers & Pages: the account's Workers, each with the Custom Domains it answers, as a person finds a
// deployed Worker and opens its site. A domain opens where the World shows it (twinSiteUrl): the site the twin serves,
// as Cloudflare would serve it.
import { twinSiteUrl, type HandlerContext } from '@volter/world-core';
import { flowPage } from '@volter/world-ui';
import { sameAccount, WORKER_DOMAIN, type Row } from '../semantics/shared.ts';
import { person, memberships } from './shared.tsx';
import { Dashboard, DASHBOARD_CSS } from './shared.tsx';

const SCRIPT = 'worker_script';

// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "In the Cloudflare dashboard, go to the Workers & Pages page."
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "Go to Account Home > Workers & Pages."
export async function screen(ctx: HandlerContext): Promise<Response> {
  const who = person(ctx); if (who instanceof Response) return who;
  const account = String(ctx.call.params.account_id ?? '');
  const member = memberships(ctx, who.email).find(m => sameAccount(ctx, m.account_id, account));
  if (!member) return new Response('Account access denied.', { status: 403 });
  // the account by either id: the World's own, and the real account's once a deploy adopted it (rows written before
  // name the first, rows the vendor answered the second)
  const ids = new Set([account, ctx.resolve('account', account)]);
  const domains = ctx.rowsRaw(WORKER_DOMAIN).filter(d => ids.has(String(d.account_id)) && d.deleted !== true);
  const workers = ctx.rowsRaw(SCRIPT).filter(s => ids.has(String(s.account_id)) && s.deleted !== true)
    .sort((a, b) => String(b.modified_on ?? '').localeCompare(String(a.modified_on ?? '')));
  const item = (s: Row) => {
    const own = domains.filter(d => d.service === s.name).map(d => String(d.hostname)).sort();
    const subdomain = ctx.rowsRaw('workers_subdomain').find(row => row.deleted !== true && ids.has(String(row.id)));
    if ((s.subdomain as { enabled?: boolean } | undefined)?.enabled && subdomain) own.push(`${String(s.name)}.${String(subdomain.subdomain)}.workers.dev`);
    return <article className="cf-app" key={String(s.id)} data-application-name={String(s.name)}><div className="cf-app-header"><h2>{String(s.name)}<span className="cf-badge">Worker</span></h2><span className="cf-count">{s.modified_on ? `Modified ${String(s.modified_on).slice(0, 10)}` : ''}</span></div>{own.length ? <div className="cf-domains">{own.map(host => <a key={host} href={twinSiteUrl(ctx.call.request, host)} aria-label={`Visit ${host}`}>{host}</a>)}</div> : <p>No Custom Domains</p>}</article>;
  };
  return flowPage({ title: 'Workers & Pages | Cloudflare', css: [DASHBOARD_CSS], body: <Dashboard ctx={ctx} account={account} accountName={String((member.account as Row | undefined)?.name ?? account)} active="workers">
    <div className="cf-heading"><div><h1>Workers & Pages</h1><p>Build and deploy serverless applications.</p></div><button type="button" className="cf-button cf-primary" disabled title="Dashboard application creation is outside this twin's declared screen scope. Deploy through the Workers API.">Create application</button></div>
    <div className="cf-toolbar"><input className="cf-search" type="search" aria-label="Search applications" placeholder="Search applications" data-application-search/><span className="cf-count">{workers.length} application{workers.length === 1 ? '' : 's'}</span></div>
    <section className="cf-applications" aria-label="Applications">{workers.map(item)}<p className="cf-empty" data-search-empty hidden={workers.length !== 0}>{workers.length ? 'No applications match your search.' : 'No applications yet.'}</p></section>
  </Dashboard> });
}
