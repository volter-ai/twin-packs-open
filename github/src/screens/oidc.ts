// GITHUB ACTIONS' OIDC PROVIDER — token.actions.githubusercontent.com (a content host,
// https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect):
// its discovery document and keys, and the token a job granted `id-token: write` asks for with the request token its
// runner handed it (semantics/doors.ts, runStart) — a JWT naming the run's repository, workflow, ref and commit, for the
// audience asked (the repository owner's URL unless named), good for five minutes, signed with the World's own key
// (ctx.signingKey, made once at random).
import { jwks, jwtSign, sha256, type HandlerContext } from '@volter/world-core';
import { nowSeconds } from '../semantics/shared.ts';

const ISSUER = 'https://token.actions.githubusercontent.com';
/** The provider's signing key: the World's, made once at random (ctx.signingKey), so a job's token verifies against
 *  this World's JWKS and no one forges one from the pack. */
const oidcKey = async (ctx: Pick<HandlerContext, 'signingKey'>) => ({ alg: 'RS256' as const, ...(await ctx.signingKey('github-actions-oidc')) });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '/.well-known/openid-configuration') {
    return Response.json({
      issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks`, subject_types_supported: ['public', 'pairwise'], response_types_supported: ['id_token'],
      claims_supported: ['sub', 'aud', 'exp', 'iat', 'iss', 'jti', 'nbf', 'ref', 'sha', 'repository', 'repository_id', 'repository_owner', 'repository_owner_id', 'run_id', 'run_number', 'run_attempt', 'actor', 'actor_id', 'workflow', 'workflow_ref', 'workflow_sha', 'head_ref', 'base_ref', 'event_name', 'ref_type', 'ref_protected', 'environment', 'job_workflow_ref', 'repository_visibility', 'runner_environment'],
      id_token_signing_alg_values_supported: ['RS256'], scopes_supported: ['openid'],
    });
  }
  if (path === '/.well-known/jwks') return Response.json(jwks((await oidcKey(ctx)).publicPem));
  if (path !== '/idtoken') return unknownPath();
  const token = /^bearer\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const request = token ? ctx.row('_id_token_request', sha256(token)) : undefined;
  if (!request || String(request.run) !== url.searchParams.get('run')) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  const run = ctx.row('workflow_run', String(request.run));
  const repo = run ? ctx.row('repository', String(run._repository_id)) : undefined;
  if (!run || !repo || run.status === 'completed') return Response.json({ message: 'The run has completed' }, { status: 401 });
  const ownerLogin = String((repo.owner as Record<string, unknown>).login);
  const owner = ctx.row('user', ownerLogin) ?? ctx.row('org', ownerLogin);
  const actorLogin = String((run.actor as Record<string, unknown>).login);
  const actor = ctx.row('user', actorLogin);
  const pull = ((run.pull_requests as Array<Record<string, unknown>> | undefined) ?? [])[0];
  const branch = String(run.head_branch ?? '');
  const tag = run.event === 'push' && ctx.git(`r${String(repo.id)}`).refs.get(`refs/tags/${branch}`) !== null;
  const ref = tag ? `refs/tags/${branch}` : pull ? `refs/pull/${String(pull.number)}/merge` : `refs/heads/${branch}`;
  const full = String(repo.full_name);
  const workflowRef = `${full}/${String(run.path)}@${ref}`;
  const now = nowSeconds(ctx);
  const value = jwtSign({
    iss: ISSUER, aud: url.searchParams.get('audience') ?? `https://github.com/${ownerLogin}`, sub: `repo:${full}:ref:${ref}`, jti: ctx.crypto.uuidFrom(`jti:${String(run.id)}:${ctx.occurredAt}`),
    ref, sha: run.head_sha, repository: full, repository_id: String(repo.id), repository_owner: ownerLogin, repository_owner_id: String(owner?.id ?? ''), repository_visibility: repo.private === true ? 'private' : 'public',
    run_id: String(run.id), run_number: String(run.run_number), run_attempt: String(run.run_attempt ?? 1), actor: actorLogin, actor_id: String(actor?.id ?? ''), workflow: run.name, workflow_ref: workflowRef,
    workflow_sha: run.head_sha, job_workflow_ref: workflowRef, job_workflow_sha: run.head_sha, event_name: run.event, ref_type: tag ? 'tag' : 'branch', ref_protected: 'false', runner_environment: 'github-hosted',
    head_ref: pull ? String((pull.head as Record<string, unknown>).ref) : '', base_ref: pull ? String((pull.base as Record<string, unknown>).ref) : '',
  }, await oidcKey(ctx), { now, expiresInSeconds: 300 });
  return Response.json({ value, count: 1 });
}

/** A malformed peer path beneath the issuer's host. */
function unknownPath(): Response {
  return Response.json({ message: 'Not Found' }, { status: 404 });
}
