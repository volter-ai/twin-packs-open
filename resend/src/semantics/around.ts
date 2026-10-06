// RESEND'S FRONT: every API request's key. A request with no key is refused 401 missing_api_key; a key the team never
// made is refused as the API refuses it (400 validation_error, "API key is invalid"); a deleted key 403
// restricted_api_key "API key is not active". The team the key belongs to is named to the handler. Where the
// documentation stops: the unknown key's answer, as the API gives it. The received mail's download host is a page, not
// the API (../screens).
// source: https://resend.com/docs/api-reference/errors "API key is not active"
import type { HandlerContext } from '@volter/world-core';
import { KEY, refuse, TEAM_HEADER } from './shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  if (new URL(request.url).pathname === '/twin') return next();
  const bearer = /^Bearer\s+(\S+)/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return refuse({ status: 401, code: 'missing_api_key', message: 'Missing API key in the authorization header.' });
  const key = ctx.rowsRaw(KEY).find((k) => k._sha256 === ctx.crypto.sha256(bearer));
  if (!key) return refuse({ status: 400, code: 'validation_error', message: 'API key is invalid' });
  if (key.status !== 'active') return refuse({ status: 403, code: 'restricted_api_key', message: 'API key is not active' });
  const headers = new Headers(request.headers);
  headers.set(TEAM_HEADER, String(key._team));
  return next(new Request(request, { headers }));
}
