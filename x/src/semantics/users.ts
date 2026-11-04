// User lookup (https://docs.x.com/x-api/users/lookup): by id, by username, and the person the credential names
// (GET /2/users/me, https://docs.x.com/x-api/users/get-my-user, with its own 15-minute window). A user nobody has is X's
// partial 200 (`errors` with `resource_type: "user"`), the same envelope a missing post takes.
//
// An account's own posts (https://docs.x.com/x-api/posts/timelines), newest first by id, windowed and paged: the one
// timeline an application here reads (account analytics).
//
// A repost (spec:repostPost): the user's own repost of a post, `POST /2/users/{id}/retweets`,
// made once and counted in the post's retweet_count (an auto-repost rule).
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { applyWindow, decide, findAccount, forbiddenProblem, invalidRequestProblem, isAnswer, isReadRequest, isReply, isUserFields, livePosts, lookupResult, NOSTORE, nowSeconds, ofType, opening, parseExclude, parseReadRequest, parseUserLookup, PBS_BASE, projectUser, rateLimitExceeded, type Resource, resourceNotFoundError, resourceNotFoundProblem, type Row, type Rows, rowsFor, send, timelinePage, unauthorizedProblem, urlOf, type XResponse, findPost, ok, payloadOf, postIdField, putRev, adjustPostMetrics } from './shared.ts';


/** GET /2/users/me: 75 requests / 15 min per user (docs.x.com/x-api/fundamentals/rate-limits, fetched 2026-08-21). */
const USERS_ME_RATE_LIMIT = 75;
const RATE_WINDOW_SECONDS = 15 * 60;

/** GET /2/users/me: the person the credential names, as a lookup answers any user, counted against their window. The
 *  window is read, then spent (a decision, not a claim: shared.ts's header); a read-only request is answered over the
 *  window as it stands. */
export async function getUsersMe(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const userFields = parseUserLookup(urlOf(ctx));
  if (!isUserFields(userFields)) return send(userFields);
  const account = findAccount(open.all, open.caller.accountId);
  if (!account) return send(unauthorizedProblem());
  const now = nowSeconds(ctx);
  const windowId = `users_me:${String(account.id)}`;
  const decideOver = (rows: Rows): { response: XResponse; windowStart: number; used: number } => {
    const held = (rows('_rate_window') as Row[]).find((r) => r.id === windowId);
    const active = held && typeof held.windowStart === 'number' && now < held.windowStart + RATE_WINDOW_SECONDS;
    const windowStart = active ? Number(held.windowStart) : now;
    const before = active && typeof held.used === 'number' ? held.used : 0;
    const reset = String(windowStart + RATE_WINDOW_SECONDS);
    if (before >= USERS_ME_RATE_LIMIT) {
      return { response: rateLimitExceeded({ 'x-rate-limit-limit': String(USERS_ME_RATE_LIMIT), 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': reset }), windowStart, used: before };
    }
    const used = before + 1;
    return {
      response: {
        status: 200,
        body: { data: projectUser(account, userFields, open.all, open.caller.scopes) },
        headers: { ...NOSTORE, 'content-type': 'application/json; charset=utf-8', 'x-rate-limit-limit': String(USERS_ME_RATE_LIMIT), 'x-rate-limit-remaining': String(Math.max(0, USERS_ME_RATE_LIMIT - used)), 'x-rate-limit-reset': reset },
      },
      windowStart,
      used,
    };
  };
  if (isReadOnlyRequest(ctx.call.request)) return send(decideOver(rowsFor(ctx)).response);
  return send(await decide<XResponse>(ctx, (rows) => {
    const result = decideOver(rows);
    if (result.response.status !== 200) return { value: result.response };
    const prior = (rows('_rate_window') as Row[]).find((r) => r.id === windowId);
    return {
      value: result.response,
      write: { resource: '_rate_window', id: windowId, fields: { windowStart: result.windowStart, used: result.used, rev: (typeof prior?.rev === 'number' ? prior.rev : 0) + 1 }, operation: 'rate_window.spend' },
    };
  }));
}

/** The posts a timeline's `exclude` leaves (./projection.ts parseExclude). */
function excluding(posts: Resource[], exclude: Set<string>): Resource[] {
  return exclude.has('replies') ? posts.filter((p) => !isReply(p)) : posts;
}


/** GET /2/users/{id}/tweets: the account's own posted timeline, what the org said in its own voice. */
export async function getUsersPosts(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const userId = ctx.resolve('account', String(ctx.call.params.id ?? ''));
  if (!findAccount(open.all, userId)) return send(resourceNotFoundProblem(userId, 'user', 'id'));
  const url = urlOf(ctx);
  const read = parseReadRequest(url, 5, open.publicBase ?? PBS_BASE);
  if (!isReadRequest(read)) return send(read);
  const exclude = parseExclude(url);
  if (isAnswer(exclude)) return send(exclude);
  const matched = excluding(livePosts(open.all).filter((p) => String(p.author_id) === userId), exclude);
  return send(timelinePage(applyWindow(matched, read.window), open.all, read.shape, read.size, read.cursor));
}

/** POST /2/users/{id}/retweets {tweet_id}: "Causes the authenticated user to repost a specific Post by its ID"
 *  (spec:repostPost); the path's id is the authenticated user's own. A repost already made answers the same, once
 *  counted. Where the documentation stops: the refusal of another account's id, and its words, are the twin's, in X's
 *  forbidden form; `rest_id` is the reposted Post's id, as the schema describes it. */
export async function repostPost(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const userId = ctx.resolve('account', String(ctx.call.params.id ?? ''));
  if (userId !== open.caller.accountId) return send(forbiddenProblem('You are not permitted to repost on behalf of another user.'));
  const payload = payloadOf(ctx);
  for (const key of Object.keys(payload)) {
    if (key !== 'tweet_id') return send(invalidRequestProblem({ [key]: [JSON.stringify(payload[key])] }, `The \`${key}\` field is not a parameter of this request.`));
  }
  const checkedId = postIdField(payload.tweet_id, 'tweet_id');
  if (typeof checkedId !== 'string') return send(checkedId);
  const tweetId = ctx.resolve('post', checkedId);
  if (!findPost(open.all, tweetId)) return send(resourceNotFoundProblem(tweetId, 'tweet', 'tweet_id'));
  const key = `${userId}:${tweetId}`;
  if (!open.all.some((r) => r.type === 'repost' && r.id === key && r.deleted !== true)) {
    await adjustPostMetrics(ctx, tweetId, { retweet_count: 1 });
    await putRev(ctx, 'repost', key, { user_id: userId, tweet_id: tweetId, created_at: ctx.occurredAt, deleted: false }, 'x.repost.create');
  }
  return send(ok({ data: { retweeted: true, rest_id: tweetId } }, { 'content-type': 'application/json' }));
}
