// What GitHub's handlers share: GitHub's answers and refusals, who is calling (a personal access token, an OAuth or App
// user token, an App's JWT, an installation's or a workflow run's token) and the role they hold in a repository, the
// repository a path names and its children (under it by `_repo`, its full name), the git plane its code lives in
// (ctx.git), and what a change of a branch sets off — pull requests following their head, workflows run, issues closed,
// alerts updated. What a write sends to hooks and Apps is the manifest's declared events.
import { git, jwtDecode, passwordHash, sha256, type HandlerContext, type WriteHookContext } from '@volter/world-core';
import { type Association, atLeast, closingNumbers, commentShape, DEFAULT_LABELS, issueShape, labelShape, LICENSES, nodeId, pullShape, repositoryShape, type Role, roleOf, simpleOrg, simpleUser, userShape } from '../engine/objects.ts';
import { readWorkflow, runsOn, type Trigger, type Workflow } from '../engine/workflows.ts';

export type Row = Record<string, unknown>;
const { decodeCommit, decodeTree, diffFiles, encodeCommit, encodeTree, sortTreeEntries, mergeBase, mergeText, isAncestor, ZERO_SHA } = git;

// ── answers ─────────────────────────────────────────────────────────────────────────────────────

/** GitHub's error: its status and message. */
export const fail = (ctx: HandlerContext, status: number, message: string): Response => ctx.refuse({ status, message });
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "GitHub uses a 404 Not Found response instead of a 403 Forbidden response to avoid confirming the existence of private repositories."
export const notFound = (ctx: HandlerContext): Response => fail(ctx, 404, 'Not Found');
/** GitHub's "Validation Failed", naming the resource, the field and the code
 *  (https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#validation-failed). */
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "If your request could not be processed, you may receive a 422 Unprocessable Entity response and a "Validation Failed" error message. The response body will include an errors property, which includes a code property to help you diagnose the problem."
export const invalid = (resource: string, field: string, code: string, message?: string): Response =>
  Response.json({ message: 'Validation Failed', errors: [{ resource, field, code, ...(message ? { message } : {}) }], documentation_url: 'https://docs.github.com/rest', status: '422' }, { status: 422 });
export const json = (answer: unknown, status = 200): Response => Response.json(answer, { status });
export const noContent = (): Response => new Response(null, { status: 204 });
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
export const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
/** The World's now as GitHub writes a time (ISO 8601, whole seconds). */
export const nowIso = (ctx: HandlerContext): string => new Date(Date.parse(ctx.occurredAt)).toISOString().replace(/\.\d{3}Z$/, 'Z');
export const nowSeconds = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);
/** A new subject's id, minted from the tree (GitHub's ids are numbers). */
export const mint = (ctx: HandlerContext, resource: string): number => Number(ctx.mint(resource));
/** A page of a list (`per_page` to 100, `page` from 1). */
// source: https://docs.github.com/en/rest/issues/issues "The number of results per page (max 100)."
export function page<T>(ctx: HandlerContext, all: T[]): T[] {
  const per = Math.min(Number(ctx.params.per_page ?? 30) || 30, 100);
  const n = Math.max(Number(ctx.params.page ?? 1) || 1, 1);
  return all.slice((n - 1) * per, n * per);
}
/** A subject as GitHub answers it: a stored row's own fields (the kernel's `id`, `type` and `updatedAt` given back to
 *  the vendor's own, as the core renders one), bookkeeping (`_`) left out. A write's answer is rendered already. */
export const shown = (ctx: Pick<HandlerContext, 'render'>, r: Row, resource?: string): Row => ctx.render(r, resource);

// ── accounts ────────────────────────────────────────────────────────────────────────────────────

/** A new account's id: GitHub's people, bots and organizations share one id space; accounts are kept by their login,
 *  so each id is minted from `_account`, one numbered subject per account. */
export async function accountId(ctx: HandlerContext, login: string): Promise<number> {
  const n = mint(ctx, '_account');
  await ctx.record('_account', { login }, String(n));
  return n;
}

/** A fresh number for a credential, a session or a code the World issues: each draw is its own numbered subject of
 *  `_serial`, minted from the tree. */
export async function serial(ctx: HandlerContext, what: string): Promise<number> {
  const n = mint(ctx, '_serial');
  await ctx.record('_serial', { what }, String(n));
  return n;
}

/** A person's account, made the first time the World names them (their account exists outside the World); the fields
 *  given are set on it either way. */
export async function ensureUser(ctx: HandlerContext, login: string, fields: Row = {}): Promise<Row> {
  if (login.endsWith('[bot]') && !ctx.row('user', login)) return ensureBot(ctx, login.slice(0, -'[bot]'.length), login === 'github-actions[bot]' ? 41898282 : undefined);
  const held = ctx.row('user', login);
  if (held) return Object.keys(fields).length ? ctx.write('user', login, fields, 'user.edit') : held;
  return ctx.write('user', login, { ...userShape(login, await accountId(ctx, login), nowIso(ctx)), ...fields }, 'user.create');
}

/** The bot an App or GitHub Actions acts as (`<slug>[bot]`; GitHub Actions' is `github-actions[bot]`, 41898282). */
// Where the documentation stops: 41898282 is the id GitHub gives github-actions[bot], as its commits' noreply address shows it
export async function ensureBot(ctx: HandlerContext, slug: string, id?: number): Promise<Row> {
  const login = `${slug}[bot]`;
  return ctx.row('user', login) ?? ctx.write('user', login, userShape(login, id ?? 100_000_000 + (await accountId(ctx, login)), nowIso(ctx), 'Bot'), 'user.create');
}

/** An account's simple form, as other objects embed it: a person's or an organization's. */
// source: spec:/components/schemas/simple-user/properties/id "integer"
export function account(ctx: HandlerContext, login: string): Row {
  const u = ctx.row('user', login);
  if (u) return simpleUser(ctx.own(u));
  const o = ctx.row('org', login);
  return o ? { ...simpleUser({ ...ctx.own(o), type: 'Organization' }), ...simpleOrg(ctx.own(o)), type: 'Organization' } : simpleUser({ login, id: 0 });
}

// ── who is calling (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api) ─────────────

export type Caller =
  | { kind: 'user'; login: string; scopes: '*' | string[]; token: string }
  | { kind: 'app'; app: Row }
  | { kind: 'installation'; app: Row; installation: Row; permissions: Row; token: string; repositories?: string[] }
  | { kind: 'actions'; run: Row; permissions: Row; token: string };

export const TOKENS = '_token';
export const tokenKey = (token: string): string => sha256(token);

/** The credential a request carries: `Authorization: Bearer <t>` or `token <t>`. */
// source: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api "In most cases, you can use Authorization: Bearer or Authorization: token to pass a token. However, if you are passing a JSON web token (JWT), you must use Authorization: Bearer ."
export const credentialOf = (request: Request): string | undefined => /^(?:bearer|token)\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1];

/** Who a credential names, undefined for none, or `bad` for one GitHub does not take (401; where the documentation
 *  stops, "Bad credentials" are GitHub's words). A person's token is one the World issued them (a personal access token,
 *  an OAuth app's, a GitHub App's on their behalf); an App's JWT names the App by its client id or id (`iss`), is signed
 *  with the private key its registration handed it (checked against the public half the World kept), and is good until
 *  its `exp`, which is no more than ten minutes ahead. */
// source: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api "Authenticating with invalid credentials will initially return a 401 Unauthorized response."
// source: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app "The expiration time of the JWT, after which it can't be used to request an installation token. The time must be no more than 10 minutes into the future."
// source: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app "The client ID or application ID of your GitHub App. This value is used to find the right public key to verify the signature of the JWT."
export function callerOf(ctx: WriteHookContext, given?: string): Caller | 'bad' | undefined {
  const token = given ?? credentialOf(ctx.call.request);
  if (!token) return undefined;
  if (token.split('.').length === 3 && token.startsWith('eyJ')) {
    let claims: Row;
    try { claims = jwtDecode(token).payload as Row; } catch { return 'bad'; }
    const app = ctx.rowsRaw('app').find((a) => a.client_id === String(claims.iss ?? '') || String(a.id) === String(claims.iss ?? ''));
    if (!app || typeof app._public_pem !== 'string' || !(Number(claims.exp) > nowSeconds(ctx)) || Number(claims.exp) - nowSeconds(ctx) > 600) return 'bad';
    // the signature, at the token's own instant (the World's clock is checked against `exp` above, as GitHub checks it)
    if (!ctx.crypto.jwtVerify(token, ctx.crypto.jwks(app._public_pem), { now: Number(claims.exp) - 1 }).valid) return 'bad';
    return { kind: 'app', app };
  }
  const kept = ctx.row(TOKENS, tokenKey(token));
  if (!kept || kept.revoked === true || (typeof kept.expires === 'number' && kept.expires <= nowSeconds(ctx))) return 'bad';
  // a person's token they made, one an OAuth app got from them (`gho_`), or one a GitHub App got to act for them (`ghu_`)
  // source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "OAuth access token gho_"
  // source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "User access token for a GitHub App ghu_"
  if (kept.kind === 'pat' || kept.kind === 'oauth' || kept.kind === 'user_app') return { kind: 'user', login: String(kept.login), scopes: kept.kind === 'user_app' ? '*' : ((kept.scopes as string[]) ?? []), token };
  if (kept.kind === 'installation') {
    const installation = ctx.row('installation', String(kept.installation));
    const app = installation ? ctx.row('app', String(installation.app_id)) : undefined;
    if (!installation || !app) return 'bad';
    return { kind: 'installation', app, installation, permissions: (kept.permissions as Row) ?? {}, token, ...(Array.isArray(kept.repositories) ? { repositories: kept.repositories as string[] } : {}) };
  }
  if (kept.kind === 'actions') {
    const run = ctx.row('workflow_run', String(kept.run));
    if (!run || run.status === 'completed') return 'bad';
    return { kind: 'actions', run, permissions: (kept.permissions as Row) ?? {}, token };
  }
  return 'bad';
}

