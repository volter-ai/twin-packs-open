// GitHub's repos operations, continued: a commit's statuses (https://docs.github.com/en/rest/commits/statuses), a
// repository's webhooks and their deliveries (https://docs.github.com/en/rest/repos/webhooks), its deploy keys
// (https://docs.github.com/en/rest/deploy-keys), its rulesets (https://docs.github.com/en/rest/repos/rules) and its
// environments with their deployment branch policies (https://docs.github.com/en/rest/deployments). The core lists a
// repository's deploy keys.
import type { HandlerContext } from '@volter/world-core';
import { nodeId } from '../engine/objects.ts';
import { account, actorLogin, bodyOf, deliveryAnswer, fail, gitOf, invalid, json, mint, noContent, notFound, nowIso, page, repoOfPath, type Row, shown, str, who } from './shared.ts';

// ── commit statuses ─────────────────────────────────────────────────────────────────────────────────

// source: https://docs.github.com/en/rest/commits/statuses "Can be one of : error , failure , pending , success"
const STATUS_STATES = ['error', 'failure', 'pending', 'success'];

/** repos/create-commit-status: a status of a commit, by someone with write access ("Users with push access in a
 *  repository can create commit statuses for a given SHA"), its context `default` unless named (201); a state GitHub
 *  does not know, 422; a commit the repository does not hold, 422 ("No commit found for SHA"). A repository's statuses
 *  for one SHA and context are kept, the latest first ("a maximum of 1000 statuses"). */
// source: https://docs.github.com/en/rest/commits/statuses "Users with push access in a repository can create commit statuses for a given SHA."
// source: https://docs.github.com/en/rest/commits/statuses "Note: there is a limit of 1000 statuses per sha and context within a repository."
// Where the documentation stops: a status for a commit the repository does not hold is refused in GitHub's words
export async function repos_create_commit_status(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const sha = String(ctx.call.params.sha ?? '');
  const b = bodyOf(ctx);
  const state = str(b.state);
  if (!state) return invalid('Status', 'state', 'missing_field');
  if (!STATUS_STATES.includes(state)) return invalid('Status', 'state', 'invalid');
  const o = await gitOf(ctx, repo).store.read(sha);
  if (!o || o.type !== 'commit') return fail(ctx, 422, `No commit found for SHA: ${sha}`);
  const id = mint(ctx, 'status');
  const at = nowIso(ctx);
  const full = String(repo.full_name);
  const by = actorLogin(who(ctx)!);
  const creator = account(ctx, by);
  const row = await ctx.write('commit_status', String(id), {
    url: `https://api.github.com/repos/${full}/statuses/${sha}`, avatar_url: creator.avatar_url, id, node_id: nodeId('StatusContext', id), state,
    description: str(b.description) ?? null, target_url: str(b.target_url) ?? null, context: str(b.context) ?? 'default', created_at: at, updated_at: at, creator,
    _sha: sha, _repo: full,
  }, 'commit_status.created');
  return json(shown(ctx, row), 201);
}

// ── webhooks ────────────────────────────────────────────────────────────────────────────────────────

/** A hook as answered: its secret never shown ("secret": "********"). */
// Where the documentation stops: GitHub answers a hook's secret as asterisks, never the secret given
const masked = (ctx: HandlerContext, h: Row): Row => { const s = shown(ctx, h); const config = { ...((s.config as Row | undefined) ?? {}) }; if ('secret' in config || h._secret) config.secret = '********'; return { ...s, config }; };

/** repos/create-webhook: a hook posting the events it names (`push` unless it names others) to its URL, signed with its
 *  secret, active unless told not to be, by an admin (201); a hook needs a URL ("config.url is a required field"). Its
 *  first delivery, GitHub's `ping`, is not sent: the World's deliveries are the writes' declared events. */
