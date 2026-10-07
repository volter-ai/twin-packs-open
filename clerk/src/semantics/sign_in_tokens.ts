// Sign-in tokens, the `/sign_in_tokens` family (https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token):
// a ticket the Backend API makes for one user, which the Frontend API takes once to sign them in (strategy `ticket`,
// ../../fapi). A token is `pending` until it is used (`accepted`) or revoked (the machine: ./states.ts). Clerk's refusals
// are those of https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import { body, clerkError, invalid, membershipsOf, missing, ms, notFound, organizationOf, organizationsOff, own, signJwt } from './shared.ts';

type Row = Record<string, unknown>;
/** "By default, sign-in tokens expire in 30 days" (spec: CreateSignInToken, `expires_in_seconds` default 2592000,
 *  minimum 1). */
// source: spec:CreateSignInToken "By default, sign-in tokens expire in 30 days."
const DEFAULT_EXPIRY_SECONDS = 2_592_000;
const view = (ctx: HandlerContext, row: Row): Row => ({ ...own(ctx, row), object: 'sign_in_token' });

/** `POST /sign_in_tokens`: "Creates a new sign-in token and associates it with the given user." The token is a ticket
 *  signed with the instance's key naming the sign-in token (`st: 'sign_in_token'`, `sid`), expiring with it; `org_id`
 *  names the organization its session opens in: "Organizations must be enabled for the instance, and the user must be a
 *  member of the organization." Clerk's pages do not say where a sign-in token's `url` points; the twin gives none (the
 *  spec lets it be null), and the token is what a client signs in with (`signInWithTicket`). */
export async function CreateSignInToken(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.user_id !== 'string' || !b.user_id) return missing('user_id');
  // ERRORS: UserNotFound, 404 resource_not_found, "No user was found with id <userID>"
  if (!ctx.get('User', b.user_id)) return clerkError(404, 'resource_not_found', 'not found', `No user was found with id ${b.user_id}`);
  const seconds = b.expires_in_seconds ?? DEFAULT_EXPIRY_SECONDS;
  // spec: `expires_in_seconds` is an integer, "minimum: 1"
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1) return invalid('expires_in_seconds', 'expires_in_seconds must be an integer of at least 1.');
  let orgId: string | null = null;
  if (typeof b.org_id === 'string' && b.org_id) {
    const off = organizationsOff(ctx);
    if (off) return off;
    const org = organizationOf(ctx, b.org_id);
    // ERRORS: OrganizationNotFound, 404 resource_not_found, "Given organization not found."
    if (!org) return clerkError(404, 'resource_not_found', 'not found', 'Given organization not found.');
    // ERRORS: NotAMemberInOrganization, 403 not_a_member_in_organization
    // source: spec:CreateSignInToken "the user must be a member of the organization"
    if (!membershipsOf(ctx, b.user_id).some((m) => m.organization_id === org.id)) return clerkError(403, 'not_a_member_in_organization', 'not a member', 'Current user is not a member of the organization. Only organization members can perform this action.');
    orgId = String(org.id);
  }
  const id = ctx.mint('SignInToken');
  const at = ms(ctx);
  const token = signJwt(ctx, { st: 'sign_in_token', sid: id }, { now: Math.floor(at / 1000), expiresInSeconds: seconds });
  await ctx.write('SignInToken', id, {
    object: 'sign_in_token', user_id: b.user_id, status: 'pending', token, url: null, created_at: at, updated_at: at,
    _org_id: orgId, _expires_at: at + seconds * 1000,
  }, 'sign_in_token.create');
  return ctx.reply(view(ctx, ctx.row('SignInToken', id)!));
}

/** `POST /sign_in_tokens/{id}/revoke`: "Revokes a pending sign-in token"; one no longer pending is ERRORS'
 *  SignInTokenCannotBeRevoked (the machine's refusal, ./states.ts). */
export async function RevokeSignInToken(ctx: HandlerContext): Promise<Response> {
  const row = ctx.row('SignInToken', String(ctx.call.params.sign_in_token_id));
  if (!row) return notFound();
  const status = String(row.status ?? 'pending');
  const refused = ctx.legal('SignInToken', 'status', 'RevokeSignInToken', status, 'revoked', String(row.id));
  // source: https://clerk.com/docs/guides/development/errors/backend-api "Only pending tokens can be revoked."
  if (refused) return clerkError(refused.status, String(refused.code ?? 'sign_in_token_cannot_be_revoked_code'), 'cannot revoke', `Sign in token cannot be revoked because its status is ${status}. Only pending tokens can be revoked.`);
  await ctx.write('SignInToken', String(row.id), { status: 'revoked', updated_at: ms(ctx) }, 'sign_in_token.revoke');
  return ctx.reply(view(ctx, ctx.row('SignInToken', String(row.id))!));
}
