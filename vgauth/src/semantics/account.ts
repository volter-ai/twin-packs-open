import type { HandlerContext } from '@volter/world-core';
import { accountRedirect, bounded, draw, fail, now, open, ORIGIN, pkce, providerToken, redirect, seal, settings } from './shared.ts';
// source: recording:worker-source.txt "Invalid editor account authorization request."
export async function accountAuthorize(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const redirectUri = accountRedirect(ctx, q.get('redirect_uri')); const clientState = q.get('state'); const clientChallenge = q.get('code_challenge');
  if (q.get('response_type') !== 'code' || q.get('client_id') !== settings(ctx).clientId || q.get('code_challenge_method') !== 'S256' || !redirectUri || !bounded(clientState) || !clientChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(clientChallenge)) return fail(400, 'Invalid editor account authorization request.');
  // source: recording:worker-source.txt "expiresAt: Date.now() + 10 * 60_000,"
  const providerVerifier = ctx.crypto.digest('sha512', await draw(ctx), 'base64url').slice(0, 64);
  const state = await seal(ctx, { kind: 'account-state', redirectUri, clientState, clientChallenge, providerVerifier, expiresAt: now(ctx) + 600000 });
  const u = new URL(settings(ctx).authorizationEndpoint);
  for (const [k,v] of Object.entries({ response_type: 'code', client_id: settings(ctx).providerClientId, redirect_uri: `${ORIGIN}/account/callback`, state, code_challenge: pkce(ctx, providerVerifier), code_challenge_method: 'S256', scope: 'openid profile email user:org:read' })) u.searchParams.set(k,v);
  return redirect(u.toString());
}
// source: recording:worker-source.txt "This editor account authorization is invalid or expired."
export async function accountCallback(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams; const state = await open(ctx, q.get('state')); const providerCode = q.get('code');
  if (!state || state.kind !== 'account-state' || !accountRedirect(ctx, state.redirectUri) || !bounded(state.clientState) || !/^[A-Za-z0-9_-]{43,128}$/.test(state.clientChallenge ?? '') || typeof state.providerVerifier !== 'string' || state.providerVerifier.length < 43 || typeof state.expiresAt !== 'number' || state.expiresAt <= now(ctx) || !bounded(providerCode, 2048)) return fail(400, 'This editor account authorization is invalid or expired.');
  // source: recording:worker-source.txt "expiresAt: Date.now() + 2 * 60_000,"
  const code = await seal(ctx, { kind: 'account-code', providerCode, redirectUri: state.redirectUri, clientChallenge: state.clientChallenge, providerVerifier: state.providerVerifier, expiresAt: now(ctx) + 120000 });
  const u = new URL(state.redirectUri); u.searchParams.set('code', code); u.searchParams.set('state', state.clientState); return redirect(u.toString());
}
// source: recording:worker-source.txt "return json({ error: 'invalid_client' }, 401, request, env);"
export async function accountToken(ctx: HandlerContext): Promise<Response> {
  const b = new URLSearchParams(ctx.text); const config = settings(ctx);
  if (b.get('client_id') !== config.clientId) return fail(401, 'invalid_client');
  const upstream = new URLSearchParams({ client_id: config.providerClientId });
  if (b.get('grant_type') === 'authorization_code') {
    const code = await open(ctx, b.get('code'));
    // source: recording:worker-source.txt "return json({ error: 'invalid_grant' }, 400, request, env);"
    if (!code || code.kind !== 'account-code' || !accountRedirect(ctx, code.redirectUri) || typeof code.expiresAt !== 'number' || code.expiresAt <= now(ctx) || b.get('redirect_uri') !== code.redirectUri || pkce(ctx, b.get('code_verifier') ?? '') !== code.clientChallenge) return fail(400, 'invalid_grant');
    upstream.set('grant_type', 'authorization_code'); upstream.set('code', code.providerCode); upstream.set('redirect_uri', `${ORIGIN}/account/callback`); upstream.set('code_verifier', code.providerVerifier);
  } else if (b.get('grant_type') === 'refresh_token' && b.get('refresh_token')) { upstream.set('grant_type', 'refresh_token'); upstream.set('refresh_token', b.get('refresh_token')!); }
  // source: recording:worker-source.txt "return json({ error: 'unsupported_grant_type' }, 400, request, env);"
  else return fail(400, 'unsupported_grant_type');
  const response = await providerToken(ctx, upstream); return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' } });
}