// source: https://docs.github.com/en/rest/repos/webhooks "Use web to create a webhook. Default: web . This parameter only accepts the value web ."
// source: https://docs.github.com/en/rest/repos/webhooks "The media type used to serialize the payloads. Supported values include json and form . The default is form ."
// source: https://docs.github.com/en/rest/repos/webhooks "Determines what events the hook is triggered for."
// source: https://docs.github.com/en/rest/repos/webhooks "Determines if notifications are sent when the webhook is triggered. Set to true to send notifications."
export async function repos_create_webhook(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const config = (b.config as Row | undefined) ?? {};
  const url = str(config.url);
  if (!url) return invalid('Hook', 'url', 'missing_field');
  if (b.name !== undefined && b.name !== 'web') return invalid('Hook', 'name', 'invalid');
  const id = mint(ctx, 'hook');
  const at = nowIso(ctx);
  const full = String(repo.full_name);
  const base = `https://api.github.com/repos/${full}/hooks/${id}`;
  const row = await ctx.write('repo_hook', String(id), {
    type: 'Repository', id, name: 'web', active: b.active !== false, events: Array.isArray(b.events) && b.events.length ? b.events : ['push'],
    config: { content_type: str(config.content_type) ?? 'form', insecure_ssl: String(config.insecure_ssl ?? '0'), url, ...(str(config.secret) ? { secret: '********' } : {}) },
    updated_at: at, created_at: at, url: base, test_url: `${base}/test`, ping_url: `${base}/pings`, deliveries_url: `${base}/deliveries`,
    last_response: { code: null, status: 'unused', message: null }, _secret: str(config.secret) ?? '', _hook_id: String(id), _repo: full,
  }, 'hook.created');
  return json(masked(ctx, row), 201);
}

/** repos/list-webhooks: the repository's hooks, to an admin (engine/access.ts), each secret masked. */
// source: https://docs.github.com/en/rest/repos/webhooks "Lists webhooks for a repository."
export async function repos_list_webhooks(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  return json(page(ctx, ctx.rowsRaw('repo_hook').filter((h) => h._repo === repo.full_name && h.deleted !== true)).map((row) => masked(ctx, row)));
}

/** repos/list-webhook-deliveries: the deliveries the hook was sent, newest first. */
export async function repos_list_webhook_deliveries(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const hook = ctx.row('repo_hook', String(ctx.call.params.hook_id ?? ''));
  if (!hook || hook._repo !== repo.full_name) return notFound(ctx);
  const sent = ctx.rowsRaw('_hook_delivery').filter((d) => new Headers((d.headers as Record<string, string> | undefined) ?? {}).get('X-GitHub-Hook-ID') === String(hook._hook_id)).reverse();
  return json(page(ctx, sent).map((d) => deliveryAnswer(d, false)));
}

// ── deploy keys ─────────────────────────────────────────────────────────────────────────────────────

/** repos/create-deploy-key: an SSH public key with read access, or read and write unless `read_only` (201), by an
 *  admin; a key that is not an OpenSSH public key, or one in use already (a deploy key is one repository's), 422
 *  ("key is already in use"). */
// source: https://docs.github.com/en/rest/deploy-keys/deploy-keys "You can create a read-only deploy key."
// source: https://docs.github.com/en/rest/deploy-keys/deploy-keys "If true , the key will only be able to read repository contents. Otherwise, the key will be able to read and write."
// Where the documentation stops: the refusals of a key that is no OpenSSH public key and of one in use are GitHub's words
export async function repos_create_deploy_key(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const key = str(b.key)?.trim();
  if (!key) return invalid('PublicKey', 'key', 'missing_field');
  const m = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/=]+)(?:\s.*)?$/.exec(key);
  if (!m) return invalid('PublicKey', 'key', 'custom', 'key is invalid. You must supply a key in OpenSSH public key format');
  // a key is kept as its type and body, without the comment GitHub drops
  const plain = `${m[1]} ${m[2]}`;
  if (ctx.rowsRaw('deploy_key').some((k) => k.key === plain)) return invalid('PublicKey', 'key', 'custom', 'key is already in use');
  const id = mint(ctx, 'deploy-key');
  const at = nowIso(ctx);
  const row = await ctx.write('deploy_key', String(id), {
    id, key: plain, url: `https://api.github.com/repos/${String(repo.full_name)}/keys/${id}`, title: str(b.title) ?? '', verified: true, created_at: at, read_only: b.read_only === true,
    added_by: actorLogin(who(ctx)!), last_used: null, enabled: true, _repo: repo.full_name,
  }, 'deploy_key.created');
  return json(shown(ctx, row), 201);
}

// ── rulesets ────────────────────────────────────────────────────────────────────────────────────────

// source: https://docs.github.com/en/rest/repos/rules "Can be one of : branch , tag , push"
const RULESET_TARGETS = ['branch', 'tag', 'push'];
// source: https://docs.github.com/en/rest/repos/rules "Can be one of : disabled , active , evaluate"
const ENFORCEMENTS = ['disabled', 'active', 'evaluate'];

