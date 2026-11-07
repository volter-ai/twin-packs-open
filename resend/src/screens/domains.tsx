// Resend's Domains page (resend.com/domains): the signed-in member's team's domains, Add Domain, and each domain's records
// to set at its DNS host with its verification. Adding and verifying are the API's own acts (semantics/shared.ts
// createDomain, verifyDomain) for the member's team. A World's generated seed calls them here (ADR 0033 §3,
// `domain.add` and `domain.verify`): the add answers the domain object with its records, as the dashboard's request
// does, and a browser's form submission is sent back to the page.
//
//   GET  /domains          the team's domains, each with its status and records, and the Add Domain form
//   POST /domains          domain (and region?): the domain added
//   POST /domains/verify   domain: its verification started; Resend checks its records at the DNS host (semantics/clock.ts)
//
// Where the documentation stops: the dashboard opens a domain on a page of its own and verifies it from there; the
// twin lists every domain on this page and names the one to verify by its name, the generated seed's body.
import type { HandlerContext } from '@volter/world-core';
import { formOf } from '@volter/world-ui';
import { createDomain, DOMAIN, invalid, type Row, signedInTeam, teamLabel, verifyDomain } from '../semantics/shared.ts';
import { accountPage, Badge } from './shared.tsx';

/** A browser's form submission, which is sent back to the page, as against the dashboard's own request for the object. */
const fromForm = (request: Request): boolean => (request.headers.get('accept') ?? '').includes('text/html');
const back = (): Response => new Response(null, { status: 303, headers: { location: '/domains' } });

function listing(label: string, domains: Row[], error?: string, status = 200): Response {
  return accountPage('Domains', <>
    <h1>Domains</h1>
    <p className="status">Team {label}</p>
    {error ? <p role="alert">{error}</p> : null}
    <form method="post" action="/domains"><label htmlFor="domain">Domain</label><input id="domain" name="domain" placeholder="updates.example.com"/><button type="submit">Add Domain</button></form>
    {domains.map((d) => <section key={String(d.id)} aria-label={String(d.name)}>
      <h2>{String(d.name)} <Badge value={d.status}/></h2>
      <table><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th></tr></thead>
        <tbody>{((d.records ?? []) as Row[]).map((r, i) => <tr key={i}><td>{String(r.type)}</td><td>{String(r.name)}</td><td>{String(r.value)}</td><td>{String(r.status)}</td></tr>)}</tbody></table>
      {d.status === 'verified' ? null : <form method="post" action="/domains/verify"><input type="hidden" name="domain" value={String(d.name)}/><button type="submit">Verify DNS Records</button></form>}
    </section>)}
  </>, status, true);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const team = signedInTeam(ctx);
  if (!team) return new Response(null, { status: 302, headers: { location: `/login?${new URLSearchParams({ next: '/domains' })}` } });
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const mine = (): Row[] => ctx.rowsRaw(DOMAIN).filter((d) => d._team === team && d.deleted !== true).reverse();
  if (request.method === 'GET' && path === '/domains') return listing(teamLabel(ctx, team), mine());
  if (request.method !== 'POST' || (path !== '/domains' && path !== '/domains/verify')) return new Response('Not Found', { status: 404 });
  const fields = formOf(ctx);
  const name = (fields.domain ?? '').trim().toLowerCase();
  let answer: Response;
  if (path === '/domains') answer = await createDomain(ctx, team, { name, ...(fields.region ? { region: fields.region } : {}) });
  else {
    const d = mine().find((x) => x.name === name);
    answer = d ? await verifyDomain(ctx, d) : invalid('Domain not found', 404, 'not_found');
  }
  if (!fromForm(request)) return answer;
  if (answer.ok) return back();
  return listing(teamLabel(ctx, team), mine(), String(((await answer.json()) as Row).message ?? 'The request was refused.'), answer.status);
}