/** The caller a handler acts for (around.ts has refused a bad credential). */
export function who(ctx: WriteHookContext): Caller | undefined {
  const c = callerOf(ctx);
  return c === 'bad' ? undefined : c;
}

/** The login a caller acts as: a person, an App's bot, or `github-actions[bot]`. */
export function actorLogin(c: Caller): string {
  if (c.kind === 'user') return c.login;
  if (c.kind === 'actions') return 'github-actions[bot]';
  return `${String(c.app.slug)}[bot]`;
}

/** Whether a person's token holds a scope (their own holds all; `repo` holds the lesser repository scopes; `admin:org`
 *  the lesser organization scopes). */
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "repo:status Grants read/write access to commit statuses in public and private repositories."
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "public_repo Limits access to public repositories."
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "admin:org Fully manage the organization and its teams, projects, and memberships."
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "write:org Read and write access to organization membership and organization projects."
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "user Grants read/write access to profile info only. Note that this scope includes user:email and user:follow ."
export function hasScope(c: Caller, scope: string): boolean {
  if (c.kind !== 'user') return false;
  if (c.scopes === '*' || c.scopes.includes(scope)) return true;
  if (scope === 'public_repo' || scope === 'repo:status' || scope === 'repo_deployment') return c.scopes.includes('repo');
  if (scope === 'read:org') return c.scopes.includes('write:org') || c.scopes.includes('admin:org');
  if (scope === 'write:org') return c.scopes.includes('admin:org');
  if (scope === 'read:user' || scope === 'user:email') return c.scopes.includes('user');
  return false;
}

/** A token the World issues: its prefix, then letters drawn from a secret the World holds (ctx.secret) for what it is
 *  for; kept by its digest. */
// source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "Personal access token (classic) ghp_"
// source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "Installation access token for a GitHub App ghs_"
export async function issueToken(ctx: HandlerContext, prefix: string, fields: Row): Promise<string> {
  const n = await serial(ctx, 'token');
  const token = `${prefix}${ctx.crypto.digest('sha256', await ctx.secret(`${prefix}:${n}:${ctx.occurredAt}:${JSON.stringify(fields)}`), 'hex').slice(0, 36)}`;
  await ctx.record(TOKENS, { ...fields, created: nowSeconds(ctx) }, tokenKey(token));
  return token;
}

// ── repositories and roles ────────────────────────────────────────────────────────────────────────

/** A repository by its owner and name, as GitHub matches them (without regard to case). */
// source: https://docs.github.com/en/rest/repos/repos "The name of the repository without the .git extension. The name is not case sensitive."
export function repoNamed(ctx: HandlerContext, owner: string, name: string): Row | undefined {
  const full = `${owner}/${name}`.toLowerCase();
  return ctx.rowsRaw('repository').find((r) => String(r.full_name).toLowerCase() === full);
}

/** The repository a path names (around.ts has found it and the caller's role there). */
export const repoOfPath = (ctx: HandlerContext): Row => repoNamed(ctx, String(ctx.call.params.owner ?? ''), String(ctx.call.params.repo ?? ''))!;

/** A repository's owner's login. */
export const ownerOf = (repo: Row): string => String((repo.owner as Row).login);

/** A person's membership of an organization (`<org>::<login>`). */
export const membershipOf = (ctx: HandlerContext, org: string, login: string): Row | undefined => ctx.row('org_membership', `${org}::${login}`);

/** The role a caller holds in a repository: its owner admin; an organization's active owners admin; a team's; an
 *  organization's members read (the base permission an organization starts with); anyone read on a public one; an
 *  installation's App what it was granted where it is installed; a workflow run's token in its own repository. */
// source: https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization "Read: Recommended for non-code contributors who want to view or discuss your project"
// source: https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization "Triage: Recommended for contributors who need to proactively manage issues, discussions, and pull requests without write access"
export function roleIn(ctx: HandlerContext, repo: Row, c: Caller | undefined): Role | undefined {
  const publicRead: Role | undefined = repo.private === true ? undefined : 'read';
  if (!c) return publicRead;
  const write = (p: Row, key: string): Role => (p[key] === 'write' || p[key] === 'admin' ? 'write' : 'read');
  if (c.kind === 'actions') return String(c.run._repository_id) === String(repo.id) ? write(c.permissions, 'contents') : publicRead;
  if (c.kind === 'installation') {
    const i = c.installation;
    const covers = (i.repository_selection === 'all' ? String((i.account as Row).login) === ownerOf(repo) : ((i._repository_ids as string[] | undefined) ?? []).includes(String(repo.id)))
      && (!c.repositories || c.repositories.includes(String(repo.id)));
    return covers ? write(c.permissions, 'contents') : publicRead;
  }
  if (c.kind === 'app') return publicRead;
  const login = c.login;
  const owner = ownerOf(repo);
  if (owner === login) return 'admin';
  const org = ctx.row('org', owner);
  const m = org ? membershipOf(ctx, owner, login) : undefined;
  if (m?.state === 'active' && m.role === 'admin') return 'admin';
  const roles: Role[] = [];
  if (org) {
    for (const tr of ctx.rowsRaw('team_repo').filter((x) => x._repository_id === String(repo.id))) {
      const tm = ctx.row('team_member', `${String(tr._team)}::${login}`);
      const role = roleOf(tr.permission);
      if (tm?.state === 'active' && role) roles.push(role);
    }
    if (m?.state === 'active') roles.push('read');
  }
  if (publicRead) roles.push(publicRead);
  return roles.sort((a, b) => (atLeast(a, b) ? -1 : 1))[0];
}

/** A new repository of an account (GraphQL's createRepository, REST's create in an organization): its name free there
 *  (where the documentation stops, "name already exists on this account" are GitHub's words), its README and license
 *  committed when asked, GitHub's default labels. */
// source: https://docs.github.com/en/rest/repos/repos "Pass true to create an initial commit with empty README."
// source: https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels "Default labels are included in every new repository when the repository is created, but you can edit or delete the labels later."
export async function makeRepo(ctx: HandlerContext, owner: string, caller: Caller, f: { name?: string; private?: boolean; description?: string | null; homepage?: string | null; has_issues?: unknown; has_projects?: unknown; has_wiki?: unknown; has_discussions?: unknown; license?: string; auto_init?: boolean }): Promise<Row | Response> {
  const name = str(f.name);
  if (!name) return invalid('Repository', 'name', 'missing_field');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(name)) return invalid('Repository', 'name', 'invalid');
  if (repoNamed(ctx, owner, name)) return invalid('Repository', 'name', 'custom', 'name already exists on this account');
  const license = str(f.license);
  const id = mint(ctx, 'full-repository');
  const repo = await ctx.write('repository', String(id), {
    ...repositoryShape(id, name, account(ctx, owner), { private: f.private === true, description: f.description ?? null, homepage: f.homepage ?? null, has_issues: f.has_issues, has_projects: f.has_projects, has_wiki: f.has_wiki, has_discussions: f.has_discussions, license }, nowIso(ctx)),
    _creator: actorLogin(caller),
  }, 'repository.created');
  for (const l of DEFAULT_LABELS) {
    const lid = mint(ctx, 'label');
    await ctx.write('label', String(lid), { ...labelShape(lid, String(repo.full_name), { ...l, default: true }), _repo: repo.full_name }, 'label.create');
  }
  if (f.auto_init === true || license) {
    const by = actorLogin(caller);
    const u = ctx.row('user', by);
    const files: Record<string, string> = { 'README.md': `# ${name}\n${f.description ? `${f.description}\n` : ''}` };
    if (license && LICENSES[license]) files.LICENSE = LICENSES[license]!.text(new Date(Date.parse(ctx.occurredAt)).getUTCFullYear(), String(ctx.row('user', owner)?.name ?? owner));
    await commitFiles(ctx, repo, 'main', { message: 'Initial commit', author: { name: String(u?.name ?? by), email: String(u?.email ?? `${by}@users.noreply.github.com`) }, actor: by, files });
  }
  return ctx.row('repository', String(id))!;
}

// ── rulesets (https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) ──

/** A ref against one `ref_name` pattern: `~ALL`, `~DEFAULT_BRANCH`, or an fnmatch pattern over the full ref (`*` within
 *  a segment, `**` across them) or the name under refs/heads/ or refs/tags/. */