/** repos/create-repo-ruleset: a ruleset of the repository — its name, target, enforcement, bypass list, conditions and
 *  rules — by an admin (201); a name the repository has a ruleset of already, or an enforcement or target GitHub does
 *  not know, 422. It holds as soon as it is active (shared.ts rulesOn). */
// source: https://docs.github.com/en/rest/repos/rules "Create a ruleset for a repository."
// Where the documentation stops: a name the repository has a ruleset of is refused in GitHub's words
export async function repos_create_repo_ruleset(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const name = str(b.name);
  if (!name) return invalid('RepositoryRuleset', 'name', 'missing_field');
  const enforcement = str(b.enforcement);
  if (!enforcement || !ENFORCEMENTS.includes(enforcement)) return invalid('RepositoryRuleset', 'enforcement', enforcement ? 'invalid' : 'missing_field');
  const target = str(b.target) ?? 'branch';
  if (!RULESET_TARGETS.includes(target)) return invalid('RepositoryRuleset', 'target', 'invalid');
  if (ctx.rowsRaw('repository_ruleset').some((r) => r._repo === repo.full_name && r.name === name)) return fail(ctx, 422, 'Validation Failed: Name must be unique');
  const id = mint(ctx, 'repository-ruleset');
  const at = nowIso(ctx);
  const full = String(repo.full_name);
  const row = await ctx.write('repository-ruleset', String(id), {
    id, name, target, source_type: 'Repository', source: full, enforcement, bypass_actors: Array.isArray(b.bypass_actors) ? b.bypass_actors : [],
    current_user_can_bypass: 'never', node_id: nodeId('RepositoryRuleset', id),
    _links: { self: { href: `https://api.github.com/repos/${full}/rulesets/${id}` }, html: { href: `https://github.com/${full}/rules/${id}` } },
    conditions: (b.conditions as Row | undefined) ?? null, rules: Array.isArray(b.rules) ? b.rules : [], created_at: at, updated_at: at, _repo: full,
  }, 'repository_ruleset.created');
  return json(shown(ctx, row, 'repository-ruleset'), 201);
}

/** repos/get-repo-rulesets: the repository's rulesets, each as the list names one (its id, name, target, source,
 *  enforcement and links; its rules are read one ruleset at a time). */
// source: https://docs.github.com/en/rest/repos/rules "Get all the rulesets for a repository."
export async function repos_get_repo_rulesets(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const keep = ['id', 'name', 'target', 'source_type', 'source', 'enforcement', 'node_id', '_links', 'created_at', 'updated_at'];
  const all = ctx.rowsRaw('repository_ruleset').filter((r) => r._repo === repo.full_name).map((r) => { const own = ctx.own(r); return Object.fromEntries(keep.filter((k) => k in own).map((k) => [k, own[k]])); });
  return json(page(ctx, all));
}

/** repos/update-repo-ruleset: the fields named replaced — name, target, enforcement, bypass list, conditions, rules —
 *  by an admin (200); a ruleset of another repository, 404. */
export async function repos_update_repo_ruleset(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const held = ctx.row('repository_ruleset', String(ctx.call.params.ruleset_id ?? ''));
  if (!held || held._repo !== repo.full_name) return notFound(ctx);
  const b = bodyOf(ctx);
  const fields: Row = { updated_at: nowIso(ctx) };
  if (b.name !== undefined) {
    const name = str(b.name);
    if (!name) return invalid('RepositoryRuleset', 'name', 'invalid');
    if (ctx.rowsRaw('repository_ruleset').some((r) => r._repo === repo.full_name && r.name === name && String(r.id) !== String(held.id))) return fail(ctx, 422, 'Validation Failed: Name must be unique');
    fields.name = name;
  }
  if (b.enforcement !== undefined) { if (!ENFORCEMENTS.includes(String(b.enforcement))) return invalid('RepositoryRuleset', 'enforcement', 'invalid'); fields.enforcement = b.enforcement; }
  if (b.target !== undefined) { if (!RULESET_TARGETS.includes(String(b.target))) return invalid('RepositoryRuleset', 'target', 'invalid'); fields.target = b.target; }
  if (Array.isArray(b.bypass_actors)) fields.bypass_actors = b.bypass_actors;
  if (b.conditions !== undefined) fields.conditions = b.conditions;
  if (Array.isArray(b.rules)) fields.rules = b.rules;
  const row = await ctx.write('repository-ruleset', String(held.id), fields, 'repository_ruleset.edited');
  return json(shown(ctx, row, 'repository-ruleset'));
}

