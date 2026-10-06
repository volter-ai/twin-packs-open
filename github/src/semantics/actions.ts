// GitHub's Actions operations (https://docs.github.com/en/rest/actions): a repository's workflow runs (made by pushes and
// pull requests, shared.ts runWorkflows; a runner moves them through the runStart and runComplete doors), the
// repository's and an environment's secrets, each sealed to its own key, and the repository's and its organization's
// configuration variables. An environment is made by repos' create-or-update (repos.ts).
import type { HandlerContext } from '@volter/world-core';
import { bodyOf, fail, invalid, json, noContent, notFound, nowIso, page, repoOfPath, type Row, shown, str } from './shared.ts';

// ── an environment's secrets (https://docs.github.com/en/rest/actions/secrets) ──────────────────────────

/** The environment the path names, as the repository holds it. */
const environmentOf = (ctx: HandlerContext, repo: Row): Row | undefined => ctx.rowsRaw('environment').find((e) => e._repo === repo.full_name && e.name === String(ctx.call.params.environment_name ?? ''));

/** An environment's secrets key: an X25519 pair a secret is sealed to with libsodium's sealed box. */
// source: https://docs.github.com/en/rest/actions/secrets "Creates or updates an environment secret with an encrypted value. Encrypt your secret using LibSodium ."
const keyOf = (ctx: HandlerContext, env: Row): { publicKey: Uint8Array; secretKey: Uint8Array } => ctx.crypto.sealedBoxKeyPair(`github-actions-secrets:environment:${String(env.id)}`);
const b64 = (bytes: Uint8Array): string => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
const keyId = (ctx: HandlerContext, env: Row): string => ctx.crypto.digest('sha256', keyOf(ctx, env).publicKey, 'hex').slice(0, 20);

/** actions/get-environment-public-key: the key a secret is sealed to before it is sent; an environment the repository
 *  does not have, 404. */
// source: https://docs.github.com/en/rest/actions/secrets "Get the public key for an environment, which you need to encrypt environment secrets. You need to encrypt a secret before you can create or update secrets."
export async function actions_get_environment_public_key(ctx: HandlerContext): Promise<Response> {
  const env = environmentOf(ctx, repoOfPath(ctx));
  if (!env) return notFound(ctx);
  return json({ key_id: keyId(ctx, env), key: b64(keyOf(ctx, env).publicKey) });
}

/** actions/create-or-update-environment-secret: the sealed value opened with the environment's key and kept for the
 *  jobs that run in it (201 made, 204 replaced); a key it was not sealed to, or a value that does not open, 422 (where the
 *  documentation stops, in GitHub's words). A name holds letters, digits and underscores, starts with neither a digit
 *  nor `GITHUB_`, and is kept in capitals. */
// source: https://docs.github.com/en/rest/actions/secrets "201 Response when creating a secret"
// source: https://docs.github.com/en/rest/actions/secrets "204 Response when updating a secret"
// source: https://docs.github.com/en/actions/reference/security/secrets "Can only contain alphanumeric characters ( [a-z] , [A-Z] , [0-9] ) or underscores ( _ ). Spaces are not allowed."
// source: https://docs.github.com/en/actions/reference/security/secrets "Must not start with the GITHUB_ prefix."
// source: https://docs.github.com/en/actions/reference/security/secrets "Must not start with a number."
// source: https://docs.github.com/en/actions/reference/security/secrets "GitHub stores secret names as uppercase regardless of how they are entered."
export async function actions_create_or_update_environment_secret(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const env = environmentOf(ctx, repo);
  if (!env) return notFound(ctx);
  const b = bodyOf(ctx);
  const name = String(ctx.call.params.secret_name ?? '').toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || name.startsWith('GITHUB_')) return invalid('Secret', 'name', 'invalid');
  if (str(b.key_id) !== keyId(ctx, env)) return invalid('Secret', 'key_id', 'invalid');
  let sealed: Uint8Array;
  try { sealed = Uint8Array.from(atob(String(b.encrypted_value ?? '')), (ch) => ch.charCodeAt(0)); } catch { return invalid('Secret', 'encrypted_value', 'invalid'); }
  const opened = ctx.crypto.sealedBoxOpen(sealed, keyOf(ctx, env));
  if (!opened) return fail(ctx, 422, 'Bad request - could not decrypt the secret');
  const key = `${String(env.id)}::${name}`;
  const held = ctx.row('environment_secret', key);
  const at = nowIso(ctx);
  await ctx.write('environment_secret', key, { name, created_at: held?.created_at ?? at, updated_at: at, _value: new TextDecoder().decode(opened), _environment: String(env.id), _repo: repo.full_name }, held ? 'environment_secret.updated' : 'environment_secret.created');
  return held ? noContent() : json({}, 201);
}