// source: https://docs.github.com/en/rest/repos/rules "Array of ref names or patterns to include. One of these patterns must match for the condition to pass. Also accepts ~DEFAULT_BRANCH to include the default branch or ~ALL to include all branches."
// source: https://docs.github.com/en/rest/repos/rules "Array of ref names or patterns to exclude. The condition will not pass if any of these patterns match."
function refMatches(pattern: string, ref: string, repo: Row): boolean {
  if (pattern === '~ALL') return true;
  if (pattern === '~DEFAULT_BRANCH') return ref === `refs/heads/${String(repo.default_branch ?? 'main')}`;
  const full = /^refs\//.test(pattern) ? pattern : `${ref.startsWith('refs/tags/') ? 'refs/tags/' : 'refs/heads/'}${pattern}`;
  const re = new RegExp(`^${full.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(ref);
}

/** Whether a caller is on a ruleset's bypass list: an organization's admins (`OrganizationAdmin`), a repository role
 *  (`RepositoryRole`, the admin role's id 5), a team's members (`Team`), an App (`Integration`). */
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "When you create a ruleset, you can allow certain users to bypass the rules in the ruleset. This can be users with certain roles, specific teams, or GitHub Apps."
function bypasses(ctx: HandlerContext, repo: Row, set: Row, c: Caller | undefined): boolean {
  if (!c) return false;
  for (const b of (set.bypass_actors as Row[] | undefined) ?? []) {
    const type = String(b.actor_type);
    if (c.kind === 'user') {
      if (type === 'OrganizationAdmin' && membershipOf(ctx, ownerOf(repo), c.login)?.role === 'admin') return true;
      if (type === 'RepositoryRole' && Number(b.actor_id) === 5 && roleIn(ctx, repo, c) === 'admin') return true;
      if (type === 'Team' && ctx.row('team_member', `${String(b.actor_id)}::${c.login}`)?.state === 'active') return true;
    }
    if (type === 'Integration' && c.kind === 'installation' && String(c.installation.app_id) === String(b.actor_id)) return true;
  }
  return false;
}

/** The rules of a repository's active rulesets that target a ref and that a caller may not bypass, each with its
 *  ruleset (`target` branch or tag, `conditions.ref_name` include and exclude). */
export function rulesOn(ctx: HandlerContext, repo: Row, ref: string, c: Caller | undefined): Row[] {
  const kind = ref.startsWith('refs/tags/') ? 'tag' : 'branch';
  const out: Row[] = [];
  for (const set of ctx.rowsRaw('repository_ruleset').filter((r) => r._repo === repo.full_name && r.enforcement === 'active' && String(r.target ?? 'branch') === kind)) {
    const names = ((set.conditions as Row | undefined)?.ref_name as Row | undefined) ?? {};
    const include = (names.include as string[] | undefined) ?? [];
    const exclude = (names.exclude as string[] | undefined) ?? [];
    if (!include.some((p) => refMatches(p, ref, repo)) || exclude.some((p) => refMatches(p, ref, repo))) continue;
    if (bypasses(ctx, repo, set, c)) continue;
    for (const rule of (set.rules as Row[] | undefined) ?? []) out.push({ ...rule, _ruleset: set });
  }
  return out;
}

/** A push a ruleset refuses: a deletion under "Restrict deletions", a force push under "Block force pushes", a change of
 *  an existing branch that takes changes through pull requests, an update or a creation restricted. Where the
 *  documentation stops (the remote's words): git is told "GH013: Repository rule violations found" with each rule broken. */
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "If selected, only users with bypass permissions can delete branches or tags whose name matches the pattern you specify."
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "If selected, only users with bypass permissions can create branches or tags whose name matches the pattern you specify."
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "If selected, only users with bypass permissions can push to branches or tags whose name matches the pattern you specify."
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "You can require that all changes to the target branch be associated with a pull request."
export function rulesetPushRefusal(ctx: HandlerContext, repo: Row, c: Caller | undefined, cmd: { name: string; old: string; new: string; fastForward: boolean }): string | null {
  const rules = rulesOn(ctx, repo, cmd.name, c);
  if (!rules.length) return null;
  const branch = cmd.name.startsWith('refs/heads/');
  const made = cmd.old === ZERO_SHA;
  const gone = cmd.new === ZERO_SHA;
  const broken = new Set<string>();
  for (const r of rules) {
    const type = String(r.type);
    if (type === 'deletion' && gone) broken.add(branch ? 'Cannot delete this branch' : 'Cannot delete this protected ref.');
    if (type === 'non_fast_forward' && !made && !gone && !cmd.fastForward) broken.add(branch ? 'Cannot force-push to this branch' : 'Cannot force-push to this protected ref.');
    if (type === 'pull_request' && branch && !made && !gone) broken.add('Changes must be made through a pull request.');
    if (type === 'update' && !made && !gone) broken.add('Cannot update this protected ref.');
    if (type === 'creation' && made) broken.add('Cannot create ref due to creations being restricted.');
  }
  if (!broken.size) return null;
  return `GH013: Repository rule violations found for ${cmd.name}.\nReview all repository rules at https://github.com/${String(repo.full_name)}/rules?ref=${encodeURIComponent(cmd.name)}\n\n- ${[...broken].join('\n- ')}`;
}

/** The approving reviews a pull request's base asks for under a ruleset's pull request rule (the most any asks), and
 *  whether a push dismisses the stale ones ("dismiss_stale_reviews_on_push"); undefined when no rule asks. */
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "require that all pull requests receive a specific number of approving reviews before someone merges the pull request"
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "Optionally, you can choose to dismiss stale pull request approvals when commits are pushed that affect the diff in the pull request."
export function rulesetApprovals(ctx: HandlerContext, repo: Row, base: string, c: Caller | undefined): { count: number; stale: boolean } | undefined {
  const asked = rulesOn(ctx, repo, `refs/heads/${base}`, c).filter((r) => r.type === 'pull_request').map((r) => (r.parameters as Row | undefined) ?? {});
  if (!asked.length) return undefined;
  return { count: Math.max(...asked.map((a) => Number(a.required_approving_review_count ?? 0))), stale: asked.some((a) => a.dismiss_stale_reviews_on_push === true) };
}

/** A pull request's approvals as a rule counts them: each reviewer's latest decision, at the head when stale ones are
 *  dismissed. */
export function approvalsOf(ctx: HandlerContext, repo: Row, p: Row, atHead: boolean): { approved: number; changes: boolean } {
  const latest = new Map<string, string>();
  for (const v of ctx.rowsRaw('review').filter((x) => x._repo === repo.full_name && x._pull === String(p.number) && (x.state === 'APPROVED' || x.state === 'CHANGES_REQUESTED') && (!atHead || x.commit_id === (p.head as Row).sha))) latest.set(String((v.user as Row).login), String(v.state));
  const states = [...latest.values()];
  return { approved: states.filter((st) => st === 'APPROVED').length, changes: states.includes('CHANGES_REQUESTED') };
}

// ── a repository's webhook deliveries (https://docs.github.com/en/rest/repos/webhooks) ───────────────────

/** A delivery's number: GitHub's deliveries are numbered; the World's are kept by a digest, read as one. */
export const deliveryNumber = (d: Row): number => parseInt(String(d.id).replace(/^hook_delivery_/, '').slice(0, 12), 16);

/** A delivery as GitHub lists it. The World sends each after the write's answer and keeps no receiver's answer, so its
 *  `status_code` is 0 and its `status` "pending" until one is kept — the kernel's delivery record holds none. */
// source: https://docs.github.com/en/rest/repos/webhooks "Lists webhooks for a repository. last response may return null if there have not been any deliveries within 30 days."
export function deliveryAnswer(d: Row, full: boolean): Row {
  const headers = (d.headers as Record<string, string> | undefined) ?? {};
  const header = (name: string): string | null => new Headers(headers).get(name);
  let payload: Row = {};
  try { payload = JSON.parse(String(d.body)) as Row; } catch { /* a body is always JSON */ }
  const at = new Date(Number(d.sent_at)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const base: Row = {
    id: deliveryNumber(d), guid: header('X-GitHub-Delivery') ?? null, delivered_at: at, redelivery: false, duration: 0, status: 'pending', status_code: 0,
    event: d.event_type ? String(header('X-GitHub-Event') ?? d.event_type) : null, action: typeof payload.action === 'string' ? payload.action : null,
    installation_id: (payload.installation as Row | undefined)?.id ?? null, repository_id: (payload.repository as Row | undefined)?.id ?? null, throttled_at: null,
  };
  return full ? { ...base, url: d.url, request: { headers, payload }, response: { headers: {}, payload: null } } : base;
}

/** How GitHub names a person's standing on what they write in a repository (`author_association`). */
// source: spec:/components/schemas/author-association "How the author is associated with the repository."
export function association(ctx: HandlerContext, repo: Row, login: string): Association {
  if (ownerOf(repo) === login) return 'OWNER';
  if (membershipOf(ctx, ownerOf(repo), login)?.state === 'active') return 'MEMBER';
  const theirs = ctx.rowsRaw('pull').filter((p) => p._repo === repo.full_name && (p.user as Row).login === login);
  if (theirs.some((p) => p.merged === true)) return 'CONTRIBUTOR';
  return theirs.length ? 'FIRST_TIME_CONTRIBUTOR' : 'NONE';
}

/** The children a repository keeps under it (`_repo`), moved with it by a rename or a transfer. */
const CHILDREN = ['label', 'milestone', 'issue', 'issue_comment', 'pull', 'review', 'commit_status', 'release', 'repo_hook', 'workflow', 'workflow_run', 'workflow_job', 'check_run', 'repository_advisory', 'push', 'discussion'];

/** A repository's children moved to its new full name: their `_repo`, and every URL of theirs naming the old one. */
export async function rehome(ctx: HandlerContext, from: string, to: string): Promise<void> {
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return v.split(`/repos/${from}/`).join(`/repos/${to}/`).split(`github.com/${from}/`).join(`github.com/${to}/`).replace(new RegExp(`/repos/${from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`), `/repos/${to}`);
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  for (const type of CHILDREN) {
    for (const r of ctx.rowsRaw(type).filter((x) => x._repo === from)) {
      const changed = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id' && k !== 'updatedAt' && k !== 'deleted').map(([k, v]) => [k, swap(v)]));
      await ctx.write(type, String(r.id), { ...changed, _repo: to }, `${type}.rehome`);
    }
  }
}

// ── the git plane ────────────────────────────────────────────────────────────────────────────────────

export const gitOf = (ctx: HandlerContext, repo: Row): { store: InstanceType<typeof git.GitObjectStore>; refs: InstanceType<typeof git.GitRefs> } => ctx.git(`r${String(repo.id)}`);
export const tipOf = (ctx: HandlerContext, repo: Row, branch: string): string | undefined => gitOf(ctx, repo).refs.get(`refs/heads/${branch}`) ?? undefined;

/** The files a commit holds, by path. */
export async function filesAt(ctx: HandlerContext, repo: Row, commit: string): Promise<Map<string, { mode: string; sha: string }>> {
  const { store } = gitOf(ctx, repo);
  const out = new Map<string, { mode: string; sha: string }>();
  const c = await store.read(commit);
  if (!c || c.type !== 'commit') return out;
  const walk = async (tree: string, prefix: string): Promise<void> => {
    const t = await store.read(tree);
    if (!t || t.type !== 'tree') return;
    for (const e of decodeTree(t.payload)) {
      if (e.mode === '40000' || e.mode === '040000') await walk(e.sha, `${prefix}${e.name}/`);
      else out.set(`${prefix}${e.name}`, { mode: e.mode, sha: e.sha });
    }
  };
  await walk(decodeCommit(c.payload).tree, '');
  return out;
}

/** A file's text at a commit, or undefined. */
export async function fileAt(ctx: HandlerContext, repo: Row, commit: string, path: string): Promise<string | undefined> {
  const f = (await filesAt(ctx, repo, commit)).get(path);
  const b = f ? await gitOf(ctx, repo).store.read(f.sha) : null;
  return b ? new TextDecoder().decode(b.payload) : undefined;
}

/** A flat map of paths written as nested trees; the root's sha. */
export async function writeTree(store: InstanceType<typeof git.GitObjectStore>, files: Map<string, { mode: string; sha: string }>): Promise<string> {
  const here: git.TreeEntry[] = [];
  const dirs = new Map<string, Map<string, { mode: string; sha: string }>>();
  for (const [path, f] of files) {
    const slash = path.indexOf('/');
    if (slash < 0) { here.push({ mode: f.mode, name: path, sha: f.sha }); continue; }
    const dir = path.slice(0, slash);
    if (!dirs.has(dir)) dirs.set(dir, new Map());
    dirs.get(dir)!.set(path.slice(slash + 1), f);
  }
  for (const [dir, inner] of dirs) here.push({ mode: '40000', name: dir, sha: await writeTree(store, inner) });
  return store.write('tree', encodeTree(sortTreeEntries(here)));
}

/** A person as git names them in a commit, at the World's time. */
export const ident = (ctx: HandlerContext, name: string, email: string): { name: string; email: string; time: number; tz: string } => ({ name, email, time: nowSeconds(ctx), tz: '+0000' });

/** A commit made by the API (a contents write, a merge) onto a branch; the branch moves and what a push sets off follows. */
export async function commitFiles(ctx: HandlerContext, repo: Row, branch: string, change: { message: string; author: { name: string; email: string }; actor: string; committer?: { name: string; email: string }; files?: Record<string, string | Uint8Array | null>; tree?: Map<string, { mode: string; sha: string }>; parents?: string[] }): Promise<string> {
  const { store, refs } = gitOf(ctx, repo);
  const tip = refs.get(`refs/heads/${branch}`) ?? undefined;
  const files = change.tree ? new Map(change.tree) : tip ? await filesAt(ctx, repo, tip) : new Map<string, { mode: string; sha: string }>();
  for (const [path, content] of Object.entries(change.files ?? {})) {
    if (content === null) { files.delete(path); continue; }
    files.set(path, { mode: '100644', sha: await store.write('blob', typeof content === 'string' ? new TextEncoder().encode(content) : content) });
  }
  const tree = await writeTree(store, files);
  const sha = await store.write('commit', encodeCommit({ tree, parents: change.parents ?? (tip ? [tip] : []), author: ident(ctx, change.author.name, change.author.email), committer: ident(ctx, change.committer?.name ?? 'GitHub', change.committer?.email ?? 'noreply@github.com'), message: `${change.message}\n` }));
  refs.set(`refs/heads/${branch}`, sha);
  if (!tip) refs.setHead(`refs/heads/${String(repo.default_branch ?? branch)}`);
  await pushed(ctx, repo, [{ name: `refs/heads/${branch}`, old: tip ?? ZERO_SHA, new: sha }], change.actor);
  return sha;
}

/** The commits a branch gained, newest first: reachable from `to` and not from `from`. */
export async function commitsBetween(ctx: HandlerContext, repo: Row, from: string | undefined, to: string): Promise<Array<{ sha: string; message: string; author: string }>> {
  const { store } = gitOf(ctx, repo);
  const out: Array<{ sha: string; message: string; author: string }> = [];
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length && out.length < 500) {
    const sha = stack.pop()!;
    if (seen.has(sha) || sha === from || (from && from !== ZERO_SHA && (await isAncestor(store, sha, from)))) continue;
    seen.add(sha);
    const c = await store.read(sha);
    if (!c || c.type !== 'commit') continue;
    const commit = decodeCommit(c.payload);
    out.push({ sha, message: commit.message, author: commit.author.name });
    stack.push(...commit.parents);
  }
  return out;
}

/** Two commits' trees merged at file level against their merge base; undefined when they conflict. */
export async function mergeTrees(ctx: HandlerContext, repo: Row, base: string, head: string): Promise<Map<string, { mode: string; sha: string }> | undefined> {
  const { store } = gitOf(ctx, repo);
  const ancestor = await mergeBase(store, base, head);
  const [b, h, a] = await Promise.all([filesAt(ctx, repo, base), filesAt(ctx, repo, head), ancestor ? filesAt(ctx, repo, ancestor) : Promise.resolve(new Map<string, { mode: string; sha: string }>())]);
  const out = new Map<string, { mode: string; sha: string }>();
  const text = async (sha: string | undefined): Promise<string> => (sha ? new TextDecoder().decode((await store.read(sha))?.payload ?? new Uint8Array()) : '');
  for (const path of new Set([...b.keys(), ...h.keys(), ...a.keys()])) {
    const [bb, hh, aa] = [b.get(path), h.get(path), a.get(path)];
    if (bb?.sha === hh?.sha) { if (bb) out.set(path, bb); continue; }
    if (hh?.sha === aa?.sha) { if (bb) out.set(path, bb); continue; }
    if (bb?.sha === aa?.sha) { if (hh) out.set(path, hh); continue; }
    if (!bb || !hh) return undefined;
    const merged = mergeText(await text(aa?.sha), await text(bb.sha), await text(hh.sha));
    if (merged === null) return undefined;
    out.set(path, { mode: bb.mode, sha: await store.write('blob', new TextEncoder().encode(merged)) });
  }
  return out;
}

/** A pull request's size from where its head left its base: commits, files, lines. */
export async function pullStats(ctx: HandlerContext, repo: Row, base: string, head: string): Promise<Row> {
  const { store } = gitOf(ctx, repo);
  const from = (await mergeBase(store, base, head)) ?? base;
  const files = (await diffFiles(store, from, head)) ?? [];
  return { commits: (await commitsBetween(ctx, repo, from, head)).length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0), changed_files: files.length };
}