// ── environments ────────────────────────────────────────────────────────────────────────────────────

/** A reviewer an environment names, as GitHub answers it: a person's simple account, or a team's. */
// source: https://docs.github.com/en/rest/deployments/environments "The people or teams that may review jobs that reference the environment."
function reviewerOf(ctx: HandlerContext, r: Row): Row {
  if (r.type === 'Team') {
    const team = ctx.rowsRaw('team').find((x) => String(ctx.own(x).id) === String(r.id));
    if (!team) return { id: r.id };
    // source: spec:/components/schemas/team/properties/id "integer"
    const fields = ctx.own(team);
    const keep = ['id', 'node_id', 'url', 'html_url', 'name', 'slug', 'description', 'privacy', 'notification_setting', 'permission', 'members_url', 'repositories_url', 'parent'];
    return Object.fromEntries(keep.map((k) => [k, fields[k] ?? null]));
  }
  const person = ctx.rowsRaw('user').find((u) => String(ctx.own(u).id) === String(r.id));
  return person ? account(ctx, String(person.login)) : { id: r.id };
}

/** An environment as answered: its protection rules and branch policy. */
function environmentAnswer(ctx: HandlerContext, e: Row): Row {
  return shown(ctx, e);
}

/** repos/get-all-environments: the repository's environments, as `{ total_count, environments }`, to anyone who reads it
 *  ("Anyone with read access to the repository can use this endpoint"). */
// source: https://docs.github.com/en/rest/deployments/environments "Anyone with read access to the repository can use this endpoint."
export async function repos_get_all_environments(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const all = ctx.rowsRaw('environment').filter((e) => e._repo === repo.full_name && e.deleted !== true);
  return json({ total_count: all.length, environments: page(ctx, all).map((row) => environmentAnswer(ctx, row)) });
}

/** repos/create-or-update-environment: made with the protection it names, or changed to it (200 either way), by an
 *  admin. Its deployment branch policy is protected branches or custom policies, never both, and reviewers are at most
 *  six. */
// source: https://docs.github.com/en/rest/deployments/environments "Create or update an environment with protection rules, such as required reviewers."
// source: https://docs.github.com/en/rest/deployments/environments "422 Validation error when the environment name is invalid or when protected_branches and custom_branch_policies in deployment_branch_policy are set to the same value"
// source: https://docs.github.com/en/rest/deployments/environments "You can list up to six users or teams as reviewers."
export async function repos_create_or_update_environment(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const name = String(ctx.call.params.environment_name ?? '');
  const b = bodyOf(ctx);
  const policy = b.deployment_branch_policy as Row | null | undefined;
  if (policy && policy.protected_branches === policy.custom_branch_policies) return invalid('Environment', 'deployment_branch_policy', 'custom', 'Only one of `protected_branches` or `custom_branch_policies` can be set to true');
  const reviewers = Array.isArray(b.reviewers) ? (b.reviewers as Row[]) : [];
  if (reviewers.length > 6) return invalid('Environment', 'reviewers', 'invalid');
  const full = String(repo.full_name);
  const held = ctx.rowsRaw('environment').find((e) => e._repo === full && e.name === name);
  const at = nowIso(ctx);
  const id = held ? Number(held.id) : mint(ctx, 'environment');
  const rules: Row[] = [];
  if (typeof b.wait_timer === 'number' && b.wait_timer > 0) rules.push({ id: id * 10 + 1, node_id: nodeId('EnvironmentProtectionRule', id * 10 + 1), type: 'wait_timer', wait_timer: b.wait_timer });
  if (reviewers.length) rules.push({ id: id * 10 + 2, node_id: nodeId('EnvironmentProtectionRule', id * 10 + 2), type: 'required_reviewers', prevent_self_review: b.prevent_self_review === true, reviewers: reviewers.map((r) => ({ type: r.type, reviewer: reviewerOf(ctx, r) })) });
  if (policy) rules.push({ id: id * 10 + 3, node_id: nodeId('EnvironmentProtectionRule', id * 10 + 3), type: 'branch_policy' });
  const row = await ctx.write('environment', String(id), {
    id, node_id: nodeId('Environment', id), name, url: `https://api.github.com/repos/${full}/environments/${encodeURIComponent(name)}`, html_url: `https://github.com/${full}/deployments/activity_log?environments_filter=${encodeURIComponent(name)}`,
    created_at: held?.created_at ?? at, updated_at: at, _can_admins_bypass: b.can_admins_bypass === undefined ? (held?._can_admins_bypass ?? true) : b.can_admins_bypass === true,
    protection_rules: rules, deployment_branch_policy: policy ? { protected_branches: policy.protected_branches === true, custom_branch_policies: policy.custom_branch_policies === true } : null,
    _repo: full,
  }, held ? 'environment.updated' : 'environment.created');
  return json(environmentAnswer(ctx, row));
}

