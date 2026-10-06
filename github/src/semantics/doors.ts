// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: what a person does on github.com pages the World has not built as screens (signing up, choosing a password,
// turning on two-factor authentication, making a token, an organization, a GitHub App or an OAuth app), what their
// authenticator app shows, the token the World's application holds, and what a runner does with a workflow run (picks it
// up with its token and secrets; finishes it with its jobs' conclusions and the artifacts they uploaded).
import type { HandlerContext } from '@volter/world-core';
import { nodeId, simpleOrg } from '../engine/objects.ts';
import { base32Encode, totp as codeAt } from '../engine/totp.ts';
import { account, accountId, bodyOf, ensureUser, issueToken, tokenKey, TOKENS, makeApp, mint, nowIso, nowSeconds, passwordOf, repoNamed, serial, sha256, shown, signedIn, str, type Row } from './shared.ts';

const answer = (body: unknown, status = 200): Response => Response.json(body, { status });
const refused = (message: string, status = 400): Response => Response.json({ error: message }, { status });

/** POST /_twin/users {login, email, password, name?}: a person signed up — their account, their email (primary,
 *  verified) and their password. */
export async function users(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const login = str(b.login);
  const email = str(b.email);
  if (!login || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return refused('login must be letters, digits and single hyphens, at most 39');
  if (!email || !email.includes('@')) return refused('email is required');
  if (ctx.row('user', login) && ctx.row('user', login)!._password) return refused(`${login} is taken`, 409);
  const u = await ensureUser(ctx, login, { name: str(b.name) ?? null, email, ...(str(b.password) ? { _password: passwordOf(login, String(b.password)) } : {}) });
  await ctx.write('user_email', `${login}::${email}`, { email, primary: true, verified: true, visibility: 'private', _login: login }, 'user_email.added');
  return answer({ login, id: u.id }, 201);
}

/** POST /_twin/users/{login}/password {password}. */
export async function password(ctx: HandlerContext): Promise<Response> {
  const login = String(ctx.call.params.login ?? '');
  const p = str(bodyOf(ctx).password);
  if (!p) return refused('password is required');
  await ensureUser(ctx, login, { _password: passwordOf(login, p) });
  return new Response(null, { status: 204 });
}

/** POST /_twin/users/{login}/two-factor {secret?}: an authenticator app set up — its setup key (base32), the one the
 *  page shows unless the caller names its own. */
export async function twoFactor(ctx: HandlerContext): Promise<Response> {
  const login = String(ctx.call.params.login ?? '');
  await ensureUser(ctx, login);
  const given = str(bodyOf(ctx).secret)?.toUpperCase().replace(/\s+/g, '');
  const secret = given ?? base32Encode(new TextEncoder().encode(sha256(await ctx.secret(`totp:${login}:${ctx.occurredAt}`)).slice(0, 20)));
  await ctx.write('user', login, { _totp: secret }, 'user.two_factor');
  return answer({ login, secret, otpauth: `otpauth://totp/GitHub:${login}?secret=${secret}&issuer=GitHub` }, 201);
}

/** GET /_twin/users/{login}/totp: the code their authenticator app shows now. */
export async function totp(ctx: HandlerContext): Promise<Response> {
  const u = ctx.row('user', String(ctx.call.params.login ?? ''));
  if (!u?._totp) return refused('two-factor authentication is not on', 404);
  return answer({ code: codeAt(String(u._totp), nowSeconds(ctx)) });
}

/** POST /_twin/users/{login}/tokens {scopes, note?, expires_in_days?}: a personal access token (classic), `ghp_`, with
 *  the scopes chosen, shown once. */
// source: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github "Personal access token (classic) ghp_"
export async function tokens(ctx: HandlerContext): Promise<Response> {
  const login = String(ctx.call.params.login ?? '');
  await ensureUser(ctx, login);
  const b = bodyOf(ctx);
  const scopes = Array.isArray(b.scopes) ? (b.scopes as unknown[]).map(String) : [];
  const days = Number(b.expires_in_days ?? 0);
  const token = await issueToken(ctx, 'ghp_', { kind: 'pat', login, scopes, note: str(b.note) ?? null, ...(days > 0 ? { expires: nowSeconds(ctx) + days * 86400 } : {}) });
  return answer({ token, scopes, note: str(b.note) ?? null }, 201);
}

/** POST /_twin/orgs {login, name?, billing_email?}: GitHub's new-organization page (github.com/account/organizations/new),
 *  used by the person signed in (`user_session`; `owner` names them for a World without the page's session) — its
 *  owner; a visitor not signed in is sent to sign in first, to come back to the page. */
export async function orgs(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const login = str(b.login);
  const owner = signedIn(ctx) ?? str(b.owner);
  if (!owner) return new Response(null, { status: 302, headers: { location: `/login?return_to=${encodeURIComponent('/account/organizations/new')}` } });
  if (!login || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return refused('login must be letters, digits and single hyphens');
  if (!owner || !ctx.row('user', owner)) return refused('owner must be a person who has signed up');
  if (ctx.row('org', login) || ctx.row('user', login)) return refused(`${login} is taken`, 409);
  const id = await accountId(ctx, login);
  const at = nowIso(ctx);
  const o = await ctx.write('org', login, {
    ...simpleOrg({ login, id }), name: str(b.name) ?? login, company: null, blog: '', location: null, email: null, twitter_username: null, is_verified: false, has_organization_projects: true,
    has_repository_projects: true, public_repos: 0, public_gists: 0, followers: 0, following: 0, html_url: `https://github.com/${login}`, created_at: at, updated_at: at, archived_at: null, type: 'Organization',
    billing_email: str(b.billing_email) ?? null, default_repository_permission: 'read', members_can_create_repositories: true, two_factor_requirement_enabled: false,
    members_allowed_repository_creation_type: 'all', members_can_create_public_repositories: true, members_can_create_private_repositories: true, node_id: nodeId('Organization', id),
    plan: { name: 'free', space: 976562499, private_repos: 10000, filled_seats: 1, seats: 1 },
  }, 'organization.created');
  await ctx.write('org_membership', `${login}::${owner}`, {
    url: `https://api.github.com/orgs/${login}/memberships/${owner}`, state: 'active', role: 'admin', organization_url: `https://api.github.com/orgs/${login}`, _org: login, _login: owner,
  }, 'organization.member_added');
  return answer({ login, id: o.id }, 201);
}

/** POST /_twin/apps {owner, name, url?, hook_url?, webhook_secret?, events?, permissions?, callback_urls?, setup_url?,
 *  public?}: a GitHub App registered on its owner's settings page — its id, slug, client id and secret, webhook secret
 *  and private key. */
export async function apps(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const owner = str(b.owner);
  if (!owner || !account(ctx, owner).id) return refused('owner must be a person or an organization');
  if (!str(b.name)) return refused('name is required');
  const app = await makeApp(ctx, owner, b);
  if (!app) return refused(`an App named ${String(b.name)} exists`, 409);
  const kept = ctx.row('app', String(app.id))!;
  return answer({ ...shown(ctx, kept), client_secret: kept._client_secret, webhook_secret: kept._webhook_secret ?? null, pem: (await ctx.signingKey(`github-app:${String(kept.id)}`)).privatePem }, 201);
}

/** POST /_twin/oauth_apps {owner, name, callback_url, homepage_url?}: an OAuth app registered — its client id (`Ov23li`
 *  and 14 characters) and a client secret. */
// Where the documentation stops: an OAuth app's client id is written Ov23li and fourteen characters, as GitHub mints them
export async function oauthApps(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const owner = str(b.owner);
  const name = str(b.name);
  const callback = str(b.callback_url);
  if (!owner || !account(ctx, owner).id) return refused('owner must be a person or an organization');
  if (!name || !callback) return refused('name and callback_url are required');
  const n = await serial(ctx, 'oauth_app');
  const clientId = `Ov23li${sha256(`oauth_app:${n}:${owner}:${name}`).slice(0, 14)}`;
  const secret = sha256(await ctx.secret(`oauth_app_secret:${clientId}`)).slice(0, 40);
  await ctx.write('oauth_app', clientId, { client_id: clientId, name, owner: account(ctx, owner), url: str(b.homepage_url) ?? null, callback_url: callback, created_at: nowIso(ctx), _client_secret: secret }, 'oauth_app.created');
  return answer({ client_id: clientId, client_secret: secret, name, callback_url: callback }, 201);
}

// ── a runner and a workflow run ──────────────────────────────────────────────────────────────────────

/** The run a door's path names, under its repository. */
function runNamed(ctx: HandlerContext): { repo: Row; run: Row } | undefined {
  const repo = repoNamed(ctx, String(ctx.call.params.owner ?? ''), String(ctx.call.params.repo ?? ''));
  const run = repo ? ctx.rowsRaw('workflow_run').find((r) => r._repo === repo.full_name && String(r.id) === String(ctx.call.params.run_id)) : undefined;
  return repo && run ? { repo, run } : undefined;
}

/** POST /_twin/repos/{owner}/{repo}/actions/runs/{run_id}/start: a runner picks up a queued run — it and its jobs are in
 *  progress, and the runner is given the job's GITHUB_TOKEN (`ghs_`, the workflow's permissions, until the run ends), the
 *  repository's secrets and what the run is (its event, ref and sha). */
// source: https://docs.github.com/actions/about-github-actions/understanding-github-actions "A runner is a server that runs your workflows when they're triggered. Each runner can run a single job at a time."
export async function runStart(ctx: HandlerContext): Promise<Response> {
  return ctx.asVendor(async () => {
  const hit = runNamed(ctx);
  if (!hit) return refused('no such run', 404);
  const { repo, run } = hit;
  if (ctx.legal('workflow-run', 'status', 'runner', run.status, 'in_progress', String(run.id), 'vendor')) return refused(`the run is ${String(run.status)}`, 409);
  const at = nowIso(ctx);
  await ctx.write('workflow_run', String(run.id), { status: 'in_progress', run_started_at: at, updated_at: at }, 'workflow_run.in_progress');
  for (const j of ctx.rowsRaw('workflow_job').filter((x) => x._run === String(run.id) && x.status === 'queued')) {
    await ctx.write('workflow_job', String(j.id), { status: 'in_progress', started_at: at, runner_name: 'GitHub Actions 1', runner_id: 1, runner_group_id: 1, runner_group_name: 'GitHub Actions' }, 'workflow_job.in_progress');
    if (ctx.row('check_run', String(j.id))) await ctx.write('check_run', String(j.id), { status: 'in_progress', started_at: at }, 'check_run.in_progress');
  }
  const permissions = (run._permissions as Row | undefined) ?? {};
  const token = await issueToken(ctx, 'ghs_', { kind: 'actions', run: String(run.id), permissions });
  const secrets = Object.fromEntries(ctx.rowsRaw('repo_secret').filter((s) => s._repository_id === String(repo.id)).map((s) => [String(s.name), String(s._value)]));
  // a job granted `id-token: write` is given the request token and URL its OIDC token is asked for with
  // source: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers "The job or workflow run requires a permissions setting with id-token: write to allow GitHub's OIDC provider to create a JSON Web Token for every run."
  // source: https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers "Alternatively, you can use the following environment variables to retrieve the token: ACTIONS_ID_TOKEN_REQUEST_TOKEN , ACTIONS_ID_TOKEN_REQUEST_URL ."
  let idToken: Row = {};
  if (permissions['id-token'] === 'write') {
    const request = sha256(await ctx.secret(`id-token-request:${String(run.id)}:${String(run.run_attempt)}:${ctx.occurredAt}`));
    await ctx.record('_id_token_request', { run: String(run.id) }, sha256(request));
    // as the World's runner reads it (world-runtime actions-runner.ts: `id_token_request: { url, token }`)
    idToken = { id_token_request: { url: `https://token.actions.githubusercontent.com/idtoken?run=${String(run.id)}`, token: request } };
  }
  return answer({
    token, permissions, secrets, run: { id: run.id, event: run.event, ref: run.head_branch, sha: run.head_sha, workflow: run.path, run_number: run.run_number, run_attempt: run.run_attempt, jobs: run._jobs ?? [] },
    repository: repo.full_name, api_url: 'https://api.github.com', server_url: 'https://github.com', graphql_url: 'https://api.github.com/graphql', ...idToken,
  });
  });
}

/** POST /_twin/repos/{owner}/{repo}/actions/runs/{run_id}/complete {conclusion, jobs?: {<name>: conclusion},
 *  artifacts?: [{name, size_in_bytes}]}: a runner finishes a run — each job and its check run completed with its
 *  conclusion (the run's unless named), the artifacts its steps uploaded kept for 90 days, the run completed (its
 *  GITHUB_TOKEN then refused). */
// source: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts "By default, GitHub stores build logs and artifacts for 90 days, and this retention period can be customized."
// source: https://docs.github.com/en/rest/checks/runs "Can be one of : action_required , cancelled , failure , neutral , success , skipped , stale , timed_out"
export async function runComplete(ctx: HandlerContext): Promise<Response> {
  return ctx.asVendor(async () => {
  const hit = runNamed(ctx);
  if (!hit) return refused('no such run', 404);
  const { repo, run } = hit;
  const b = bodyOf(ctx);
  const conclusion = str(b.conclusion) ?? 'success';
  if (!['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out'].includes(conclusion)) return refused('conclusion must be success, failure, cancelled, skipped, neutral or timed_out');
  if (ctx.legal('workflow-run', 'status', 'runner', run.status, 'completed', String(run.id), 'vendor')) return refused(`the run is ${String(run.status)}`, 409);
  const each = (b.jobs as Row | undefined) ?? {};
  const at = nowIso(ctx);
  for (const j of ctx.rowsRaw('workflow_job').filter((x) => x._run === String(run.id) && x.status !== 'completed')) {
    const c = str(each[String(j.name)]) ?? conclusion;
    await ctx.write('workflow_job', String(j.id), { status: 'completed', conclusion: c, completed_at: at }, 'workflow_job.completed');
    if (ctx.row('check_run', String(j.id))) await ctx.write('check_run', String(j.id), { status: 'completed', conclusion: c, completed_at: at }, 'check_run.completed');
  }
  const full = String(repo.full_name);
  for (const a of (Array.isArray(b.artifacts) ? (b.artifacts as Row[]) : [])) {
    const name = str(a.name);
    if (!name) continue;
    const id = mint(ctx, 'artifact');
    const expires = new Date(Date.parse(ctx.occurredAt) + 90 * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await ctx.write('artifact', String(id), {
      id, node_id: nodeId('Artifact', id), name, size_in_bytes: Number(a.size_in_bytes ?? 0), url: `https://api.github.com/repos/${full}/actions/artifacts/${id}`,
      archive_download_url: `https://api.github.com/repos/${full}/actions/artifacts/${id}/zip`, expired: false, digest: str(a.digest) ?? null, created_at: at, updated_at: at, expires_at: expires,
      workflow_run: { id: ctx.own(run).id, repository_id: ctx.own(repo).id, head_repository_id: ctx.own(repo).id, head_branch: run.head_branch, head_sha: run.head_sha },
    }, 'artifact.created');
  }
  await ctx.write('workflow_run', String(run.id), { status: 'completed', conclusion, updated_at: at }, 'workflow_run.completed');
  return answer({ id: run.id, status: 'completed', conclusion });
  });
}

/** POST /_twin/app-credentials: the token the World's application holds as GITHUB_TOKEN (the descriptor's
 *  credentialDoor): a personal access token of the World's own account, `world`, with the classic scopes an
 *  application's automation takes (repo, workflow, read:org, user), as its owner makes it on the settings page; made the
 *  first time the runtime asks and the same at every boot after. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const login = 'world';
  await ensureUser(ctx, login);
  const token = `ghp_${ctx.crypto.digest('sha256', await ctx.secret('github-app-credentials'), 'hex').slice(0, 36)}`;
  if (!ctx.row(TOKENS, tokenKey(token))) await ctx.record(TOKENS, { kind: 'pat', login, scopes: ['repo', 'workflow', 'read:org', 'user'], note: 'world', created: nowSeconds(ctx) }, tokenKey(token));
  return answer({ token }, 201);
}
