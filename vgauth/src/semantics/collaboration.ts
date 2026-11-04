import type { HandlerContext } from '@volter/world-core';
import { clerkApi, draw, fail, id, identity, invitationUrl, now, open, ORIGIN, participant, pkce, providerToken, redirect, reserveInvitation, seal, settings, shareCallback, validParticipant } from './shared.ts';
// source: recording:worker-source.txt "return json({ userId: identity.userId }, 200, request, env);"
export async function collaborationVerify(ctx: HandlerContext): Promise<Response> {
  const userId = await identity(ctx); return userId instanceof Response ? userId : ctx.reply({ userId });
}
// source: recording:worker-source.txt "Invalid collaboration handoff binding."
export async function collaborationHandoff(ctx: HandlerContext): Promise<Response> {
  const hostUserId = await identity(ctx); if (hostUserId instanceof Response) return hostUserId;
  const b = ctx.body as Record<string, unknown>; const callbackUrl = shareCallback(b.callbackUrl);
  if (!callbackUrl || !id(b.sessionId) || !id(b.invitationId)) return fail(400, 'Invalid collaboration handoff binding.');
  const verifier = ctx.crypto.digest('sha512', await draw(ctx), 'base64url').slice(0, 64); const expiresAt = now(ctx) + 600000;
  const base = { callbackUrl, sessionId: b.sessionId, invitationId: b.invitationId, hostUserId, expiresAt };
  const state = await seal(ctx, { kind: 'state', ...base, verifier });
  const u = new URL(settings(ctx).authorizationEndpoint);
  // source: recording:worker-source.txt "authorizationUrl.searchParams.set('scope', 'openid profile email user:org:read');"
  for (const [k,v] of Object.entries({ response_type:'code',client_id:settings(ctx).providerClientId,redirect_uri:`${ORIGIN}/collaboration/callback`,state,code_challenge:pkce(ctx,verifier),code_challenge_method:'S256',scope:'openid profile email user:org:read' })) u.searchParams.set(k,v);
  const deliveryAuthorization = await seal(ctx, { kind: 'invitation-delivery', ...base });
  return ctx.reply({ authorizationUrl: u.toString(), deliveryAuthorization, expiresAt }, 201);
}
// source: recording:worker-source.txt "const invitation = await clerk.invitations.createInvitation({"
export async function collaborationInvitation(ctx: HandlerContext): Promise<Response> {
  const host = await identity(ctx); if (host instanceof Response) return host;
  const config = settings(ctx);
  // source: recording:worker-source.txt "The Clerk twin does not deliver public invitation email."
  if (config.clerkApi) return fail(503, 'The Clerk twin does not deliver public invitation email.');
  // source: recording:worker-source.txt "Clerk invitation delivery is not configured."
  if (!config.publishableKey) return fail(503, 'Clerk invitation delivery is not configured.');
  const b = ctx.body as Record<string, unknown>;
  const emailAddress = typeof b.emailAddress === 'string' ? b.emailAddress.trim().toLowerCase() : '';
  const redirectUrl = invitationUrl(b.redirectUrl); const callbackUrl = shareCallback(b.callbackUrl);
  // source: recording:worker-source.txt "Invalid collaboration invitation delivery request."
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) || emailAddress.length > 320 || !redirectUrl || !callbackUrl || !id(b.sessionId) || !id(b.invitationId) || typeof b.deliveryAuthorization !== 'string' || !b.deliveryAuthorization || b.deliveryAuthorization.length > 32768 || new URL(redirectUrl).origin !== new URL(callbackUrl).origin || typeof b.expiresAt !== 'number' || b.expiresAt <= now(ctx) || b.expiresAt > now(ctx) + 86400000) return fail(400, 'Invalid collaboration invitation delivery request.');
  const auth = await open(ctx, b.deliveryAuthorization);
  // source: recording:worker-source.txt "Invalid or expired invitation delivery authorization."
  if (!auth || auth.kind !== 'invitation-delivery' || !shareCallback(auth.callbackUrl) || !id(auth.sessionId) || !id(auth.invitationId) || !id(auth.hostUserId) || typeof auth.expiresAt !== 'number' || auth.expiresAt <= now(ctx) || auth.hostUserId !== host || auth.callbackUrl !== callbackUrl || auth.sessionId !== b.sessionId || auth.invitationId !== b.invitationId) return fail(401, 'Invalid or expired invitation delivery authorization.');
  // source: recording:worker-source.txt "Collaboration invitation rate limiting is not configured."
  if (!config.invitationRateLimit) return fail(503, 'Collaboration invitation rate limiting is not configured.');
  const retry = await reserveInvitation(ctx, host, emailAddress);
  // source: recording:worker-source.txt "Invitation delivery rate limit exceeded."
  if (retry) return Response.json({ error: 'Invitation delivery rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' } });
  const response = await ctx.vendorFetch(`${clerkApi(ctx)}/v1/invitations`, { method: 'POST', headers: { Authorization: `Bearer ${config.clerkKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email_address: emailAddress, redirect_url: redirectUrl, notify: true, ignore_existing: true, expires_in_days: 1 }) });
  // source: recording:worker-source.txt "error instanceof Error ? error.message : 'Authorization failed'"
  // Clerk SDK refusals reach the Worker's documented 502 catch; no invitation success is fabricated.
  if (!response.ok) { const error = await response.json().catch(() => null); return fail(502, error?.errors?.[0]?.long_message ?? error?.errors?.[0]?.message ?? 'Authorization failed'); }
  const invitation = await response.json();
  return ctx.reply({ id: invitation.id, status: invitation.status, emailAddress: invitation.email_address }, 201);
}
// source: recording:worker-source.txt "This collaboration authorization is invalid or expired."
export async function collaborationCallback(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams; const s = await open(ctx, q.get('state')); const code = q.get('code');
  if (!s || s.kind !== 'state' || !shareCallback(s.callbackUrl) || !id(s.sessionId) || !id(s.invitationId) || !id(s.hostUserId) || typeof s.verifier !== 'string' || typeof s.expiresAt !== 'number' || s.expiresAt <= now(ctx) || !code) return fail(400, 'This collaboration authorization is invalid or expired.');
  const response = await providerToken(ctx, new URLSearchParams({ grant_type:'authorization_code',client_id:settings(ctx).providerClientId,code,redirect_uri:`${ORIGIN}/collaboration/callback`,code_verifier:s.verifier }));
  const token = await response.json().catch(() => null);
  // source: recording:worker-source.txt "VGAI account authorization failed."
  if (!response.ok || typeof token?.access_token !== 'string') return fail(401, 'VGAI account authorization failed.');
  const userId = await identity(ctx, token.access_token); if (userId instanceof Response) return userId;
  const p = await participant(ctx, userId);
  // source: recording:worker-source.txt "The authenticated VGAI account has no public profile."
  if (!p) return fail(403, 'The authenticated VGAI account has no public profile.');
  const grant = await seal(ctx, { kind:'grant',sessionId:s.sessionId,invitationId:s.invitationId,hostUserId:s.hostUserId,participant:p,jti:ctx.crypto.digest('sha256', await draw(ctx), 'base64url').slice(0,32),expiresAt:now(ctx)+120000 });
  const u = new URL(s.callbackUrl); u.hash = `grant=${encodeURIComponent(grant)}`; return redirect(u.toString());
}
// source: recording:worker-source.txt "Invalid or expired collaboration grant."
export async function collaborationRedeem(ctx: HandlerContext): Promise<Response> {
  const b = ctx.body as Record<string, unknown>; const g = await open(ctx, b.grant);
  if (!g || g.kind !== 'grant' || !id(g.sessionId) || !id(g.invitationId) || !id(g.hostUserId) || !id(g.jti) || typeof g.expiresAt !== 'number' || g.expiresAt <= now(ctx) || !id(b.sessionId) || !id(b.invitationId) || b.sessionId !== g.sessionId || b.invitationId !== g.invitationId || !validParticipant(g.participant)) return fail(401, 'Invalid or expired collaboration grant.');
  return ctx.reply({ participant: g.participant, jti: g.jti, hostUserId: g.hostUserId });
}
