import type { HandlerContext } from '@volter/world-core';
import { CODEX_CLIENT, codexBody, codexCode, codexError, codexOpaque, codexTokens, epoch, sha256 } from './shared.ts';

// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "struct UserCodeResp"
export async function auth_usercode(ctx: HandlerContext): Promise<Response> {
  const b = codexBody(ctx);
  if (b.client_id !== CODEX_CLIENT) return codexError('invalid_request', 'Unknown OAuth client.');
  const id = ctx.mint('_codex_device');
  const code = ctx.crypto.digest('sha256', await ctx.secret(`codex:device:${id}`), 'hex').slice(0, 8).toUpperCase();
  const user_code = `${code.slice(0, 4)}-${code.slice(4)}`;
  // Source gives a fifteen-minute polling deadline. Code typography and interval are local policy.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "Duration::from_secs(15 * 60)"
  await ctx.write('_codex_device', id, { status: 'pending', user_code, _client: b.client_id, _expires: epoch(ctx) + 900 }, 'auth.usercode');
  return Response.json({ device_auth_id: id, user_code, interval: '5' });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND"
export async function auth_poll(ctx: HandlerContext): Promise<Response> {
  const b = codexBody(ctx), row = ctx.row('_codex_device', String(b.device_auth_id ?? ''));
  if (!row || b.user_code !== row.user_code || Number(row._expires) <= epoch(ctx)) return codexError('authorization_pending', 'Device code is invalid or expired.', 404);
  const refusal = ctx.legal('_codex_device', 'status', 'auth.poll', row.status, 'consumed');
  if (refusal) return ctx.refuse(refusal);
  await ctx.write('_codex_device', String(row.id), { status: 'consumed' }, 'auth.poll');
  return Response.json({ authorization_code: row._code, code_challenge: row._challenge, code_verifier: row._verifier });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "grant_type=authorization_code"
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/manager.rs "refresh_token_reused"
export async function auth_token(ctx: HandlerContext): Promise<Response> {
  const b = codexBody(ctx);
  if (b.client_id !== CODEX_CLIENT) return codexError('invalid_request', 'Unknown OAuth client.');
  if (b.grant_type === 'authorization_code') {
    const code = ctx.row('_codex_code', sha256(String(b.code ?? '')));
    if (!code || code._client !== b.client_id || code._redirect !== b.redirect_uri || Number(code._expires) <= epoch(ctx) || code._challenge !== ctx.crypto.digest('sha256', String(b.code_verifier ?? ''), 'base64url')) return codexError('invalid_grant', 'Authorization code or PKCE verifier is invalid.');
    const refusal = ctx.legal('_codex_code', 'status', 'auth.token', code.status, 'consumed');
    if (refusal) return ctx.refuse(refusal);
    const account = ctx.row('_codex_account', String(code._account))!;
    await ctx.write('_codex_code', String(code.id), { status: 'consumed' }, 'auth.token');
    return Response.json(await codexTokens(ctx, account, String(b.client_id)));
  }
  if (b.grant_type === 'refresh_token') {
    const grant = ctx.rowsRaw('_codex_grant').find(g => g._refresh_hash === sha256(String(b.refresh_token ?? '')) && g._client === b.client_id);
    if (!grant) return codexError('refresh_token_invalidated', 'Refresh token is invalid.', 401);
    if (Number(grant._refresh_expires) <= epoch(ctx)) return codexError('refresh_token_expired', 'Refresh token has expired.', 401);
    const refusal = ctx.legal('_codex_grant', 'status', 'auth.token', grant.status, 'rotated');
    if (refusal) return ctx.refuse(refusal);
    await ctx.write('_codex_grant', String(grant.id), { status: 'rotated' }, 'auth.token');
    return Response.json(await codexTokens(ctx, ctx.row('_codex_account', String(grant._account))!, String(b.client_id), String(grant._family)));
  }
  // Browser login opportunistically exchanges its ID token for an API-style token.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "openai-api-key"
  if (b.grant_type !== 'urn:ietf:params:oauth:grant-type:token-exchange' || b.requested_token !== 'openai-api-key' || b.subject_token_type !== 'urn:ietf:params:oauth:token-type:id_token') return codexError('unsupported_grant_type', 'Not Found', 404);
  const grant = ctx.rowsRaw('_codex_grant').find(g => g._id_token === b.subject_token && g.status !== 'revoked' && Number(g._expires) > epoch(ctx));
  return grant ? Response.json({ access_token: grant._access }) : codexError('invalid_grant', 'ID token is invalid.');
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/revoke.rs "Logout attempts to revoke the"
export async function auth_revoke(ctx: HandlerContext): Promise<Response> {
  const b = codexBody(ctx), grant = ctx.rowsRaw('_codex_grant').find(g => g._refresh === b.token || g._access === b.token);
  if (grant) for (const g of ctx.rowsRaw('_codex_grant').filter(g => g._family === grant._family)) {
    const refusal = ctx.legal('_codex_grant', 'status', 'auth.revoke', g.status, 'revoked');
    if (refusal) return ctx.refuse(refusal);
    await ctx.write('_codex_grant', String(g.id), { status: 'revoked' }, 'auth.revoke');
  }
  return new Response(null, { status: 200 });
}
