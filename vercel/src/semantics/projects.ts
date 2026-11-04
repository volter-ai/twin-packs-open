// A project and its domains: the team's projects listed, a domain attached (a verification asked for only when another
// Vercel account holds its apex), read, listed, verified and removed.
import type { HandlerContext } from '@volter/world-core';
import { apexOf, DOMAIN, domainKey, fail, PROJECT, PROJECT_DOMAIN, pageOf, projectPage, type Row, scopeOf, teamDomain, VERCEL_NAMESERVERS, externalRecord, alreadyVerified, view } from './shared.ts';

const DOMAIN_NAME = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** The challenge a project domain answers when another account holds its apex: a TXT record at `_vercel.<apex>`. Where
 *  the documentation stops: the value's shape. */
// source: spec:addProjectDomain "verification"
const challengeOf = (ctx: HandlerContext, project: Row, name: string): Row[] => {
  const apex = apexOf(name);
  return [{ type: 'TXT', domain: `_vercel.${apex}`, value: `vc-domain-verify=${name},${ctx.crypto.digest('sha256', `verify:${String(project.id)}:${name}`).slice(0, 20)}`, reason: 'pending_domain_verification' }];
};

/** A project domain as Vercel answers it, read back after its write. */
const answer = (ctx: HandlerContext, key: string): Response => Response.json(view(ctx, ctx.row(PROJECT_DOMAIN, key)!));

/** `GET /v10/projects`: the team's projects, most recently updated first. */
// source: spec:getProjects "Allows to retrieve the list of projects of the authenticated user or team."
export async function getProjects(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const search = new URL(ctx.call.request.url).searchParams.get('search');
  // source: spec:getProjects "Search projects by the name field"
  const rows = ctx.rowsRaw(PROJECT).filter((p) => p.accountId === s.team.id && (!s.project || p.id === s.project.id) && (!search || String(p.name).includes(search)));
  const { items, pagination } = projectPage(ctx, rows);
  return Response.json({ projects: items.map((p) => view(ctx, p, true)), pagination });
}

/** `POST /v10/projects/{idOrName}/domains` `{ name, redirect? }`: the domain on the project, and its apex on the team. */
// source: spec:addProjectDomain "Add a domain to the project by passing its domain name and by specifying the project by either passing the project `id` or `name` in the URL."
export async function addProjectDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  const name = typeof b.name === 'string' ? b.name.toLowerCase() : '';
  if (!DOMAIN_NAME.test(name)) return fail(400, 'invalid_domain', `The domain "${name}" is not valid`);
  // source: spec:addProjectDomain "A domain cannot redirect to itself"
  if (typeof b.redirect === 'string' && b.redirect.toLowerCase() === name) return fail(400, 'bad_request', 'A domain cannot redirect to itself.');
  const project = s.project!;
  // the team's own projects: a domain one of them has is in use; one another team's project has is held elsewhere,
  // and waits on its TXT challenge as a domain another account holds does
  const teamProjects = new Set(ctx.rowsRaw(PROJECT).filter((p) => p.accountId === s.team.id).map((p) => p.id));
  const using = ctx.rowsRaw(PROJECT_DOMAIN).filter((d) => d.name === name);
  // source: spec:addProjectDomain "400"
  if (using.some((d) => d.projectId === project.id)) return fail(400, 'bad_request', 'The domain already exists on the project.');
  if (using.some((d) => teamProjects.has(d.projectId))) return fail(409, 'domain_already_in_use', `Cannot add ${name} since it's already in use by your account.`);
  const elsewhere = using.length > 0;
  const apex = apexOf(name);
  if (!teamDomain(ctx, s.team, apex)) {
    const id = ctx.mint('domain');
    await ctx.write(DOMAIN, id, { id, name: apex, serviceType: 'external', zone: false, verified: true, boughtAt: null, expiresAt: null, echMode: 'auto', userId: String(s.team._userId), creator: { id: String(s.team._userId), email: String(s.team._owner), username: String(s.team._owner).split('@')[0] }, nameservers: [], intendedNameservers: VERCEL_NAMESERVERS, customNameservers: [], createdAt: Date.parse(ctx.occurredAt), teamId: s.team.id, deleted: false }, 'domain.create');
  }
  const held = elsewhere || ctx.rowsRaw('_claimed').some((c) => c.domain === apex);
  const now = Date.parse(ctx.occurredAt);
  const key = domainKey(project, name);
  await ctx.write(PROJECT_DOMAIN, key, {
    name, apexName: apex, projectId: project.id, redirect: typeof b.redirect === 'string' ? b.redirect : null, redirectStatusCode: b.redirect ? (b.redirectStatusCode ?? 308) : null,
    gitBranch: typeof b.gitBranch === 'string' ? b.gitBranch : null, customEnvironmentId: typeof b.customEnvironmentId === 'string' ? b.customEnvironmentId : null, createdAt: now, updatedAt: now, verified: !held, ...(held ? { verification: challengeOf(ctx, project, name) } : {}), deleted: false,
  }, 'project_domain.create');
  return answer(ctx, key);
}

