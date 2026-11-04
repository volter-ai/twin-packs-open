// Reddit's /user family: an account's listings (overview, submitted, comments, and its own votes, hidden and saved).
import type { HandlerContext } from '@volter/world-core';
import { accountNamed, callerOf, COMMENT, commentView, httpError, LINK, linkThing, listing, slice, sortLinks, VOTE, type Row } from './shared.ts';

// source: spec:GET_user_username_where "This endpoint is a listing."
export async function GET_user_username_where(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx);
  const params = Object.fromEntries(Object.entries(ctx.params).map(([k, v]) => [k, String(v ?? '')]));
  // `.json` names the JSON form of the listing (/user/<name>/submitted.json)
  const where = String(ctx.call.params.where ?? '').replace(/\.json$/, '');
  const account = accountNamed(ctx, String(ctx.call.params.username ?? ''));
  // an account Reddit does not have, or a listing it does not keep, is its 404
  if (!account) return httpError(404);
  // source: spec:GET_user_username_where "/user/{username}/gilded"
  const kinds = ['overview', 'submitted', 'comments', 'upvoted', 'downvoted', 'hidden', 'saved', 'gilded'];
  if (!kinds.includes(where)) return httpError(404);
  const self = caller?.account === account.id;
  // another account's votes, hidden and saved things are its own: 403 (recorded on 2016-03-12 for another user's downvoted)
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestRedditorListings.test_downvoted__other_user.json "403"
  if (['upvoted', 'downvoted', 'hidden', 'saved'].includes(where) && !self) return httpError(403);
  const viewer = caller?.account;
  const links = ctx.rowsRaw(LINK).filter((l) => l.author === account.name && l.removed_by_category !== 'deleted');
  const comments = ctx.rowsRaw(COMMENT).filter((c) => c.author === account.name && c._deleted !== true);
  const sort = params.sort === 'top' ? 'top' : params.sort === 'hot' ? 'hot' : 'new';
  let things: Array<{ fullname: string; thing: Row; created: number }> = [];
  const asLinks = (ls: Row[]): Array<{ fullname: string; thing: Row; created: number }> => sortLinks(ctx, ls, sort).map((l) => ({ fullname: `t3_${String(l.id)}`, thing: linkThing(ctx, l, viewer), created: Number(l.created_utc) }));
  const asComments = (cs: Row[]): Array<{ fullname: string; thing: Row; created: number }> => [...cs].sort((a, b) => Number(b.created_utc) - Number(a.created_utc)).map((c) => ({ fullname: `t1_${String(c.id)}`, thing: { kind: 't1', data: commentView(ctx, c, viewer) }, created: Number(c.created_utc) }));
  if (where === 'submitted') things = asLinks(links);
  else if (where === 'comments') things = asComments(comments);
  else if (where === 'overview') things = [...asLinks(links), ...asComments(comments)].sort((a, b) => b.created - a.created);
  else if (where === 'upvoted' || where === 'downvoted') {
    const dir = where === 'upvoted' ? 1 : -1;
    const voted = new Set(ctx.rowsRaw(VOTE).filter((v) => v.voter === account.id && v.dir === dir && String(v.thing).startsWith('t3_')).map((v) => String(v.thing).slice(3)));
    things = asLinks(ctx.rowsRaw(LINK).filter((l) => voted.has(String(l.id)) && l.removed_by_category !== 'deleted'));
  }
  // hidden, saved and gilded: the twin models no hiding, saving or awards, so these listings hold nothing
  const { page, after, before } = slice(things, (t) => t.fullname, params);
  return Response.json(listing(page.map((t) => t.thing), { after, before, dist: page.length }));
}