// ── issues and pull requests ─────────────────────────────────────────────────────────────────────

/** The next number of a repository, which its issues, pull requests and discussions share. */
// source: https://docs.github.com/en/rest/issues/issues "GitHub's REST API considers every pull request an issue, but not every issue is a pull request."
export const nextNumber = (ctx: HandlerContext, repo: Row): number =>
  1 + [...ctx.rowsRaw('issue', { withDeleted: true }), ...ctx.rowsRaw('discussion', { withDeleted: true })].filter((i) => i._repo === repo.full_name).reduce((n, i) => Math.max(n, Number(i.number) || 0), 0);

/** The labels a call names, each made (GitHub's grey) when the repository does not have it yet. */
export async function labelsNamed(ctx: HandlerContext, repo: Row, names: unknown): Promise<Row[]> {
  const list = Array.isArray(names) ? names.map((n) => (typeof n === 'object' && n ? String((n as Row).name) : String(n))) : [];
  const out: Row[] = [];
  for (const name of list) {
    let l = ctx.rowsRaw('label').find((x) => x._repo === repo.full_name && String(x.name).toLowerCase() === name.toLowerCase());
    if (!l) {
      const id = mint(ctx, 'label');
      l = await ctx.write('label', String(id), { ...labelShape(id, String(repo.full_name), { name, color: 'ededed', description: null }), _repo: repo.full_name }, 'label.created');
    }
    out.push(shown(ctx, l));
  }
  return out;
}

