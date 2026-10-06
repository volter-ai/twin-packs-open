// GitHub's organization memberships (https://docs.github.com/en/rest/orgs/members): a person's own membership, and a
// member's as another member of the organization reads it, and the organizations a person belongs to. An organization's owner is its member from its making (the
// orgs door).
import type { HandlerContext } from '@volter/world-core';
import { simpleOrg } from '../engine/objects.ts';
import { account, fail, hasScope, json, membershipOf, notFound, page, type Row, shown, who } from './shared.ts';

/** A membership as answered: the stored one with its organization and person. */
function membershipAnswer(ctx: HandlerContext, m: Row): Row {
  const org = ctx.row('org', String(m._org))!;
  // stored under `<org>::<login>`, a key GitHub's membership does not carry
  const { id: _key, ...own } = shown(ctx, m);
  return { ...own, organization: simpleOrg(ctx.own(org)), user: account(ctx, String(m._login)) };
}

/** orgs/get-membership-for-authenticated-user: the caller's own membership; none, 404. */
// source: spec:orgs/get-membership-for-authenticated-user "If the authenticated user is an active or pending member of the organization, this endpoint will return the user's membership. If the authenticated user is not affiliated with the organization, a `404` is returned."
export async function orgs_get_membership_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (c?.kind !== 'user') return fail(ctx, 401, 'Requires authentication');
  const m = membershipOf(ctx, String(ctx.call.params.org ?? ''), c.login);
  return m ? json(membershipAnswer(ctx, m)) : notFound(ctx);
}

/** orgs/get-membership-for-user: a person's membership as a member of the organization reads it ("the authenticated
 *  user must be an organization member"): an owner sees a pending invitation too, another member an active membership
 *  only; anyone else, or a person who is no member, 404. */
// source: https://docs.github.com/en/rest/orgs/members "In order to get a user's membership with an organization, the authenticated user must be an organization member."
export async function orgs_get_membership_for_user(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  if (!ctx.row('org', org)) return notFound(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  const mine = c.kind === 'user' ? membershipOf(ctx, org, c.login) : undefined;
  if (mine?.state !== 'active') return notFound(ctx);
  const m = membershipOf(ctx, org, String(ctx.call.params.username ?? ''));
  if (!m || (m.state !== 'active' && mine.role !== 'admin')) return notFound(ctx);
  return json(membershipAnswer(ctx, m));
}

/** orgs/list-for-authenticated-user: the organizations the caller is an active member of, each as GitHub names one, to a
 *  token with `user` or `read:org` (403 otherwise; where the documentation stops, the refusal's words are GitHub's). */
// source: https://docs.github.com/en/rest/orgs/orgs "Therefore, this API requires at least user or read:org scope for OAuth app tokens and personal access tokens (classic)"
// source: spec:orgs/list-for-authenticated-user "Requests with insufficient scope will receive a `403 Forbidden` response."
export async function orgs_list_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (c.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  if (!hasScope(c, 'user') && !hasScope(c, 'read:org')) return fail(ctx, 403, 'Resource not accessible by personal access token');
  const orgs = ctx.rowsRaw('org_membership').filter((m) => m._login === c.login && m.state === 'active').map((m) => ctx.row('org', String(m._org))).filter((o): o is Row => !!o);
  return json(page(ctx, orgs).map((o) => simpleOrg(ctx.own(o))));
}