/** actions/list-environment-secrets: names and dates, never values, as `{ total_count, secrets }`. */
// source: https://docs.github.com/en/rest/actions/secrets "Lists all secrets available in an environment without revealing their encrypted values."
export async function actions_list_environment_secrets(ctx: HandlerContext): Promise<Response> {
  const env = environmentOf(ctx, repoOfPath(ctx));
  if (!env) return notFound(ctx);
  const all = ctx.rowsRaw('environment_secret').filter((s) => s._environment === String(env.id)).map((s) => ({ name: s.name, created_at: s.created_at, updated_at: s.updated_at }));
  return json({ total_count: all.length, secrets: page(ctx, all) });
}

// ── workflow runs (https://docs.github.com/en/rest/actions/workflow-runs) ───────────────────────────────

/** The runs of a repository matching the list's filters, newest first. */
// source: https://docs.github.com/en/rest/actions/workflow-runs "Returns workflow runs with the check run status or conclusion that you specify."
// source: https://docs.github.com/en/rest/actions/workflow-runs "Returns workflow runs with the check_suite_id that you specify."
function runsFiltered(ctx: HandlerContext, runs: Row[], created: (run: Row) => boolean): Row[] {
  const p = ctx.params;
  return runs.filter((r) =>
    (!str(p.event) || r.event === p.event) && (!str(p.branch) || r.head_branch === p.branch) && (!str(p.head_sha) || r.head_sha === p.head_sha)
    && (!str(p.actor) || (r.actor as Row).login === p.actor) && (!str(p.status) || r.status === p.status || r.conclusion === p.status)
    && (p.check_suite_id === undefined || String(r.check_suite_id) === String(p.check_suite_id)) && created(r),
  ).reverse();
}

// source: https://docs.github.com/en/rest/actions/workflow-runs "Returns workflow runs created within the given date-time range."
// source: https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax "You can search for dates that are earlier or later than another date"
// source: https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax "You can also add optional time information"
function createdFilter(value: string | undefined): ((run: Row) => boolean) | null {
  if (!value) return () => true;
  const bound = (s: string): [number, number] | null => {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(s)) return null;
    const at = Date.parse(s);
    if (!Number.isFinite(at)) return null;
    const day = s.length === 10;
    if (day && new Date(at).toISOString().slice(0, 10) !== s) return null;
    return [at, day ? at + 86400000 - 1 : at];
  };
  let low = -Infinity, high = Infinity;
  if (value.includes('..')) {
    const parts = value.split('..');
    if (parts.length !== 2) return null;
    const a = parts[0] === '*' ? [-Infinity, -Infinity] : bound(parts[0]!);
    const b = parts[1] === '*' ? [Infinity, Infinity] : bound(parts[1]!);
    if (!a || !b) return null;
    low = a[0]!; high = b[1]!;
  } else {
    const match = /^(>=|<=|>|<)?(.+)$/.exec(value)!;
    const b = bound(match[2]!);
    if (!b) return null;
    if (match[1] === '>') low = b[1] + 1;
    else if (match[1] === '>=') low = b[0];
    else if (match[1] === '<') high = b[0] - 1;
    else if (match[1] === '<=') high = b[1];
    else { low = b[0]; high = b[1]; }
  }
  return (run) => { const at = Date.parse(String(run.created_at)); return at >= low && at <= high; };
}

// source: https://docs.github.com/en/rest/actions/workflow-runs "If true pull requests are omitted from the response (empty array)."
function runsAnswer(ctx: HandlerContext, runs: Row[]): Response {
  const omit = ctx.params.exclude_pull_requests === true || ctx.params.exclude_pull_requests === 'true';
  return json({ total_count: runs.length, workflow_runs: page(ctx, runs).map((row) => ({ ...shown(ctx, row), ...(omit ? { pull_requests: [] } : {}) })) });
}