/** An issue (or a pull request's issue) made under the repository's next number. */
export async function makeIssue(ctx: HandlerContext, repo: Row, by: string, f: { title: string; body: string | null; labels?: Row[]; assignees?: string[]; milestone?: Row | null; pull?: boolean }): Promise<Row> {
  const number = nextNumber(ctx, repo);
  const id = mint(ctx, 'issue');
  const shape = issueShape(id, number, String(repo.full_name), {
    title: f.title, body: f.body, user: account(ctx, by), labels: f.labels ?? [], assignees: (f.assignees ?? []).map((l) => account(ctx, l)), milestone: f.milestone ? shown(ctx, f.milestone) : null,
    pull: f.pull === true, association: association(ctx, repo, by),
  }, nowIso(ctx));
  const made = await ctx.write('issue', String(id), { ...shape, _repo: repo.full_name, _n: String(number) }, f.pull ? 'issue.pull' : 'issue.opened');
  await countOpen(ctx, repo);
  if (f.milestone) await countMilestone(ctx, repo, Number(f.milestone.number));
  return made;
}

/** The issue of a repository by its number. */
export const issueByNumber = (ctx: HandlerContext, repo: Row, number: unknown): Row | undefined => ctx.rowsRaw('issue').find((i) => i._repo === repo.full_name && String(i.number) === String(number));

/** The repository's open issues count (issues and pull requests, as GitHub counts `open_issues_count`), stored on it. */
export async function countOpen(ctx: HandlerContext, repo: Row): Promise<void> {
  const n = ctx.rowsRaw('issue').filter((i) => i._repo === repo.full_name && i.state === 'open').length;
  await ctx.write('repository', String(repo.id), { open_issues_count: n, open_issues: n }, 'repository.counts');
}

/** A milestone's open and closed issue counts, stored on it. */
export async function countMilestone(ctx: HandlerContext, repo: Row, number: number): Promise<void> {
  const m = ctx.rowsRaw('milestone').find((x) => x._repo === repo.full_name && x.number === number);
  if (!m) return;
  const under = ctx.rowsRaw('issue').filter((i) => i._repo === repo.full_name && (i.milestone as Row | null)?.number === number);
  await ctx.write('milestone', String(m.id), { open_issues: under.filter((i) => i.state === 'open').length, closed_issues: under.filter((i) => i.state === 'closed').length }, 'milestone.counts');
}

/** An issue closed by GitHub (a merged pull request or a commit reaching the default branch that says it closes it). */
// source: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue "When you merge a linked pull request into the default branch of a repository, its linked issue is automatically closed."
// source: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue "You can link a pull request to an issue by using a supported keyword in the pull request's description or in a commit message."
export async function closeIssue(ctx: HandlerContext, repo: Row, number: number, by: string): Promise<void> {
  const i = issueByNumber(ctx, repo, number);
  if (!i || i.state !== 'open' || i.pull_request) return;
  if (ctx.legal('issue', 'state', 'close', 'open', 'closed', String(i.id), 'vendor')) return;
  await ctx.asVendor(() => ctx.write('issue', String(i.id), { state: 'closed', state_reason: 'completed', closed_at: nowIso(ctx), closed_by: account(ctx, by), updated_at: nowIso(ctx) }, 'issue.closed'));
  await countOpen(ctx, repo);
  if (i.milestone) await countMilestone(ctx, repo, Number((i.milestone as Row).number));
}

/** A pull request of a repository by its number. */
export const pullByNumber = (ctx: HandlerContext, repo: Row, number: unknown): Row | undefined => ctx.rowsRaw('pull').find((p) => p._repo === repo.full_name && String(p.number) === String(number));

/** Open a pull request (the REST create and GraphQL's createPullRequest): a head branch of this repository or a fork's
 *  (`owner:branch`) into a base branch; an open one for the same head and base already is refused, and so is a head
 *  with nothing the base lacks (where the documentation stops, the refusals' words are GitHub's). It runs the base's
 *  pull_request workflows. */
// source: https://docs.github.com/en/rest/pulls/pulls "The name of the branch where your changes are implemented. For cross-repository pull requests in the same network, namespace head with a user like this: username:branch ."
export async function openPull(ctx: HandlerContext, repo: Row, caller: Caller, f: { title?: string; head?: string; base?: string; body?: string | null; draft?: boolean }): Promise<Row | Response> {
  if (!f.title) return invalid('PullRequest', 'title', 'missing_field');
  if (!f.head || !f.base) return invalid('PullRequest', f.head ? 'base' : 'head', 'missing_field');
  // a head of another owner is a fork's, and the World makes no fork (repos/create-fork is the gap)
  const [owner, branch] = f.head.includes(':') ? f.head.split(':', 2) as [string, string] : [ownerOf(repo), f.head];
  const headRepo = owner.toLowerCase() === ownerOf(repo).toLowerCase() ? repo : undefined;
  const headSha = headRepo ? tipOf(ctx, headRepo, branch) : undefined;
  if (!headRepo || !headSha) return invalid('PullRequest', 'head', 'invalid');
  const baseSha = tipOf(ctx, repo, f.base);
  if (!baseSha) return invalid('PullRequest', 'base', 'invalid');
  if (ctx.rowsRaw('pull').some((p) => p._repo === repo.full_name && p.state === 'open' && (p.head as Row).label === `${ownerOf(headRepo)}:${branch}` && (p.base as Row).ref === f.base)) {
    return invalid('PullRequest', 'head', 'custom', `A pull request already exists for ${ownerOf(headRepo)}:${branch}.`);
  }
  if (headSha === baseSha || (await isAncestor(gitOf(ctx, repo).store, headSha, baseSha))) return invalid('PullRequest', 'base', 'custom', `No commits between ${f.base} and ${f.head}`);
  const by = actorLogin(caller);
  await ensureUser(ctx, by);
  const issue = await makeIssue(ctx, repo, by, { title: f.title, body: f.body ?? null, pull: true });
  const id = mint(ctx, 'pull-request');
  const shape = pullShape(id, Number(issue.number), { repo: shown(ctx, repo), ref: f.base, sha: baseSha }, { repo: shown(ctx, headRepo), ref: branch, sha: headSha }, {
    title: f.title, body: f.body ?? null, user: account(ctx, by), draft: f.draft === true, association: association(ctx, repo, by), stats: await pullStats(ctx, repo, baseSha, headSha),
  }, nowIso(ctx));
  const p = await ctx.write('pull-request', String(id), { ...shape, _repo: repo.full_name, _n: String(issue.number), _head_repo: headRepo.full_name }, 'pull.opened');
  await runWorkflows(ctx, repo, { event: 'pull_request', base: f.base, sha: headSha, branch, actor: by, headRepo, pull: p });
  return p;
}

// ── edits a REST operation and a GraphQL mutation share ─────────────────────────────────────────────
/** Who may set an issue's labels, milestone and assignees: a person with push access; an App's installation or a run's
 *  token granted `issues: write` where it reaches. */
// source: https://docs.github.com/en/rest/issues/issues "Only users with push access can set labels for issues. Without push access to the repository, label changes are silently dropped."
// source: https://docs.github.com/en/rest/issues/issues "Only users with push access can set the milestone for issues. Without push access to the repository, milestone changes are silently dropped."
export const triages = (ctx: HandlerContext, repo: Row, c: Caller | undefined): boolean =>
  atLeast(roleIn(ctx, repo, c), 'write') || ((c?.kind === 'installation' || c?.kind === 'actions') && c.permissions.issues === 'write' && roleIn(ctx, repo, c) !== undefined);
/** Who may be assigned in a repository: its owner and those who can triage there (where the documentation stops: the
 *  assignees page checks "if a user has permission to be assigned" without naming the role). */
// source: https://docs.github.com/en/rest/issues/assignees "Checks if a user has permission to be assigned to an issue in this repository."
export const assignable = (ctx: HandlerContext, repo: Row, login: string): boolean => login === ownerOf(repo) || atLeast(roleIn(ctx, repo, { kind: 'user', login, scopes: [], token: '' }), 'triage');
/** A repository's milestone by its number. */
export const milestoneOf = (ctx: HandlerContext, repo: Row, number: unknown): Row | undefined => ctx.rowsRaw('milestone').find((m) => m._repo === repo.full_name && String(m.number) === String(number));