/** The environment the path names, as the repository holds it. */
const environmentOf = (ctx: HandlerContext, repo: Row): Row | undefined => ctx.rowsRaw('environment').find((e) => e._repo === repo.full_name && e.name === String(ctx.call.params.environment_name ?? ''));

/** repos/list-deployment-branch-policies: an environment's policies, as `{ total_count, branch_policies }`. */
// source: https://docs.github.com/en/rest/deployments/branch-policies "Lists the deployment branch policies for an environment."
export async function repos_list_deployment_branch_policies(ctx: HandlerContext): Promise<Response> {
  const env = environmentOf(ctx, repoOfPath(ctx));
  if (!env) return notFound(ctx);
  const all = ctx.rowsRaw('deployment_branch_policy').filter((p) => p._environment === `${String(env._repo)}/${String(env.name)}`).map((p) => shown(ctx, p));
  return json({ total_count: all.length, branch_policies: page(ctx, all) });
}

/** repos/create-deployment-branch-policy: a branch or tag name pattern an environment admits (200), when the
 *  environment's policy is custom, else 404; a pattern it has already, 303, with the policy it has. */
// source: https://docs.github.com/en/rest/deployments/branch-policies "404 Not Found or deployment_branch_policy.custom_branch_policies property for the environment is set to false"
// source: https://docs.github.com/en/rest/deployments/branch-policies "303 Response if the same branch name pattern already exists"
// source: https://docs.github.com/en/rest/deployments/branch-policies "Can be one of : branch , tag"
export async function repos_create_deployment_branch_policy(ctx: HandlerContext): Promise<Response> {
  const env = environmentOf(ctx, repoOfPath(ctx));
  if (!env || (env.deployment_branch_policy as Row | null)?.custom_branch_policies !== true) return notFound(ctx);
  const b = bodyOf(ctx);
  const name = str(b.name);
  if (!name) return invalid('DeploymentBranchPolicy', 'name', 'missing_field');
  const type = str(b.type) ?? 'branch';
  if (!['branch', 'tag'].includes(type)) return invalid('DeploymentBranchPolicy', 'type', 'invalid');
  const held = ctx.rowsRaw('deployment_branch_policy').find((p) => p._environment === `${String(env._repo)}/${String(env.name)}` && p.name === name && ctx.own(p).type === type);
  if (held) return json(shown(ctx, held), 303);
  const id = mint(ctx, 'deployment-branch-policy');
  const row = await ctx.write('deployment_branch_policy', String(id), { id, node_id: nodeId('DeploymentBranchPolicy', id), name, type, _environment: `${String(env._repo)}/${String(env.name)}`, _repo: env._repo }, 'deployment_branch_policy.created');
  return json({ id: row.id, node_id: row.node_id, name: row.name, type: row.type });
}

/** repos/delete-deployment-branch-policy: one of the environment's policies removed (204). */
// source: https://docs.github.com/en/rest/deployments/branch-policies "Deletes a deployment branch or tag policy for an environment."
export async function repos_delete_deployment_branch_policy(ctx: HandlerContext): Promise<Response> {
  const env = environmentOf(ctx, repoOfPath(ctx));
  const p = env ? ctx.row('deployment_branch_policy', String(ctx.call.params.branch_policy_id ?? '')) : undefined;
  if (!env || !p || p._environment !== `${String(env._repo)}/${String(env.name)}`) return notFound(ctx);
  await ctx.remove('deployment_branch_policy', String(p.id), 'deployment_branch_policy.deleted');
  return noContent();
}
