// The `/oauth_callback` family: where a social connection's provider returns the browser after the person decided
// (spec: getOauthCallback, "The endpoint where the OAuth providers redirect to after a successful authentication
// attempt"). The instance trades the provider's code for the person at the provider's token endpoint, as its OAuth
// client — in a World the provider is the World's own twin of it (googleoauth for Google), reached by the kernel's
// `ctx.vendorFetch` — and the sign-in the state names then completes for a person the instance holds by that address,
// or becomes `transferable` for one it does not. The browser goes back to where the sign-in asked (clerk-js's
// `/sso-callback`, which finishes a complete sign-in and turns a transferable one into a sign-up).
import { type HandlerContext } from '@volter/world-core';
import {
  frontendGap,  authSettings, createSession, ms, oauthCallbackUrl, PROVIDERS, remember, rootOf, type Row, userByEmail,
} from './shared.ts';

/** The provider's person behind a code: the code exchanged at the provider's token endpoint, as the instance's OAuth
 *  client, for the OpenID Connect ID token that names the person (its `sub`, `email`, `given_name`, `family_name`);
 *  or why the exchange failed. */
async function personOf(ctx: HandlerContext, provider: { token: string }, connection: { client_id: string; client_secret: string }, code: string, redirectUri: string): Promise<{ email: string; firstName: string | null; lastName: string | null; sub: string } | string> {
  // The kernel owns unreachable-provider refusals; a configured provider's HTTP refusal is handled below.
  const answer = await ctx.vendorFetch(provider.token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: connection.client_id, client_secret: connection.client_secret, redirect_uri: redirectUri }).toString(),
  });
  const body = (await answer.json().catch(() => ({}))) as Row;
  if (!answer.ok || typeof body.id_token !== 'string') return `the provider answered ${answer.status} ${String(body.error ?? '')}`.trim();
  let claims: Row;
  try { claims = ctx.crypto.jwtDecode(body.id_token).payload; } catch { return 'the provider\'s ID token could not be read'; }
  if (typeof claims.email !== 'string' || typeof claims.sub !== 'string') return 'the provider\'s ID token names no email';
  const name = typeof claims.name === 'string' ? claims.name.trim() : '';
  const given = typeof claims.given_name === 'string' ? claims.given_name : name.split(/\s+/)[0] || null;
  const family = typeof claims.family_name === 'string' ? claims.family_name : name.split(/\s+/).slice(1).join(' ') || null;
  return { email: claims.email.toLowerCase(), firstName: given, lastName: family, sub: claims.sub };
}

/** `GET /v1/oauth_callback`: the provider's answer for the sign-in its `state` names — a code, or an `error` — settled,
 *  and the browser redirected to the sign-in's `redirect_url`. */
// source: spec:getOauthCallback "The endpoint where the OAuth providers redirect to after a successful authentication attempt."
// source: spec:getOauthCallback "returned exchange code from OAuth provider."
// source: spec:getOauthCallback "returned state from OAuth provider."
export async function getOauthCallback(ctx: HandlerContext): Promise<Response> {
  const state = typeof ctx.params.state === 'string' ? ctx.params.state : '';
  const si = state === '' ? undefined : ctx.rowsRaw('Client.SignIn').find((r) => r._oauth_state === state);
  if (!si) return frontendGap(ctx, true);
  const id = String(si.id);
  const clientId = String(si._client_id);
  const verification = (si.first_factor_verification ?? {}) as Row;
  const strategy = String(verification.strategy);
  const back = (): Response => ctx.raw(null, { status: 303, headers: { location: String(si._redirect_url) } });
  const root = await rootOf(ctx);
  const settle = async (fields: Row, to: string): Promise<Response> => {
    const refused = ctx.legal('Client.SignIn', 'status', ctx.call.operation.id, String(si.status ?? 'needs_identifier'), to, id);
    if (refused) return ctx.refuse(refused);
    await ctx.write('Client.SignIn', id, { ...fields, status: to, updated_at: ms(ctx) }, 'sign_in.update');
    await remember(ctx, clientId, { sign_in: to === 'complete' ? null : id, ...(to === 'complete' ? { strategy } : {}) });
    return back();
  };
  const failed = (message: string, code: string): Promise<Response> =>
    settle({ first_factor_verification: { ...verification, status: 'failed', error: { code, message, long_message: message } } }, 'needs_identifier');
  // the person declined, or the provider refused: the sign-in's verification fails, and the page shows why
  if (typeof ctx.params.error === 'string') return failed(`The provider answered ${ctx.params.error}.`, 'oauth_access_denied');
  const connection = authSettings(root).social[strategy];
  const provider = PROVIDERS[strategy];
  const code = typeof ctx.params.code === 'string' ? ctx.params.code : '';
  if (!connection || !provider || code === '') return failed('The provider returned no code.', 'oauth_token_retrieval_error');
  if (typeof verification.expire_at === 'number' && ms(ctx) > verification.expire_at) {
    return settle({ first_factor_verification: { ...verification, status: 'expired' } }, 'needs_identifier');
  }
  const grant = await personOf(ctx, provider, connection, code, oauthCallbackUrl(root));
  if (typeof grant === 'string') return failed(`The provider's code could not be redeemed: ${grant}.`, 'oauth_token_retrieval_error');
  const external: Row = { provider: provider.name.toLowerCase(), provider_user_id: grant.sub, email: grant.email, first_name: grant.firstName, last_name: grant.lastName };
  const user = userByEmail(root, grant.email);
  if (!user) {
    // no account for the person: "transferable", the sign-in handing the person to a sign-up
    // source: spec:/components/schemas/Stubs.Verification.Oauth "transferable"
    return settle({ first_factor_verification: { ...verification, status: 'transferable', error: { code: 'external_account_not_found', message: 'The External Account was not found.', long_message: 'The External Account was not found.' } }, identifier: grant.email, _external: external }, 'needs_identifier');
  }
  const session = await createSession(ctx, root, String(user.id), clientId);
  return settle({ first_factor_verification: { ...verification, status: 'verified', error: null }, identifier: grant.email, _user_id: user.id, _external: external, created_session_id: String(session.id) }, 'complete');
}