/** An issue edited (issues/update): its title, body and state (with `state_reason`) by its author or a triager; its
 *  labels, milestone and assignees by someone with push access alone. */
// source: https://docs.github.com/en/rest/issues/issues "Can be one of : completed , not_planned , duplicate , reopened , null"
export async function editIssue(ctx: HandlerContext, repo: Row, i: Row, by: string, triage: boolean, b: Row): Promise<Row | Response> {
  const fields: Row = { updated_at: nowIso(ctx) };
  let operation = 'issue.edited';
  if (str(b.title)) fields.title = b.title;
  if ('body' in b) fields.body = b.body ?? null;
  if ((b.state === 'open' || b.state === 'closed') && b.state !== i.state) {
    const refused = ctx.legal('issue', 'state', 'issues/update', String(i.state), String(b.state), String(i.id));
    if (refused) return ctx.refuse(refused);
    fields.state = b.state;
    fields.state_reason = b.state === 'closed' ? (str(b.state_reason) ?? 'completed') : 'reopened';
    fields.closed_at = b.state === 'closed' ? nowIso(ctx) : null;
    fields.closed_by = b.state === 'closed' ? account(ctx, by) : null;
    operation = b.state === 'closed' ? 'issue.closed' : 'issue.reopened';
  }
  if (triage && 'labels' in b) { fields.labels = await labelsNamed(ctx, repo, b.labels); if (operation === 'issue.edited') operation = 'issue.labeled'; }
  if (triage && 'milestone' in b) {
    const milestone = b.milestone === null ? null : milestoneOf(ctx, repo, b.milestone);
    if (b.milestone !== null && !milestone) return invalid('Issue', 'milestone', 'invalid');
    fields.milestone = milestone ? shown(ctx, milestone) : null;
    if (milestone && operation === 'issue.edited') operation = 'issue.milestoned';
  }
  if (triage && ('assignees' in b || 'assignee' in b)) {
    const next = 'assignees' in b ? ((b.assignees as string[] | null) ?? []) : b.assignee ? [String(b.assignee)] : [];
    if (next.some((a) => !assignable(ctx, repo, a))) return invalid('Issue', 'assignees', 'invalid');
    fields.assignees = [...new Set(next)].map((l) => account(ctx, l));
    fields.assignee = (fields.assignees as Row[])[0] ?? null;
    if (operation === 'issue.edited') operation = 'issue.assigned';
  }
  const updated = await ctx.write('issue', String(i.id), fields, operation);
  if (fields.state) await countOpen(ctx, repo);
  for (const n of new Set([(i.milestone as Row | null)?.number, (updated.milestone as Row | null)?.number].filter((x) => x != null))) await countMilestone(ctx, repo, Number(n));
  return updated;
}

/** A comment on an issue or pull request (issues/create-comment) by anyone who can read the repository (no operation
 *  the twin serves locks one); the issue's comment count is kept on it. */
// source: https://docs.github.com/en/rest/issues/comments "You can use the REST API to list comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request."
export async function commentOn(ctx: HandlerContext, repo: Row, i: Row, c: Caller, text: string): Promise<Row> {
  const by = actorLogin(c);
  await ensureUser(ctx, by);
  const id = mint(ctx, 'issue-comment');
  const made = await ctx.write('issue_comment', String(id), {
    ...commentShape(id, String(repo.full_name), Number(i.number), !!i.pull_request, account(ctx, by), text, association(ctx, repo, by), nowIso(ctx)), _repo: repo.full_name, _issue: String(i.number),
  }, 'issue_comment.created');
  await ctx.write('issue', String(i.id), { comments: Number(i.comments ?? 0) + 1, updated_at: nowIso(ctx) }, 'issue.commented');
  return made;
}

/** What a ruleset over a pull request's base still asks of it: the approving reviews its pull request rule requires,
 *  each reviewer's latest counting (those at the head when a push dismisses the stale ones). */
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "require that all pull requests receive a specific number of approving reviews before someone merges the pull request"
export function protectionRefusal(ctx: HandlerContext, repo: Row, p: Row, by: string): string | undefined {
  const asked = rulesetApprovals(ctx, repo, String((p.base as Row).ref), { kind: 'user', login: by, scopes: [], token: '' });
  if (asked && approvalsOf(ctx, repo, p, asked.stale).approved < asked.count) return `Repository rule violations found\n\nAt least ${asked.count} approving review${asked.count === 1 ? ' is' : 's are'} required by reviewers with write access.`;
  return undefined;
}

/** A pull request merged (pulls/merge, GraphQL's mergePullRequest): the head into the base by someone who can write — a
 *  merge commit, a squash ("Title (#n)") or a rebase's one commit — when the two merge cleanly and the base's rulesets
 *  are met (405 otherwise); the issues its body says it closes close when its base is the default branch. Where the
 *  documentation stops: a rebase is one commit here, where GitHub adds each of the head's commits; the 405's and
 *  409's words, and the default commit titles, are GitHub's. */
// source: https://docs.github.com/en/rest/pulls/pulls "405 Method Not Allowed if merge cannot be performed"
// source: https://docs.github.com/en/rest/pulls/pulls "409 Conflict if sha was provided and pull request head did not match"
// source: https://docs.github.com/en/rest/pulls/pulls "SHA that pull request head must match to allow merge."
// source: https://docs.github.com/en/rest/pulls/pulls "Can be one of : merge , squash , rebase"
// source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges "When you click the default Merge pull request option on a pull request, all commits from the feature branch are added to the base branch in a merge commit."
export async function mergePull(ctx: HandlerContext, repo: Row, p: Row, by: string, b: Row): Promise<{ sha: string } | Response> {
  const refused = ctx.legal('pull-request', 'state', 'pulls/merge', String(p.state), 'closed', String(p.id)) ?? ctx.legal('pull-request', 'merged', 'pulls/merge', String(p.merged === true), 'true', String(p.id));
  if (refused) return ctx.refuse(refused);
  const head = String((p.head as Row).sha);
  if (str(b.sha) && b.sha !== head) return fail(ctx, 409, 'Head branch was modified. Review and try the merge again.');
  const blocked = protectionRefusal(ctx, repo, p, by);
  if (blocked) return fail(ctx, 405, blocked);
  const baseRef = String((p.base as Row).ref);
  const baseSha = tipOf(ctx, repo, baseRef);
  if (!baseSha) return fail(ctx, 405, 'Base branch was deleted');
  const tree = await mergeTrees(ctx, repo, baseSha, head);
  if (!tree) return fail(ctx, 405, 'Pull Request is not mergeable');
  const method = str(b.merge_method) ?? 'merge';
  if (!['merge', 'squash', 'rebase'].includes(method)) return invalid('MergePullRequest', 'merge_method', 'invalid');
  const author = ctx.row('user', String((p.user as Row).login));
  const headLabel = String((p.head as Row).label).replace(':', '/');
  const title = str(b.commit_title) ?? (method === 'squash' ? `${String(p.title)} (#${String(p.number)})` : method === 'merge' ? `Merge pull request #${String(p.number)} from ${headLabel}` : String(p.title));
  const message = `${title}\n\n${str(b.commit_message) ?? (method === 'merge' ? String(p.title) : '')}`.trimEnd();
  const sha = await commitFiles(ctx, repo, baseRef, {
    message, tree, parents: method === 'merge' ? [baseSha, head] : [baseSha], actor: by,
    author: { name: String(author?.name ?? author?.login ?? (p.user as Row).login), email: String(author?.email ?? `${String((p.user as Row).login)}@users.noreply.github.com`) },
  });
  const at = nowIso(ctx);
  await ctx.write('pull-request', String(p.id), { state: 'closed', merged: true, merged_at: at, merged_by: account(ctx, by), merge_commit_sha: sha, closed_at: at, updated_at: at, mergeable: null, mergeable_state: 'unknown' }, 'pull.closed');
  const issue = issueByNumber(ctx, repo, p.number);
  if (issue && !ctx.legal('issue', 'state', 'close', String(issue.state), 'closed', String(issue.id), 'vendor')) await ctx.asVendor(() => ctx.write('issue', String(issue.id), { state: 'closed', closed_at: at, closed_by: account(ctx, by), updated_at: at, pull_request: { ...(issue.pull_request as Row), merged_at: at } }, 'issue.merged'));
  await countOpen(ctx, repo);
  if (baseRef === String(repo.default_branch ?? 'main')) for (const n of closingNumbers(String(p.body ?? ''))) await closeIssue(ctx, repo, n, by);
  return { sha };
}

/** A repository edited (repos/update): its name (a rename moves its children with it),
 *  description, homepage, visibility, features, default branch and merge settings. */
