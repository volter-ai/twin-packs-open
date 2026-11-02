// The device grant (RFC 8628), as auth.ts configures it: `verificationUri: ${issuer}/device`, codes for ten minutes,
// polled every five seconds. A command-line tool or a desktop widget asks for a code; the person approves it on the
// device page, or (RH2's iOS app) claims and approves it with a session of their own. Better Auth's own polling route and
// deny are called by no product and answer the gap.
import type { HandlerContext } from '@volter/world-core';
import { clientOf, DEVICE, issuerOf, live, nowSeconds, oauthError, type Row, SCOPES, serial, sessionUser, sessionOf } from './shared.ts';

const params = (ctx: HandlerContext): Row => (ctx.params ?? {}) as Row;
const body = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {});
const userCodeKey = (code: string): string => code.replace(/-/g, '').toUpperCase();
/** The pending device code a person's user code names. */
const byUserCode = (ctx: HandlerContext, code: string): Row | undefined =>
  ctx.rowsRaw(DEVICE).find((r) => r.deleted !== true && r.user_code_key === userCodeKey(code));

/** `POST /api/auth/device/code`: a device code and the code the person types, with where they type it. */
// source: spec:/paths/~1api~1auth~1device~1code/post "Request a device and user code"
export async function post_api_auth_device_code(ctx: HandlerContext): Promise<Response> {
  const p = params(ctx);
  // the client authenticates as at the token endpoint: a confidential one with its secret (RH2's widget), a public one
  // by its id alone (@volter/identity's shared client)
  const client = clientOf(ctx, p);
  if (!client) return oauthError(401, 'invalid_client', 'Invalid client ID');
  // drawn from a secret the World holds (ctx.secret): a device code is a credential until it is exchanged
  const device = ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:device:${String(client.client_id)}:${ctx.occurredAt}:${await serial(ctx, 'device')}`));
  const letters = ctx.crypto.lettersFrom(await ctx.secret(`volteridentity:user-code:${device}`), 8).toUpperCase();
  const userCode = `${letters.slice(0, 4)}-${letters.slice(4)}`;
  const scopes = String(p.scope ?? 'openid').split(/\s+/).filter((s) => SCOPES.includes(s) && s !== 'organizations');
  await ctx.record(DEVICE, { client: client.client_id, user_code_key: userCodeKey(userCode), scopes, status: 'pending', user: null, expires: nowSeconds(ctx) + 600 }, ctx.crypto.digest('sha256', device, 'hex'));
  return Response.json({ device_code: device, user_code: userCode, verification_uri: `${issuerOf(ctx)}/device`, verification_uri_complete: `${issuerOf(ctx)}/device?user_code=${userCode}`, expires_in: 600, interval: 5 }, { headers: { 'cache-control': 'no-store' } });
}

/** `GET /api/auth/device?user_code=`: a code's status; a signed-in person who asks claims a pending, unclaimed code,
 *  and only its claimant sees which client asked and for what. */
// source: spec:/paths/~1api~1auth~1device/get "Verify user code and get device authorization status"
export async function get_api_auth_device(ctx: HandlerContext): Promise<Response> {
  const userCode = String(params(ctx).user_code ?? '');
  const d = byUserCode(ctx, userCode);
  if (!d) return oauthError(400, 'invalid_request', 'Invalid user code');
  if (Number(d.expires) < nowSeconds(ctx)) return oauthError(400, 'expired_token', 'User code has expired');
  const user = sessionUser(ctx);
  let claimant = d.user as string | null;
  if (user && !claimant && d.status === 'pending') {
    claimant = String(user.id);
    await ctx.record(DEVICE, { ...ctx.own(d), user: claimant }, String(d.id));
  }
  const reviewer = user !== undefined && claimant === user.id;
  return Response.json({ user_code: userCode, status: d.status, ...(reviewer ? { client_id: d.client, scope: (d.scopes as string[]).join(' ') } : {}) });
}

/** `POST /api/auth/device/approve { userCode }`: the person who claimed a pending code approves it. */
// source: spec:/paths/~1api~1auth~1device~1approve/post "Approve device authorization"
export async function post_api_auth_device_approve(ctx: HandlerContext): Promise<Response> {
  const user = sessionUser(ctx);
  // source: spec:/paths/~1api~1auth~1device~1approve/post/responses/401/description "Unauthorized. Due to missing or invalid authentication."
  if (!user) return oauthError(401, 'unauthorized', 'Authentication required');
  const d = byUserCode(ctx, String(body(ctx).userCode ?? ''));
  if (!d) return oauthError(400, 'invalid_request', 'Invalid user code');
  if (Number(d.expires) < nowSeconds(ctx)) return oauthError(400, 'expired_token', 'User code has expired');
  if (d.status !== 'pending') return oauthError(400, 'invalid_request', 'Device code already processed');
  if (!d.user) return oauthError(400, 'invalid_request', 'Device code has not been claimed by a verifying session; call `GET /device` with the `user_code` while signed in before approving or denying');
  // source: spec:/paths/~1api~1auth~1device~1approve/post/responses/403/description "Forbidden. You do not have permission to access this resource or to perform this action."
  if (d.user !== user.id) return oauthError(403, 'access_denied', 'You are not authorized to approve this device authorization');
  const refusal = ctx.legal(DEVICE, 'status', 'post_api_auth_device_approve', d.status, 'approved', String(d.id));
  if (refusal) return ctx.refuse(refusal);
  await ctx.write(DEVICE, String(d.id), { status: 'approved', auth_time: Math.floor(Date.parse(String(sessionOf(ctx)?.created)) / 1000) }, 'post_api_auth_device_approve');
  return Response.json({ success: true });
}
