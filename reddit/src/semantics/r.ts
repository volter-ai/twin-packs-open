// Reddit's /r family: a community's listings (hot, new), its about, a post's comment tree under the community, and its
// moderators' invitations (friend, accept_moderator_invite).
import type { HandlerContext } from '@volter/world-core';
import { accountNamed, callerOf, commentsPage, err, hasScope, httpError, jsonAnswer, membership, MEMBERSHIP, noSuchCommunity, linksOf, linkThing, listing, paramsOf, slice, sortLinks, subredditNamed, subredditView } from './shared.ts';

/** A community's listing in an order: its live posts, sliced by after, before and limit. */
function communityListing(ctx: HandlerContext, sort: 'hot' | 'new'): Response {
  const name = String(ctx.call.params.subreddit ?? '');
  const sr = subredditNamed(ctx, name);
  if (!sr) return noSuchCommunity(ctx, name, () => httpError(404));
  const viewer = callerOf(ctx)?.account;
  const params = Object.fromEntries(Object.entries(ctx.params).map(([k, v]) => [k, String(v ?? '')]));
  const things = sortLinks(ctx, linksOf(ctx, String(sr.id)), sort).map((l) => ({ fullname: `t3_${String(l.id)}`, thing: linkThing(ctx, l, viewer) }));
  const { page, after, before } = slice(things, (t) => t.fullname, params);
  return Response.json(listing(page.map((t) => t.thing), { after, before, dist: page.length }));
}

// source: spec:GET_r_subreddit_hot "This endpoint is a listing."
export async function GET_r_subreddit_hot(ctx: HandlerContext): Promise<Response> {
  return communityListing(ctx, 'hot');
}

// source: spec:GET_r_subreddit_new "This endpoint is a listing."
export async function GET_r_subreddit_new(ctx: HandlerContext): Promise<Response> {
  return communityListing(ctx, 'new');
}

// source: spec:GET_r_subreddit_about "Return information about the subreddit."
export async function GET_r_subreddit_about(ctx: HandlerContext): Promise<Response> {
  const name = String(ctx.call.params.subreddit ?? '');
  const sr = subredditNamed(ctx, name);
  if (!sr) return noSuchCommunity(ctx, name, () => httpError(404));
  return Response.json({ kind: 't5', data: subredditView(ctx, sr, callerOf(ctx)?.account) });
}

// source: spec:GET_r_subreddit_comments_article "Get the comment tree for a given Link article."
export async function GET_r_subreddit_comments_article(ctx: HandlerContext): Promise<Response> {
  return commentsPage(ctx, String(ctx.call.params.subreddit ?? ''));
}

// ── a community's moderators ────────────────────────────────────────────────────────────────────

/** The permissions a moderator holds, as r2's ModeratorPermissionSet reads a permissions string: comma-separated terms,
 *  each + or - and a permission it knows, or all. */
// source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/permissions.py "for term in encoded.split(',')"
const MOD_PERMISSIONS = ['all', 'access', 'config', 'flair', 'mail', 'posts', 'wiki'];
const validPermissions = (encoded: string): boolean => !encoded || encoded.split(',').every((term) => /^[+-]/.test(term) && MOD_PERMISSIONS.includes(term.slice(1)));

// source: spec:POST_r_subreddit_api_friend "Create a relationship between a user and another user or subreddit"
export async function POST_r_subreddit_api_friend(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  const sr = subredditNamed(ctx, String(ctx.call.params.subreddit ?? ''));
  // Where the documentation stops: Reddit documents no answer for a community it does not have; the twin answers 404.
  if (!sr) return httpError(404);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "attempts to add moderators now create moderator invites."
  const type = p.type === 'moderator' ? 'moderator_invite' : p.type;
  // Where the twin stops: the other relationships (contributor, banned, muted, wikibanned, wikicontributor, friend) are
  // not modelled, no demanded client makes one; they are answered as the gap is, as Reddit answers what it does not serve.
  if (type !== 'moderator_invite') return httpError(404);
  // source: spec:POST_r_subreddit_api_friend "moderator_invite: modothers"
  if (caller.via === 'bearer' && !hasScope(caller, 'modothers')) return httpError(403, { 'www-authenticate': 'Bearer realm="reddit", error="insufficient_scope"' });
  // only a moderator of the community invites; the twin's moderators hold every permission (its maker, or one who
  // accepted an invitation to all)
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "has_perms = container.is_unlimited_moderator(c.user)"
  if (!membership(ctx, String(sr.id), caller.account).moderator) return httpError(403);
  const invitee = accountNamed(ctx, p.name ?? '');
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "that user doesn't exist"
  if (!invitee) return jsonAnswer([err('USER_DOESNT_EXIST', 'name')]);
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubredditRelationships.test_moderator_invite__invalid_perm.json "invalid permissions string"
  if (!validPermissions(p.permissions ?? '')) return jsonAnswer([err('INVALID_PERMISSIONS', 'permissions')]);
  const key = `${String(sr.id)}:${String(invitee.id)}`;
  const held = ctx.row(MEMBERSHIP, key);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "if type == \"moderator_invite\" and container.is_moderator(friend):"
  if (held?.moderator === true) return jsonAnswer([err('ALREADY_MODERATOR', 'name')]);
  const refused = ctx.legal(MEMBERSHIP, 'moderator_invite', 'POST_r_subreddit_api_friend', held?.moderator_invite === true, 'true', key);
  if (refused) return jsonAnswer([err(String(refused.code ?? 'INVALID_OPTION'), 'name', refused.message)]);
  await ctx.write(MEMBERSHIP, key, { subreddit: sr.id, user: invitee.id, moderator: false, subscriber: held?.subscriber === true, moderator_invite: true, mod_permissions: p.permissions || '+all' }, 'membership.invite_moderator');
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubredditRelationships.test_moderator_invite__no_perms.json "type=moderator_invite"
  return jsonAnswer([]);
}

// source: spec:POST_r_subreddit_api_accept_moderator_invite "Accept an invite to moderate the specified subreddit."
export async function POST_r_subreddit_api_accept_moderator_invite(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const sr = subredditNamed(ctx, String(ctx.call.params.subreddit ?? ''));
  // Where the documentation stops: Reddit documents no answer for a community it does not have; the twin answers 404.
  if (!sr) return httpError(404);
  const key = `${String(sr.id)}:${caller.account}`;
  const held = ctx.row(MEMBERSHIP, key);
  // no invitation: NO_INVITE_FOUND, with no field (recorded)
  const invited = held?.moderator_invite === true;
  const refused = ctx.legal(MEMBERSHIP, 'moderator_invite', 'POST_r_subreddit_api_accept_moderator_invite', invited, invited ? 'false' : undefined, key);
  if (refused) return jsonAnswer([err(String(refused.code ?? 'NO_INVITE_FOUND'), null, refused.message)]);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "c.site.add_moderator(c.user, permissions=rel.get_permissions())"
  await ctx.write(MEMBERSHIP, key, { subreddit: sr.id, user: caller.account, moderator: true, subscriber: held?.subscriber === true, moderator_invite: false, mod_permissions: held?.mod_permissions ?? '+all' }, 'membership.accept_moderator_invite');
  // Where the documentation stops: no accepted invitation is recorded; the twin answers api_type=json's empty errors, as
  // a recorded invitation's answer is.
  return jsonAnswer([]);
}