// source: https://docs.github.com/en/rest/repos/repos "Either true to allow auto-merge on pull requests, or false to disallow auto-merge."
// source: https://docs.github.com/en/rest/repos/repos "Either true to allow squash-merging pull requests, or false to prevent squash-merging."
export async function editRepo(ctx: HandlerContext, repo: Row, b: Row): Promise<Row | Response> {
  const fields: Row = { updated_at: nowIso(ctx) };
  for (const k of ['description', 'homepage', 'has_issues', 'has_projects', 'has_wiki', 'has_discussions', 'allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge', 'allow_auto_merge', 'allow_update_branch', 'delete_branch_on_merge', 'archived', 'is_template'] as const) if (k in b) fields[k] = b[k];
  if (typeof b.private === 'boolean' || str(b.visibility)) { const priv = b.visibility ? b.visibility === 'private' : b.private === true; fields.private = priv; fields.visibility = priv ? 'private' : 'public'; }
  if (str(b.default_branch)) {
    if (!tipOf(ctx, repo, String(b.default_branch))) return invalid('Repository', 'default_branch', 'invalid');
    fields.default_branch = b.default_branch;
    gitOf(ctx, repo).refs.setHead(`refs/heads/${String(b.default_branch)}`);
  }
  let operation = 'repository.edited';
  const name = str(b.name);
  if (name && name !== repo.name) {
    if (repoNamed(ctx, ownerOf(repo), name)) return invalid('Repository', 'name', 'custom', 'name already exists on this account');
    const to = `${ownerOf(repo)}/${name}`;
    await rehome(ctx, String(repo.full_name), to);
    Object.assign(fields, repositoryUrls(to), { name, full_name: to });
    operation = 'repository.renamed';
  }
  return ctx.write('repository', String(repo.id), fields, operation);
}

/** A repository's URLs under a full name. */
export function repositoryUrls(full: string): Row {
  const shape = repositoryShape(0, full.split('/')[1]!, { login: full.split('/')[0] }, {}, '');
  const keep = Object.keys(shape).filter((k) => k.endsWith('_url') || k === 'url');
  return Object.fromEntries(keep.map((k) => [k, shape[k]]));
}


// ── workflow runs (https://docs.github.com/en/actions) ───────────────────────────────────────────────

/** The workflows a commit's tree holds (`.github/workflows/*.yml`), each read. */
export async function workflowsAt(ctx: HandlerContext, repo: Row, commit: string): Promise<Array<Workflow & { text: string }>> {
  const files = await filesAt(ctx, repo, commit);
  const out: Array<Workflow & { text: string }> = [];
  for (const path of [...files.keys()].filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).sort()) {
    const text = (await fileAt(ctx, repo, commit, path)) ?? '';
    const w = readWorkflow(path, text);
    if (w) out.push({ ...w, text });
  }
  return out;
}

/** A repository's workflow for a file, made the first time it is seen on its default branch or runs. */
export async function workflowRow(ctx: HandlerContext, repo: Row, w: Workflow): Promise<Row> {
  const held = ctx.rowsRaw('workflow').find((x) => x._repo === repo.full_name && x.path === w.path);
  if (held) return held;
  const id = mint(ctx, 'workflow');
  const full = String(repo.full_name);
  await ctx.write('workflow', String(id), {
    id, node_id: nodeId('Workflow', id), name: w.name, path: w.path, state: 'active', created_at: nowIso(ctx), updated_at: nowIso(ctx),
    url: `https://api.github.com/repos/${full}/actions/workflows/${id}`, html_url: `https://github.com/${full}/blob/${String(repo.default_branch ?? 'main')}/${w.path}`,
    badge_url: `https://github.com/${full}/workflows/${encodeURIComponent(w.name)}/badge.svg`, _repo: repo.full_name,
  }, 'workflow.create');
  return ctx.row('workflow', String(id))!;
}

/** GitHub Actions' App, whose check runs a workflow's jobs are. */
export const ACTIONS_APP = 15368;

