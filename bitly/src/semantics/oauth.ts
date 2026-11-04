import type { HandlerContext } from '@volter/world-core';
import { issueAccessToken, readAccessToken, badRequest, clientSecret } from './shared.ts';

// source: https://dev.bitly.com/docs/getting-started/authentication/ "code value appended by Bitly"
export async function exchangeAccessToken(ctx: HandlerContext): Promise<Response> {
  const p = ctx.params;
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "authorization_code"
  if (p.grant_type !== undefined && p.grant_type !== 'authorization_code') return badRequest();
  const client = ctx.rowsRaw('_client').find(c => c.id === p.client_id);
  // Where the documentation stops: unrecognized clients/codes use the vendor's generic BAD_REQUEST envelope.
  if (!client || p.client_secret !== await clientSecret(ctx, String(client.id)) || p.redirect_uri !== client.redirect_uri) return badRequest();
  const code = ctx.rowsRaw('_code').find(c => c.sha256 === ctx.crypto.sha256(String(p.code ?? '')) && c.client_id === client.id);
  if (!code || code.used || code.redirect_uri !== p.redirect_uri) return badRequest();
  // Where the documentation stops: OAuth codes are single-use and consumed under the kernel's atomic change seam.
  let consumed = false;
  await ctx.change('_code', String(code.id), row => { if (row.used) return undefined; consumed = true; return { used: true }; }, 'exchangeAccessToken', { input: 'omit' });
  if (!consumed) return badRequest();
  const email = String(code.email);
  const token = await readAccessToken(ctx, ctx.row('_access_token', await issueAccessToken(ctx, email, String(client.id)))!);
  const login = String(ctx.rowsRaw('_person').find(r => r.email === email)?.login);
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "Accept"
  if (ctx.call.request.headers.get('accept')?.includes('application/json')) return Response.json({ access_token: token, login });
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "access_token=%s&login=%s"
  return new Response(new URLSearchParams({ access_token: token, login }).toString(), { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
}