/** actions/list-workflow-runs-for-repo: `{ total_count, workflow_runs }`, filtered and paged. */
export async function actions_list_workflow_runs_for_repo(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const created = createdFilter(str(ctx.params.created));
  // Where date syntax is invalid, use GitHub's ordinary field-validation envelope.
  if (!created) return invalid('WorkflowRun', 'created', 'invalid');
  const all = runsFiltered(ctx, ctx.rowsRaw('workflow_run').filter((r) => r._repo === repo.full_name), created);
  return runsAnswer(ctx, all);
}

/** A single workflow's runs, addressed by its numeric id or workflow file name. */
// source: spec:actions/list-workflow-runs "List all workflow runs for a workflow."
// source: spec:actions/list-workflow-runs "with the workflow file name."
export async function actions_list_workflow_runs(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const asked = String(ctx.call.params.workflow_id ?? '');
  const workflow = ctx.rowsRaw('workflow').find((w) => w._repo === repo.full_name && w.deleted !== true
    && (String(ctx.own(w).id) === asked || String(w.path).split('/').at(-1) === asked));
  // Where this operation's documentation stops, an absent workflow uses GitHub's ordinary Not Found envelope.
  if (!workflow) return notFound(ctx);
  const created = createdFilter(str(ctx.params.created));
  if (!created) return invalid('WorkflowRun', 'created', 'invalid');
  const all = runsFiltered(ctx, ctx.rowsRaw('workflow_run').filter((r) => r._repo === repo.full_name && r.workflow_id === ctx.own(workflow).id), created);
  return runsAnswer(ctx, all);
}

/** actions/list-artifacts-for-repo: the artifacts its runs uploaded, newest first, by `name`, as `{ total_count, artifacts }`. */
export async function actions_list_artifacts_for_repo(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const name = str(ctx.params.name);
  const all = ctx.rowsRaw('artifact').filter((a) => String((a.workflow_run as Row | undefined)?.repository_id) === String(repo.id) && a.deleted !== true && (!name || a.name === name)).reverse();
  return json({ total_count: all.length, artifacts: page(ctx, all).map((row) => shown(ctx, row)) });
}

/** actions/list-repo-workflows: the repository's workflows, as `{ total_count, workflows }`. */
export async function actions_list_repo_workflows(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const all = ctx.rowsRaw('workflow').filter((w) => w._repo === repo.full_name && w.deleted !== true);
  return json({ total_count: all.length, workflows: page(ctx, all).map((row) => shown(ctx, row)) });
}

// ── a repository's secrets (https://docs.github.com/en/rest/actions/secrets) ───────────────────────────

/** The repository's secrets key: an X25519 pair a secret is sealed to with libsodium's sealed box. */
const repoKeyOf = (ctx: HandlerContext, repo: Row): { publicKey: Uint8Array; secretKey: Uint8Array } => ctx.crypto.sealedBoxKeyPair(`github-actions-secrets:${String(repo.id)}`);
const repoKeyId = (ctx: HandlerContext, repo: Row): string => ctx.crypto.digest('sha256', repoKeyOf(ctx, repo).publicKey, 'hex').slice(0, 20);

/** actions/get-repo-public-key. */
// source: https://docs.github.com/en/rest/actions/secrets "Gets your public key, which you need to encrypt secrets."
export async function actions_get_repo_public_key(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  return json({ key_id: repoKeyId(ctx, repo), key: b64(repoKeyOf(ctx, repo).publicKey) });
}

/** actions/create-or-update-repo-secret: the sealed value opened with the repository's key and kept for its runs (201
 *  made, 204 replaced); a key it was not sealed to, or a value that does not open, 422. */
// source: https://docs.github.com/en/rest/actions/secrets "Creates or updates a repository secret with an encrypted value. Encrypt your secret using LibSodium ."
export async function actions_create_or_update_repo_secret(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const name = String(ctx.call.params.secret_name ?? '').toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || name.startsWith('GITHUB_')) return invalid('Secret', 'name', 'invalid');
  if (str(b.key_id) !== repoKeyId(ctx, repo)) return invalid('Secret', 'key_id', 'invalid');
  let sealed: Uint8Array;
  try { sealed = Uint8Array.from(atob(String(b.encrypted_value ?? '')), (ch) => ch.charCodeAt(0)); } catch { return invalid('Secret', 'encrypted_value', 'invalid'); }
  const opened = ctx.crypto.sealedBoxOpen(sealed, repoKeyOf(ctx, repo));
  if (!opened) return fail(ctx, 422, 'Bad request - could not decrypt the secret');
  const key = `${String(repo.id)}::${name}`;
  const held = ctx.row('repo_secret', key);
  const at = nowIso(ctx);
  await ctx.write('repo_secret', key, { name, created_at: held?.created_at ?? at, updated_at: at, _value: new TextDecoder().decode(opened), _repository_id: String(repo.id), _repo: repo.full_name }, held ? 'repo_secret.updated' : 'repo_secret.created');
  return held ? noContent() : json({}, 201);
}