/** The commit a run is of, as a run names it: its id, tree, message, time and people. */
// source: spec:/components/schemas/simple-commit "A commit."
async function headCommit(ctx: HandlerContext, repo: Row, sha: string): Promise<Row | null> {
  const raw = await gitOf(ctx, repo).store.read(sha);
  if (!raw || raw.type !== 'commit') return null;
  const c = decodeCommit(raw.payload);
  return {
    id: sha, tree_id: c.tree, message: c.message.replace(/\n$/, ''), timestamp: new Date(c.committer.time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    author: { name: c.author.name, email: c.author.email }, committer: { name: c.committer.name, email: c.committer.email },
  };
}

/** A repository as a run names it (a minimal repository: the repository's own fields). */
// source: spec:/components/schemas/workflow-run "repository"
const repoSummary = (ctx: HandlerContext, r: Row): Row => shown(ctx, r);

/** Start the runs an event sets off: each workflow of the commit that runs on it. A pull request run a workflow's
 *  GITHUB_TOKEN set off waits for approval; the others' jobs are queued (a fork, whose first-time contributor's runs wait
 *  too, is made by repos/create-fork, which the twin does not serve). A pull
 *  request also sets off the base repository's `pull_request_target` workflows, read from its default branch and run in
 *  that context, which never wait. */
// source: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows "When a pull request is created or updated by a workflow using GITHUB_TOKEN , pull_request events with the opened , synchronize , or reopened activity types create workflow runs that require approval."
// source: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows "This event runs in the context of the default branch of the base repository, rather than in the context of the merge commit, as the pull_request event does."
export async function runWorkflows(ctx: HandlerContext, repo: Row, t: Trigger & { sha: string; branch: string; actor: string; headRepo?: Row; pull?: Row }): Promise<void> {
  return ctx.asVendor(async () => {
  if (t.event === 'pull_request' && t.pull) {
    const defaultRef = String(repo.default_branch ?? 'main');
    const defaultSha = tipOf(ctx, repo, defaultRef);
    if (defaultSha) await runWorkflows(ctx, repo, { event: 'pull_request_target', base: t.base, sha: defaultSha, branch: defaultRef, actor: t.actor, pull: t.pull });
  }
  const source = t.event === 'pull_request_target' ? repo : (t.headRepo ?? repo);
  const full = String(repo.full_name);
  for (const w of await workflowsAt(ctx, source, t.sha)) {
    if (!runsOn(w, t)) continue;
    const wf = await workflowRow(ctx, repo, w);
    const id = mint(ctx, 'workflow-run');
    const number = 1 + ctx.rowsRaw('workflow_run', { withDeleted: true }).filter((r) => r.workflow_id === wf.id).reduce((n, r) => Math.max(n, Number(r.run_number) || 0), 0);
    const waits = t.event === 'pull_request' && t.actor === 'github-actions[bot]';
    const head = t.event === 'pull_request_target' ? repo : source;
    const url = `https://api.github.com/repos/${full}/actions/runs/${id}`;
    const run = await ctx.write('workflow_run', String(id), {
      id, name: w.name, node_id: nodeId('WorkflowRun', id), head_branch: t.branch, head_sha: t.sha, path: w.path, display_title: t.pull ? String(t.pull.title) : w.name,
      run_number: number, run_attempt: 1, event: t.event, status: waits ? 'action_required' : 'queued', conclusion: null, workflow_id: ctx.own(wf).id, check_suite_id: id, check_suite_node_id: nodeId('CheckSuite', id),
      url, html_url: `https://github.com/${full}/actions/runs/${id}`,
      pull_requests: t.pull ? [{ id: t.pull.id, number: t.pull.number, url: t.pull.url, head: { ref: (t.pull.head as Row).ref, sha: String((t.pull.head as Row).sha), repo: repoSummary(ctx, t.headRepo ?? source) }, base: { ref: (t.pull.base as Row).ref, sha: (t.pull.base as Row).sha, repo: repoSummary(ctx, repo) } }] : [],
      created_at: nowIso(ctx), updated_at: nowIso(ctx), run_started_at: nowIso(ctx), actor: account(ctx, t.actor), triggering_actor: account(ctx, t.actor),
      jobs_url: `${url}/jobs`, logs_url: `${url}/logs`, artifacts_url: `${url}/artifacts`, cancel_url: `${url}/cancel`, rerun_url: `${url}/rerun`, check_suite_url: `https://api.github.com/repos/${full}/check-suites/${id}`,
      workflow_url: `https://api.github.com/repos/${full}/actions/workflows/${String(wf.id)}`, head_commit: await headCommit(ctx, source, t.sha), repository: repoSummary(ctx, repo), head_repository: repoSummary(ctx, head),
      _repository_id: repo.id, _repo: repo.full_name, _permissions: w.permissions, _jobs: w.jobs,
    }, 'workflow_run.requested');
    if (!waits) await queueJobs(ctx, repo, ctx.row('workflow_run', String(run.id))!);
  }
  });
}

/** A run's jobs queued for a runner: each a check run of GitHub Actions' App on the run's head, and the job its run
 *  lists under the same id ("check_run_url"). */
export async function queueJobs(ctx: HandlerContext, repo: Row, run: Row): Promise<void> {
  const full = String(repo.full_name);
  for (const name of (run._jobs as string[] | undefined) ?? []) {
    const id = mint(ctx, 'check-run');
    const at = nowIso(ctx);
    await ctx.write('check_run', String(id), {
      id, head_sha: run.head_sha, node_id: nodeId('CheckRun', id), external_id: '', url: `https://api.github.com/repos/${full}/check-runs/${id}`,
      html_url: `https://github.com/${full}/actions/runs/${String(run.id)}/job/${id}`, details_url: `https://github.com/${full}/actions/runs/${String(run.id)}/job/${id}`,
      status: 'queued', conclusion: null, started_at: at, completed_at: null, output: { title: null, summary: null, text: null, annotations_count: 0, annotations_url: `https://api.github.com/repos/${full}/check-runs/${id}/annotations` },
      name, check_suite: { id: run.check_suite_id }, app: { id: ACTIONS_APP, slug: 'github-actions', name: 'GitHub Actions' }, pull_requests: [], _repo: repo.full_name, _run: String(run.id),
    }, 'check_run.created');
    await ctx.write('workflow_job', String(id), {
      id, run_id: run.id, run_url: run.url, run_attempt: run.run_attempt, node_id: nodeId('CheckRun', id), head_sha: run.head_sha, head_branch: run.head_branch,
      url: `https://api.github.com/repos/${full}/actions/jobs/${id}`, html_url: `https://github.com/${full}/actions/runs/${String(run.id)}/job/${id}`, status: 'queued', conclusion: null,
      created_at: at, started_at: at, completed_at: null, name, steps: [], check_run_url: `https://api.github.com/repos/${full}/check-runs/${id}`, labels: ['ubuntu-latest'],
      runner_id: null, runner_name: null, runner_group_id: null, runner_group_name: null, workflow_name: run.name, _repo: repo.full_name, _run: String(run.id),
    }, 'workflow_job.queued');
  }
}

// ── what a change of a ref sets off ──────────────────────────────────────────────────────────────────

/** A change of refs (a push over git, a commit or merge through the API, a ref made): recorded as the push GitHub sends;
 *  pull requests follow their head (synchronize) and one whose head branch is deleted closes; a push runs the workflows
 *  it triggers, unless a workflow's own GITHUB_TOKEN made it; a push to the default branch registers its workflows and
 *  closes the issues its commits say they close. */
// source: https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows "With the exception of workflow_dispatch and repository_dispatch , other GITHUB_TOKEN -triggered events do not create workflow runs at all."
// source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository "If the branch is associated with at least one open pull request, deleting the branch closes the pull requests."
export async function pushed(ctx: HandlerContext, repo: Row, changes: Array<{ name: string; old: string; new: string }>, actor: string): Promise<void> {
  const { store } = gitOf(ctx, repo);
  const full = String(repo.full_name);
  for (const change of changes) {
    const branch = change.name.startsWith('refs/heads/') ? change.name.slice(11) : undefined;
    const deleted = change.new === ZERO_SHA;
    const created = change.old === ZERO_SHA;
    const commits = deleted ? [] : await commitsBetween(ctx, repo, created ? undefined : change.old, change.new);
    const pusher = ctx.row('user', actor);
    const pid = mint(ctx, 'push');
    await ctx.write('push', String(pid), {
      ref: change.name, before: change.old, after: change.new, created, deleted, forced: !created && !deleted && !(await isAncestor(store, change.old, change.new)),
      compare: `https://github.com/${full}/compare/${change.old.slice(0, 12)}...${change.new.slice(0, 12)}`, pusher: { name: actor, email: pusher?.email ?? null },
      commits: commits.slice(0, 20).reverse().map((c) => ({ id: c.sha, message: c.message.replace(/\n$/, ''), url: `https://github.com/${full}/commit/${c.sha}`, author: { name: c.author } })),
      head_commit: commits[0] ? { id: commits[0].sha, message: commits[0].message.replace(/\n$/, '') } : null, _repo: full, at: nowIso(ctx),
    }, 'push.record');
    await ctx.write('repository', String(repo.id), { pushed_at: nowIso(ctx) }, 'repository.pushed');
    if (branch) {
      for (const p of ctx.rowsRaw('pull').filter((x) => x._head_repo === full && (x.head as Row).ref === branch && x.state === 'open')) {
        const base = ctx.rowsRaw('repository').find((r) => r.full_name === p._repo);
        if (!base) continue;
        if (deleted) {
          if (!ctx.legal('pull-request', 'state', 'push', 'open', 'closed', String(p.id), 'vendor')) await ctx.asVendor(() => ctx.write('pull-request', String(p.id), { state: 'closed', closed_at: nowIso(ctx) }, 'pull.closed'));
          continue;
        }
        const stats = await pullStats(ctx, base, String((p.base as Row).sha), change.new);
        await ctx.write('pull-request', String(p.id), { head: { ...(p.head as Row), sha: change.new }, statuses_url: `https://api.github.com/repos/${String(base.full_name)}/statuses/${change.new}`, ...stats, updated_at: nowIso(ctx) }, 'pull.synchronize');
        await runWorkflows(ctx, base, { event: 'pull_request', base: String((p.base as Row).ref), sha: change.new, branch, actor, headRepo: repo, pull: p });
      }
    }
    if (deleted) continue;
    if (branch === String(repo.default_branch ?? 'main')) {
      for (const w of await workflowsAt(ctx, repo, change.new)) await workflowRow(ctx, repo, w);
      for (const c of commits) for (const n of closingNumbers(c.message)) await closeIssue(ctx, repo, n, actor);
    }
    if (actor === 'github-actions[bot]') continue;
    const tagged = await store.read(change.new);
    const commit = tagged?.type === 'tag' ? git.decodeTag(tagged.payload).object : change.new;
    await runWorkflows(ctx, repo, { event: 'push', ref: change.name, sha: commit, branch: change.name.replace(/^refs\/(heads|tags)\//, ''), actor });
  }
}

// ── github.com's sessions ────────────────────────────────────────────────────────────────────────────

/** A cookie a request carries. */
export function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export const SESSIONS = '_web_session';

/** The person signed in on github.com: the `user_session` cookie's session, when it is whole (past two-factor). */
export function signedIn(ctx: HandlerContext): string | undefined {
  const id = cookieOf(ctx.call.request, 'user_session');
  const s = id ? ctx.row(SESSIONS, sha256(id)) : undefined;
  return s && s.state === 'active' ? String(s.login) : undefined;
}

/** A session begun for a person: pending until their second factor is given, else whole. Answers the cookie's value. */
export async function beginSession(ctx: HandlerContext, login: string, state: 'pending' | 'active', returnTo: string): Promise<string> {
  const n = await serial(ctx, 'session');
  const id = ctx.crypto.digest('sha256', await ctx.secret(`session:${login}:${n}:${ctx.occurredAt}`), 'hex').slice(0, 48);
  await ctx.record(SESSIONS, { login, state, return_to: returnTo, created: nowSeconds(ctx) }, sha256(id));
  return id;
}

/** A person's password as the World keeps it: its hash, salted by their login. */
export const passwordOf = (login: string, password: string): string => passwordHash(login.toLowerCase(), password);

// ── Apps registered ─────────────────────────────────────────────────────────────────────────────────

/** A GitHub App registered (from a manifest, or the World's door): GitHub's integration shape with its client id
 *  (`Iv1.` and 16 hex characters, the twin's form); its secrets and webhook settings bookkeeping. */
// source: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest "The manifest flow creates the GitHub App registration and generates the app's webhook secret, private key (PEM file), client secret, and GitHub App ID."
export async function makeApp(ctx: HandlerContext, owner: string, f: Row): Promise<Row | undefined> {
  const name = String(f.name ?? '');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || ctx.rowsRaw('app').some((a) => a.slug === slug)) return undefined;
  const id = mint(ctx, 'integration');
  // the App's secrets are drawn from ctx.secret, and its private key is its own (ctx.signingKey), handed to its owner
  // once; the World keeps its public half, which an App's JWT is verified with (callerOf)
  const clientSecret = ctx.crypto.digest('sha256', await ctx.secret(`app:${slug}:client`), 'hex');
  const webhookSecret = ctx.crypto.digest('sha256', await ctx.secret(`app:${slug}:webhook`), 'hex');
  const key = await ctx.signingKey(`github-app:${String(id)}`);
  return ctx.write('app', String(id), {
    id, slug, node_id: nodeId('Integration', id), client_id: `Iv1.${sha256(`app:${slug}`).slice(0, 16)}`, owner: account(ctx, owner), name, description: f.description ?? null,
    external_url: f.url ?? null, html_url: `https://github.com/apps/${slug}`, created_at: nowIso(ctx), updated_at: nowIso(ctx), permissions: f.permissions ?? {}, events: f.events ?? [],
    installations_count: 0, _client_secret: clientSecret.slice(0, 40), _webhook_secret: f.webhook_secret ?? (f.hook_url ? webhookSecret.slice(0, 40) : null), _public_pem: key.publicPem,
    _hook_url: f.hook_url ?? null, _hook_id: 400000 + id, _setup_url: f.setup_url ?? null, _callback_urls: f.callback_urls ?? [], _request_oauth_on_install: f.request_oauth_on_install === true,
    _public: f.public === true, ...(f._code ? { _code: f._code, _code_at: nowSeconds(ctx), _code_used: false } : {}),
  }, 'app.create');
}

export { sha256 };
