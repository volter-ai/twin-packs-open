// Sessions, the `/sessions` family, as the Backend API lists, revokes and mints tokens for them (a session is made by the
// Frontend API's sign-up and sign-in, ../../fapi). Clerk's refusals are those of
// https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import { body, clerkError, invalid, membershipsOf, missing, ms, organizationOf, outOfRange, own, pageOf, query, SESSION_LIFETIME_MS, sessionToken, sha256 } from './shared.ts';

type Row = Record<string, unknown>;
/** ERRORS: 404 resource_not_found, "Session not found", "No session was found with id <sessionID>". */
const sessionNotFound = (id: unknown): Response => clerkError(404, 'resource_not_found', 'Session not found', `No session was found with id ${String(id)}`);
const sessionOfPath = (ctx: HandlerContext): Row | undefined => ctx.get('Session', String(ctx.call.params.session_id));
const STATUSES = ['abandoned', 'active', 'ended', 'expired', 'removed', 'replaced', 'revoked', 'pending'];

/** `GET /sessions`: filtered by `user_id`, `client_id` and `status` (spec: GetSessionList), newest first; a bare array
 *  unless `paginated` is true. */
export async function GetSessionList(ctx: HandlerContext): Promise<Response> {
  const q = query(ctx);
  const userId = q.get('user_id');
  const clientId = q.get('client_id');
  const status = q.get('status');
  if (status && !STATUSES.includes(status)) return invalid('status', `status must be one of ${STATUSES.join(', ')}.`);
  const rows = ctx.rows('Session')
    .filter((s) => (!userId || s.user_id === userId) && (!clientId || s.client_id === clientId) && (!status || (s.status ?? 'active') === status))
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .map((s) => ({ ...own(ctx, s), object: 'session' }));
  return q.get('paginated') === 'true' ? ctx.reply({ data: pageOf(ctx, rows), total_count: rows.length }) : ctx.reply(pageOf(ctx, rows));
}

/** `POST /sessions`: "Create a new active session for the provided user ID. This operation is intended only for use in
 *  testing, and is not available for production instances" (spec: createSession), as a World's instance is a
 *  development one. Clerk makes the session on a client of its own; the twin names that client by the session and keeps
 *  no row for it until a browser presents it. `active_organization_id` must be one of the user's organizations. */
// source: spec:createSession "Create a new active session for the provided user ID."
export async function createSession(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.user_id !== 'string' || !b.user_id) return missing('user_id');
  // ERRORS: UserNotFound, 404 resource_not_found, "No user was found with id <userID>"
  if (!ctx.get('User', b.user_id)) return clerkError(404, 'resource_not_found', 'not found', `No user was found with id ${b.user_id}`);
  let orgId: string | null = null;
  if (typeof b.active_organization_id === 'string' && b.active_organization_id) {
    const org = organizationOf(ctx, b.active_organization_id);
    // ERRORS: OrganizationNotFoundOrUnauthorized, 404
    if (!org || !membershipsOf(ctx, b.user_id).some((m) => m.organization_id === org.id)) return clerkError(404, 'organization_not_found_or_unauthorized', 'not found or unauthorized', "Given organization not found, or you don't have permission to access the organization");
    orgId = String(org.id);
  }
  const id = ctx.mint('Session');
  const at = ms(ctx);
  await ctx.write('Session', id, {
    object: 'session', user_id: b.user_id, client_id: `client_${sha256(`client:${id}`).slice(0, 27)}`, status: 'active', last_active_organization_id: orgId, actor: null,
    last_active_at: at, expire_at: at + SESSION_LIFETIME_MS, abandon_at: at + SESSION_LIFETIME_MS, created_at: at, updated_at: at,
  }, 'session.create');
  return ctx.reply({ ...own(ctx, ctx.get('Session', id)!), object: 'session' });
}

/** `POST /sessions/{id}/revoke`: "Sets the status of a session as 'revoked', which is an unauthenticated state." (the
 *  machine: ./states.ts) */
export async function RevokeSession(ctx: HandlerContext): Promise<Response> {
  const s = sessionOfPath(ctx);
  if (!s) return sessionNotFound(ctx.call.params.session_id);
  const refused = ctx.legal('Session', 'status', 'RevokeSession', s.status ?? 'active', 'revoked', String(s.id));
  // Clerk's pages give no code for revoking a session that is not active; its class's (400), the message stating the rule
  if (refused) return clerkError(refused.status, String(refused.code ?? 'invalid_action_for_session'), 'Invalid action for user session', refused.message);
  await ctx.write('Session', String(s.id), { status: 'revoked', updated_at: ms(ctx) }, 'session.revoke');
  return ctx.reply({ ...own(ctx, ctx.get('Session', String(s.id))!), object: 'session' });
}

/** The token's lifetime the call asks for (`expires_in_seconds`, spec: "minimum: 30", "maximum: 315360000"), or the
 *  default. */
function lifetime(ctx: HandlerContext): number | Response | undefined {
  const v = body(ctx).expires_in_seconds;
  if (v === undefined || v === null) return undefined;
  return outOfRange('expires_in_seconds', v, 30, 315_360_000) ?? (v as number);
}

/** `POST /sessions/{id}/tokens`: "Creates a session JSON Web Token (JWT) based on a session." An ended or revoked session
 *  has none (ERRORS: 401 authentication_invalid, "you need to supply an active session"). */
export async function CreateSessionToken(ctx: HandlerContext): Promise<Response> {
  const s = sessionOfPath(ctx);
  if (!s) return sessionNotFound(ctx.call.params.session_id);
  if ((s.status ?? 'active') !== 'active') return clerkError(401, 'authentication_invalid', 'Invalid authentication', 'Unable to authenticate the request, you need to supply an active session');
  const life = lifetime(ctx);
  if (life instanceof Response) return life;
  const orgId = typeof s.last_active_organization_id === 'string' && s.last_active_organization_id ? s.last_active_organization_id : null;
  return ctx.reply({ object: 'token', jwt: sessionToken(ctx, s, { orgId, ...(life !== undefined ? { lifetime: life } : {}) }) });
}
