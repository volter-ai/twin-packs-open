// What Slack does around every Web API call (docs/contributing/architecture.md, "What an author writes": around): a
// method is reached by GET or POST whichever the spec names; the call's token is checked (not_authed, invalid_auth,
// token_revoked, account_inactive), and its scopes against the method's (missing_scope, with `needed` and `provided`).
import type { HandlerContext } from '@volter/world-core';
import { methodOf, missingScope } from '../engine/methods.ts';
import { caller } from './shared.ts';

const TOKENLESS = new Set(['oauth_access', 'oauth_token', 'oauth_v2_access', 'openid_connect_token', 'tooling_tokens_rotate']);

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  const method = methodOf(new URL(request.url).pathname);
  // "Methods can be called with HTTP GET or POST" (https://docs.slack.dev/apis/web-api/#basics): a call made with the
  // other one is the same call, its arguments where the spec's method carries them
  if (!method) return next();
  const asked = ctx.call.operation.id === 'unmatched' && request.method !== method.method ? await asSpecNames(request, method.method) : undefined;
  const by = caller(ctx, await tokenIn(asked ?? request));
  // a method taking no token: the OAuth exchanges (a client id and secret), and the refresh token's rotation;
  // every other, a scope or not, refuses a call with none ("not_authed: No authentication token provided")
  // source: https://docs.slack.dev/reference/methods/oauth.v2.access "client_secret"
  // source: https://docs.slack.dev/reference/methods/apps.manifest.create "not_authed"
  const tokenless = TOKENLESS.has(method.id);
  if ('error' in by) return tokenless && by.error === 'not_authed' ? next(asked) : Response.json({ ok: false, error: by.error });
  // source: https://docs.slack.dev/reference/methods/apps.connections.open "The token type used in this request is not allowed"
  if (method.id === 'apps_connections_open' && by.kind !== 'app') return Response.json({ ok: false, error: 'not_allowed_token_type' });
  const needed = missingScope(method, by.scopes);
  if (needed) return Response.json({ ok: false, error: 'missing_scope', needed, provided: (by.scopes as string[]).join(',') });
  return next(asked);
}

/** The token a call carries: its Authorization header, or its `token` argument (in the query, a form or JSON). */
async function tokenIn(request: Request): Promise<string | undefined> {
  const header = /^bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (header) return header;
  const url = new URL(request.url);
  if (url.searchParams.get('token')) return url.searchParams.get('token')!;
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const text = await request.clone().text();
  if ((request.headers.get('content-type') ?? '').includes('json')) { try { const t = (JSON.parse(text) as { token?: unknown }).token; return typeof t === 'string' ? t : undefined; } catch { return undefined; } }
  return new URLSearchParams(text).get('token') ?? undefined;
}

/** The call as the spec's HTTP method carries it: a GET's arguments in the query, a POST's as a form. */
async function asSpecNames(request: Request, method: string): Promise<Request> {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  if (method === 'GET') {
    const text = await request.text();
    const type = request.headers.get('content-type') ?? '';
    const args: Array<[string, string]> = type.includes('json')
      ? Object.entries((text ? JSON.parse(text) : {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      : [...new URLSearchParams(text)];
    for (const [k, v] of args) url.searchParams.set(k, v);
    headers.delete('content-type');
    return new Request(url, { method: 'GET', headers });
  }
  const form = new URLSearchParams(url.search);
  url.search = '';
  headers.set('content-type', 'application/x-www-form-urlencoded');
  return new Request(url, { method: 'POST', headers, body: form.toString() });
}
