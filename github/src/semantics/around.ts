// What GitHub does around every API call (docs/contributing/architecture.md, "What an author writes": around): a
// credential it does not take is 401; GraphQL needs one; a body that is not JSON is "Problems parsing JSON" (400). Under
// /repos/{owner}/{repo} the repository is found as GitHub finds it (without regard to case, the path then spelled as the
// repository's own name for the core and the handlers) and the caller's role there checked before anything answers: a
// repository the caller may not see is Not Found, and a change needs the role engine/access.ts names (a person without
// it: 404 for a private repository they cannot see, else 403; an App or run without the permission: "Resource not
// accessible by integration"). Every answer carries the token's scopes and the caller's rate-limit budget. Where the
// documentation stops: "Bad credentials", the GraphQL refusal's words and the 403s for a missing role are GitHub's.
import type { HandlerContext } from '@volter/world-core';
import { PERMISSION_FOR, PERMISSION_OF, ROLE_NEEDED } from '../engine/access.ts';
import { atLeast } from '../engine/objects.ts';
import { callerOf, nowSeconds, repoNamed, roleIn } from './shared.ts';

const DOCS = 'https://docs.github.com/rest';
const refuse = (status: number, message: string): Response => Response.json({ message, documentation_url: DOCS, status: String(status) }, { status });

// source: https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api "Authenticating with invalid credentials will initially return a 401 Unauthorized response."
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "If you send invalid JSON in the request body, you may receive a 400 Bad Request response and a "Problems parsing JSON" error message."
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "GitHub uses a 404 Not Found response instead of a 403 Forbidden response to avoid confirming the existence of private repositories."
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "If you are using a GitHub App or fine-grained personal access token and you receive a "Resource not accessible by integration" or "Resource not accessible by personal access token" error, then your token has insufficient permissions."
// source: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps "X-OAuth-Scopes lists the scopes your token has authorized."
// source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "The primary rate limit for unauthenticated requests is 60 requests per hour."
// source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "All of these requests count towards your personal rate limit of 5,000 requests per hour."
// source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "The rate limit for GITHUB_TOKEN is 1,000 requests per hour per repository."
// source: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "x-ratelimit-reset The time at which the current rate limit window resets, in UTC epoch seconds"
// source: https://docs.github.com/en/rest/about-the-rest-api/api-versions "Requests without the X-GitHub-Api-Version header will default to use the 2022-11-28 version."
export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const caller = callerOf(ctx);
  if (caller === 'bad') return refuse(401, 'Bad credentials');
  if (/^\/(api\/)?graphql$/.test(url.pathname) && request.method === 'POST' && !caller) return refuse(401, 'This endpoint requires you to be authenticated.');
  if (['POST', 'PUT', 'PATCH'].includes(request.method) && !/\/assets$/.test(url.pathname)) {
    const text = await request.clone().text();
    if (text.trim()) { try { JSON.parse(text); } catch { return refuse(400, 'Problems parsing JSON'); } }
  }
  let rewritten: Request | undefined;
  const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const op = ctx.call.operation.id;
  if (m && op !== 'unmatched') {
    const repo = repoNamed(ctx, decodeURIComponent(m[1]!), decodeURIComponent(m[2]!));
    const role = repo ? roleIn(ctx, repo, caller) : undefined;
    if (!repo || !role) return refuse(404, 'Not Found');
    const need = ROLE_NEEDED[op];
    if (need && !atLeast(role, need)) {
      if (caller?.kind === 'installation' || caller?.kind === 'actions') {
        const permission = PERMISSION_FOR[op] ?? PERMISSION_OF[op.split('/')[0]!] ?? 'contents';
        const granted = caller.permissions[permission];
        if (granted !== 'write' && granted !== 'admin') return refuse(403, 'Resource not accessible by integration');
      } else {
        return need === 'admin' ? refuse(403, 'Must have admin rights to Repository.') : role === 'read' && repo.private !== true ? refuse(403, 'Must have push access to repository') : refuse(404, 'Not Found');
      }
    }
    // the path as the repository's own name (GitHub matches names without regard to case; its children live under it)
    const canonical = `/repos/${String(repo.full_name)}${m[3] ?? ''}`;
    if (canonical !== url.pathname) rewritten = new Request(new URL(`${canonical}${url.search}`, url), request);
  }
  const answer = await next(rewritten);
  const headers = new Headers(answer.headers);
  if (caller?.kind === 'user') headers.set('x-oauth-scopes', caller.scopes === '*' ? 'admin:org, delete_repo, gist, notifications, project, repo, user, workflow, write:packages' : caller.scopes.join(', '));
  const limit = !caller ? 60 : caller.kind === 'actions' ? 1000 : 5000;
  headers.set('x-ratelimit-limit', String(limit));
  headers.set('x-ratelimit-remaining', String(limit - 1));
  headers.set('x-ratelimit-used', '1');
  headers.set('x-ratelimit-reset', String(nowSeconds(ctx) + 3600));
  headers.set('x-ratelimit-resource', /graphql/.test(url.pathname) ? 'graphql' : /^\/search\//.test(url.pathname) ? 'search' : 'core');
  headers.set('x-github-api-version-selected', '2022-11-28');
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
}
