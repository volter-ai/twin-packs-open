// GitHub's repository security advisories (https://docs.github.com/en/rest/security-advisories/repository-advisories):
// a draft a repository's maintainers write about a vulnerability in their code, named by its GHSA id, and published
// when the fix ships. The core lists a repository's advisories (by `state`); who may write one is engine/access.ts's.
import type { HandlerContext } from '@volter/world-core';
import { cweNames } from '../engine/cwes.ts';
import { cvssScore, cvssSeverity } from '../engine/cvss.ts';
import { account, actorLogin, bodyOf, fail, invalid, json, nowIso, repoOfPath, serial, type Row, shown, str, who } from './shared.ts';

/** The letters a GHSA id is written in ("GHSA-xxxx-xxxx-xxxx", each group four of them). Where the documentation
 *  stops: the alphabet is the one GitHub's ids are written in. */
const GHSA = '23456789cfghjmpqrvwx';

// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "Can be one of : critical , high , medium , low , null"
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "Can be one of : rubygems , npm , pip , maven , nuget , composer , go , rust , erlang , actions , pub , other , swift"
const ECOSYSTEMS = ['rubygems', 'npm', 'pip', 'maven', 'nuget', 'composer', 'go', 'rust', 'erlang', 'actions', 'pub', 'other', 'swift'];
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "Can be one of : published , closed , draft"
const STATES = ['published', 'closed', 'draft'];

/** An advisory's vulnerabilities as GitHub keeps them: each package (its ecosystem and name), the versions it affects
 *  and those that fix it. */
const vulnerabilitiesOf = (given: Row[]): Row[] => given.map((v) => {
  const pkg = (v.package as Row | undefined) ?? {};
  return { package: { ecosystem: pkg.ecosystem, name: pkg.name ?? null }, vulnerable_version_range: v.vulnerable_version_range ?? null, patched_versions: v.patched_versions ?? null, vulnerable_functions: (v.vulnerable_functions as unknown[] | undefined) ?? [] };
});

/** The CVSS an advisory carries: the vector its author gave, scored as the CVSS specification scores it, its severity
 *  the score's rating; none given, both null (where the documentation stops: the null pair is GitHub's answer for an
 *  advisory rated by severity alone). */
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "The CVSS vector that calculates the severity of the advisory. You must choose between setting this field or severity ."
// source: https://www.first.org/cvss/v3.1/specification-document "Roundup returns the smallest number , specified to 1 decimal place,"
function cvssOf(vector: string | undefined): { cvss: Row; cvss_severities: Row; severity?: string | null } {
  if (!vector) return { cvss: { vector_string: null, score: null }, cvss_severities: { cvss_v3: null, cvss_v4: null } };
  const score = cvssScore(vector) ?? null;
  return { cvss: { vector_string: vector, score }, cvss_severities: { cvss_v3: { vector_string: vector, score }, cvss_v4: null }, severity: score === null ? null : cvssSeverity(score) };
}

/** The credits given, each pending until its person accepts it (where the documentation stops: a credit's state is
 *  "accepted", "declined" or "pending", and the person credited is the one who accepts it). */
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "A list of users receiving credit for their participation in the security advisory."
const creditsDetailed = (ctx: HandlerContext, credits: Row[]): Row[] => credits.map((c) => ({ user: account(ctx, String(c.login)), type: c.type, state: 'pending' }));