/** `GET /v9/projects/{idOrName}/domains`: the project's domains, newest first, filtered as the call asks. */
// source: spec:getProjectDomains "Retrieve the domains associated with a given project by passing either the project `id` or `name` in the URL."
export async function getProjectDomains(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const q = new URL(ctx.call.request.url).searchParams;
  const rows = ctx.rowsRaw(PROJECT_DOMAIN).filter((d) => d.projectId === s.project!.id
    // source: spec:getProjectDomains "Filters domains based on their verification status."
    && (q.get('verified') === null || String(d.verified === true) === q.get('verified'))
    // source: spec:getProjectDomains "Excludes redirect project domains when"
    && (q.get('redirects') !== 'false' || !d.redirect)
    // source: spec:getProjectDomains "Filters domains based on their redirect target."
    && (q.get('redirect') === null || d.redirect === q.get('redirect')));
  const { items, pagination } = pageOf(ctx, rows);
  return Response.json({ domains: items.map((d) => view(ctx, d)), pagination });
}

/** `GET /v9/projects/{idOrName}/domains/{domain}`. */
// source: spec:getProjectDomain "Get project domain by project id/name and domain name."
export async function getProjectDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const d = ctx.row(PROJECT_DOMAIN, domainKey(s.project!, String(ctx.call.params.domain).toLowerCase()));
  return d ? Response.json(view(ctx, d)) : fail(404, 'not_found', `The domain "${String(ctx.call.params.domain)}" was not found`);
}

/** `POST /v9/projects/{idOrName}/domains/{domain}/verify`: verified once the challenge's TXT record is set at the apex's
 *  DNS host; a verified domain answers as it is. */
// source: spec:verifyProjectDomain "Attempts to verify a project domain with `verified = false` by checking the correctness of the project domain's `verification` challenge."
export async function verifyProjectDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const key = domainKey(s.project!, String(ctx.call.params.domain).toLowerCase());
  const d = ctx.row(PROJECT_DOMAIN, key);
  if (!d) return fail(404, 'not_found', `The domain "${String(ctx.call.params.domain)}" was not found`);
  if (d.verified === true) return alreadyVerified(ctx, key, d);
  const challenge = ((d.verification as Row[] | undefined) ?? [])[0];
  const txt = challenge ? externalRecord(ctx, String(challenge.domain), 'TXT') : undefined;
  // Where the documentation stops: the refusal's code and words
  if (!challenge || !txt || txt.value !== challenge.value) {
    const refusal = ctx.legal('project_domain', 'verified', 'verifyProjectDomain', 'false', 'false', key);
    return fail(refusal?.status ?? 400, String(refusal?.code ?? 'missing_txt_record'), `Domain ${String(d.name)} was added to a different project. Please complete verification to add it to this project instead.`);
  }
  const refused = ctx.legal('project_domain', 'verified', 'verifyProjectDomain', 'false', 'true', key);
  if (refused) return fail(refused.status, String(refused.code ?? 'bad_request'), refused.message);
  await ctx.write(PROJECT_DOMAIN, key, { verified: true, verification: null, updatedAt: Date.parse(ctx.occurredAt) }, 'project_domain.verify');
  return answer(ctx, key);
}

/** `DELETE /v9/projects/{idOrName}/domains/{domain}`: the domain off the project; its apex stays the team's. */
// source: spec:removeProjectDomain "Remove a domain from a project by passing the domain name and by specifying the project by either passing the project `id` or `name` in the URL."
export async function removeProjectDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const key = domainKey(s.project!, String(ctx.call.params.domain).toLowerCase());
  if (!ctx.row(PROJECT_DOMAIN, key)) return fail(404, 'not_found', `The domain "${String(ctx.call.params.domain)}" was not found`);
  await ctx.remove(PROJECT_DOMAIN, key, 'project_domain.delete');
  return Response.json({});
}
