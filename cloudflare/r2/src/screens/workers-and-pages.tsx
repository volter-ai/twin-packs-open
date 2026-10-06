// The dashboard's Workers & Pages: the account's Workers, each with the Custom Domains it answers, as a person finds a
// deployed Worker and opens its site. A domain opens where the World shows it (twinSiteUrl): the site the twin serves,
// as Cloudflare would serve it.
import { twinSiteUrl, type HandlerContext } from '@volter/world-core';
import { flowPage, Portal, PORTAL_CSS } from '@volter/world-ui';
import { sameAccount, WORKER_DOMAIN, type Row } from '../semantics/shared.ts';
import { person, memberships } from './shared.tsx';

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
  // Where the documentation stops: the page's columns are not recorded; a Worker shows its name, its domains and when it
  // was last deployed, and each domain opens the site
  const item = (s: Row) => {
    const own = domains.filter(d => d.service === s.name).map(d => String(d.hostname)).sort();
    return { title: String(s.name), detail: own.length ? own.join(', ') : 'No Custom Domains',
      note: s.modified_on ? `Modified ${String(s.modified_on)}` : undefined,
      actions: own.map(host => ({ label: `Visit ${host}`, action: twinSiteUrl(ctx.call.request, host), method: 'get' as const })) };
  };
  return flowPage({ title: 'Workers & Pages', css: [PORTAL_CSS], body: <Portal merchant={`Cloudflare · ${String((member.account as Row | undefined)?.name ?? account)}`}
    sections={[{ heading: 'Workers & Pages', empty: 'No Workers yet.', items: workers.map(item) }]} /> });
}