/** security-advisories/create-repository-advisory: a draft advisory by a repository's admin or security manager — its
 *  summary, description, the vulnerable packages, and a severity or a CVSS vector, not both (201). */
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "In order to create a draft repository security advisory, the authenticated user must be a security manager or administrator of that repository."
export async function security_advisories_create_repository_advisory(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const summary = str(b.summary);
  const description = str(b.description);
  // source: https://docs.github.com/en/rest/security-advisories/repository-advisories "summary string Required"
  if (!summary) return invalid('RepositoryAdvisory', 'summary', 'missing_field');
  // source: https://docs.github.com/en/rest/security-advisories/repository-advisories "description string Required"
  if (!description) return invalid('RepositoryAdvisory', 'description', 'missing_field');
  // source: https://docs.github.com/en/rest/security-advisories/repository-advisories "vulnerabilities array of objects Required"
  if (!Array.isArray(b.vulnerabilities)) return invalid('RepositoryAdvisory', 'vulnerabilities', 'missing_field');
  const vulnerabilities = b.vulnerabilities as Row[];
  if (vulnerabilities.some((v) => !ECOSYSTEMS.includes(String((v.package as Row | undefined)?.ecosystem)))) return invalid('RepositoryAdvisory', 'ecosystem', 'invalid');
  // Where the documentation stops: "You must choose between setting this field or severity" names no words for both;
  // GitHub's are these
  if (str(b.severity) && str(b.cvss_vector_string)) return fail(ctx, 422, 'Cannot specify both severity and cvss_vector_string.');
  if (str(b.severity) && !SEVERITIES.includes(String(b.severity))) return invalid('RepositoryAdvisory', 'severity', 'invalid');
  // source: https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory "For a full list of CWEs, see the Common Weakness Enumeration from MITRE."
  // Where the documentation stops: GitHub names MITRE as the CWE list but specifies no answer for an unknown ID; use its 422 validation-error class.
  if (Array.isArray(b.cwe_ids) && b.cwe_ids.some((id) => !cweNames[String(id)])) return invalid('RepositoryAdvisory', 'cwe_ids', 'invalid');
  const seed = ctx.crypto.digest('sha256', await ctx.secret(`ghsa:${await serial(ctx, 'repository-advisory')}`), 'hex');
  const letters = [...seed.slice(0, 12)].map((h, i) => GHSA[(parseInt(h, 16) + i * 7) % GHSA.length]).join('');
  const ghsa = `GHSA-${letters.slice(0, 4)}-${letters.slice(4, 8)}-${letters.slice(8, 12)}`;
  const at = nowIso(ctx);
  const full = String(repo.full_name);
  const author = account(ctx, actorLogin(who(ctx)!));
  const scored = cvssOf(str(b.cvss_vector_string));
  const credits = ((b.credits as Row[] | undefined) ?? []).map((c) => ({ login: c.login, type: c.type }));
  const row = await ctx.write('repository-advisory', ghsa, {
    ghsa_id: ghsa, cve_id: str(b.cve_id) ?? null, url: `https://api.github.com/repos/${full}/security-advisories/${ghsa}`, html_url: `https://github.com/${full}/security/advisories/${ghsa}`,
    summary, description, severity: str(b.severity) ?? scored.severity ?? null, author, publisher: null, identifiers: [{ value: ghsa, type: 'GHSA' }, ...(str(b.cve_id) ? [{ value: b.cve_id, type: 'CVE' }] : [])],
    state: 'draft', created_at: at, updated_at: at, published_at: null, closed_at: null, withdrawn_at: null, submission: null, vulnerabilities: vulnerabilitiesOf(vulnerabilities),
    cvss: scored.cvss, cvss_severities: scored.cvss_severities, cwes: ((b.cwe_ids as string[] | undefined) ?? []).map((id) => ({ cwe_id: id, name: cweNames[id] })),
    cwe_ids: (b.cwe_ids as string[] | undefined) ?? [], credits, credits_detailed: creditsDetailed(ctx, credits), collaborating_users: [], collaborating_teams: [], private_fork: null, _repo: full,
  }, 'repository_advisory.created');
  return json(shown(ctx, row), 201);
}

/** security-advisories/update-repository-advisory: its text, severity, CVSS vector, packages and credits changed, or
 *  its state moved by the machine (states.ts) — a draft published (its publisher and published_at set) or closed, a
 *  closed one reopened as a draft. A severity is not set over a CVSS vector. */
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "In order to update any security advisory, the authenticated user must be a security manager or administrator of that repository,"
export async function security_advisories_update_repository_advisory(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const held = ctx.row('repository_advisory', String(ctx.call.params.ghsa_id ?? ''));
  if (!held || held._repo !== repo.full_name) return fail(ctx, 404, 'Not Found');
  const b = bodyOf(ctx);
  const at = nowIso(ctx);
  const fields: Row = { updated_at: at };
  for (const k of ['summary', 'description', 'cve_id'] as const) if (typeof b[k] === 'string') fields[k] = b[k];
  if (str(b.severity)) {
    if (!SEVERITIES.includes(String(b.severity))) return invalid('RepositoryAdvisory', 'severity', 'invalid');
    // source: spec:security-advisories/update-repository-advisory "Cannot update severity value when CVSS is set."
    if ((held.cvss as Row | null)?.vector_string) return fail(ctx, 422, 'Cannot update severity value when CVSS is set.');
    fields.severity = b.severity;
  }
  if (str(b.cvss_vector_string)) Object.assign(fields, cvssOf(String(b.cvss_vector_string)));
  // source: spec:/components/schemas/repository-advisory-update/properties/cwe_ids "A list of Common Weakness Enumeration (CWE) IDs."
  if (Array.isArray(b.cwe_ids)) {
    // Where the documentation stops: the request schema lists CWE IDs but gives no unknown-ID refusal; use GitHub’s 422 validation-error class.
    if (b.cwe_ids.some((id) => !cweNames[String(id)])) return invalid('RepositoryAdvisory', 'cwe_ids', 'invalid');
    fields.cwe_ids = b.cwe_ids; fields.cwes = b.cwe_ids.map((id) => ({ cwe_id: id, name: cweNames[String(id)] }));
  }
  if (Array.isArray(b.vulnerabilities)) fields.vulnerabilities = vulnerabilitiesOf(b.vulnerabilities as Row[]);
  if (Array.isArray(b.credits)) {
    const credits = (b.credits as Row[]).map((c) => ({ login: c.login, type: c.type }));
    Object.assign(fields, { credits, credits_detailed: creditsDetailed(ctx, credits) });
  }
  const state = str(b.state);
  if (state && state !== held.state) {
    if (!STATES.includes(state)) return invalid('RepositoryAdvisory', 'state', 'invalid');
    const refused = ctx.legal('repository-advisory', 'state', 'security-advisories/update-repository-advisory', String(held.state), state, String(held.ghsa_id));
    if (refused) return ctx.refuse(refused);
    fields.state = state;
    if (state === 'published') { fields.published_at = at; fields.publisher = account(ctx, actorLogin(who(ctx)!)); }
    if (state === 'closed') fields.closed_at = at;
    if (state === 'draft') fields.closed_at = null;
  }
  const row = await ctx.write('repository-advisory', String(held.ghsa_id), fields, state === 'published' ? 'repository_advisory.published' : 'repository_advisory.updated');
  return json(shown(ctx, row));
}