// ── a repository's variables (https://docs.github.com/en/rest/actions/variables) ──────────────────────

/** A variable's name as GitHub takes it: letters, digits and underscores, not starting with a digit or `GITHUB_`. */
// source: https://docs.github.com/en/actions/reference/workflows-and-actions/variables "Can only contain alphanumeric characters ( [a-z] , [A-Z] , [0-9] ) or underscores ( _ ). Spaces are not allowed."
// source: https://docs.github.com/en/actions/reference/workflows-and-actions/variables "Must not start with the GITHUB_ prefix."
const variableName = (v: unknown): string | undefined => { const n = str(v)?.toUpperCase(); return n && /^[A-Z_][A-Z0-9_]*$/.test(n) && !n.startsWith('GITHUB_') ? n : undefined; };

/** actions/create-repo-variable: a name and a value (201); a name the repository has already, 409 (where the
 *  documentation stops, "Already exists" is GitHub's conflict answer for a variable). */
// source: https://docs.github.com/en/rest/actions/variables "Creates a repository variable that you can reference in a GitHub Actions workflow."
export async function actions_create_repo_variable(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const name = variableName(b.name);
  if (!name) return invalid('Variable', 'name', str(b.name) ? 'invalid' : 'missing_field');
  if (typeof b.value !== 'string') return invalid('Variable', 'value', 'missing_field');
  const key = `${String(repo.full_name)}::${name}`;
  if (ctx.row('repo_variable', key)) return fail(ctx, 409, 'Already exists - Variable already exists');
  const at = nowIso(ctx);
  await ctx.write('repo_variable', key, { name, value: b.value, created_at: at, updated_at: at, _repo: repo.full_name }, 'repo_variable.created');
  return json({}, 201);
}

/** actions/update-repo-variable: its value, or its name (204); a variable the repository does not have, 404. */
// source: https://docs.github.com/en/rest/actions/variables "Updates a repository variable that you can reference in a GitHub Actions workflow."
export async function actions_update_repo_variable(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const name = String(ctx.call.params.name ?? '').toUpperCase();
  const held = ctx.row('repo_variable', `${String(repo.full_name)}::${name}`);
  if (!held) return notFound(ctx);
  const b = bodyOf(ctx);
  const renamed = b.name === undefined ? name : variableName(b.name);
  if (!renamed) return invalid('Variable', 'name', 'invalid');
  const fields: Row = { name: renamed, value: typeof b.value === 'string' ? b.value : held.value, updated_at: nowIso(ctx) };
  if (renamed !== name) {
    if (ctx.row('repo_variable', `${String(repo.full_name)}::${renamed}`)) return fail(ctx, 409, 'Already exists - Variable already exists');
    await ctx.remove('repo_variable', `${String(repo.full_name)}::${name}`, 'repo_variable.renamed');
    await ctx.write('repo_variable', `${String(repo.full_name)}::${renamed}`, { ...fields, created_at: held.created_at, _repo: repo.full_name }, 'repo_variable.updated');
  } else await ctx.write('repo_variable', `${String(repo.full_name)}::${name}`, fields, 'repo_variable.updated');
  return noContent();
}

/** actions/list-repo-variables: the repository's variables, as `{ total_count, variables }`. */
// source: https://docs.github.com/en/rest/actions/variables "Lists all repository variables."
export async function actions_list_repo_variables(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const all = ctx.rowsRaw('repo_variable').filter((v) => v._repo === repo.full_name).map((v) => ({ name: v.name, value: v.value, created_at: v.created_at, updated_at: v.updated_at }));
  return json({ total_count: all.length, variables: page(ctx, all) });
}

/** actions/list-org-variables: an organization's variables, as `{ total_count, variables }`, to a member; an
 *  organization the World has not, 404. No operation the twin serves sets an organization variable, so the list is
 *  empty. */
// source: https://docs.github.com/en/rest/actions/variables "Lists all organization variables."
export async function actions_list_org_variables(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  if (!ctx.row('org', org)) return notFound(ctx);
  return json({ total_count: 0, variables: [] });
}
