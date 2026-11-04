// Posts (https://docs.x.com/x-api/posts): create (an original post, a reply or a quote: one operation, createPosts),
// lookup by id and by ids, and who liked a post: what applications call and x.com's composer posts with
// (journeys/demand.json). A repost is the user's act (./users.ts).
//
// THE ONE THING THIS FILE EXISTS TO GET RIGHT. An original post, a QUOTE and a reply are the SAME operation at X,
// `POST /2/tweets`, differing only by a field in the body (the spec's CreatePostsRequest: `reply.in_reply_to_tweet_id`,
// `quote_tweet_id`; the pinned `twitter-api-v2@1.29.1` client's `tweet()`, `reply()` and `quote()` all post to
// `tweets`). The handler dispatches on those body fields: the discriminator is the field this file branches on to
// decide what to write (`conversation_id`, `in_reply_to_user_id`, `referenced_tweets`). A QUOTE is an ORIGINAL post for that split (the org speaking under its own name).
import type { HandlerContext } from '@volter/world-core';
import { isFieldSet, parseUserFields, projectUser, putRev } from './shared.ts';
import { adjustPostMetrics, applyWindow, buildIncludes, crawlCard, emptyPublicMetrics, csv, postCharacterLimit, videoMinutesAllowed, weightedLength, findAccount, findPost, forbiddenProblem, invalidRequestProblem, isAnswer, isReadRequest, isShape, livePosts, lookupResult, mintSnowflakeId, ok, opening, parseReadRequest, parseReadShape, PBS_BASE, payloadOf, postIdField, projectPost, resolveAttachedMedia, resourceNotFoundError, resourceNotFoundProblem, send, timelinePage, urlOf, type Caller, type Resource, type XResponse } from './shared.ts';


/** The request body's fields (spec:createPosts's CreatePostsRequest, a closed schema: `additionalProperties: false`).
 *  The modelled fields are read below; every other field the spec gives is the manifest's variant, answered the gap
 *  before this handler runs (../manifest.ts POST_CREATE_VARIANTS), so a field outside these is not a parameter at all. */
const POST_FIELDS_MODELLED = new Set(['text', 'reply', 'quote_tweet_id', 'media', 'poll', 'paid_partnership']);
/** A reply's fields: the post it answers, and `auto_populate_reply_metadata`, which X takes and drops (a boolean). */
// source: spec:/components/schemas/CreatePostsReply/properties/auto_populate_reply_metadata "Accepted for compatibility; it carries no backend argument and is dropped before the mutation is issued"
const REPLY_FIELDS_TAKEN = new Set(['in_reply_to_tweet_id', 'auto_populate_reply_metadata']);
/** The two disclosure labels, when they label nothing. `made_with_ai` ("Disclose that the tweet contains AI-generated
 *  media") and `paid_partnership` ("Disclose that the tweet is a paid partnership") are booleans whose `false` is the
 *  post every create here already makes, unlabelled; a client may send both on every post and reply, `false` unless the
 *  person ticked the box. `paid_partnership` is stored and served as the
 *  post's own field; `made_with_ai: true`, a label this twin does not store or show, is the manifest's variant, and a
 *  non-boolean is refused. */
const POST_DISCLOSURE_FIELDS = new Set(['made_with_ai', 'paid_partnership']);

/** `reply` that is no object, carries a field other than the two it takes, or an `auto_populate_reply_metadata` that is no
 *  boolean (the schema's type). */
function replyShapeRefused(reply: unknown): Response | undefined {
  if (typeof reply !== 'object' || Array.isArray(reply)) return send(invalidRequestProblem({ reply: [JSON.stringify(reply)] }, 'The `reply` field must be an object with `in_reply_to_tweet_id`.'));
  const field = Object.keys(reply as object).find((key) => !REPLY_FIELDS_TAKEN.has(key));
  if (field !== undefined) return replyFieldRefused(field, (reply as Record<string, unknown>)[field]);
  const populate = (reply as Record<string, unknown>).auto_populate_reply_metadata;
  if (populate !== undefined && typeof populate !== 'boolean') return send(invalidRequestProblem({ 'reply.auto_populate_reply_metadata': [JSON.stringify(populate)] }, 'The `reply.auto_populate_reply_metadata` field must be a boolean.'));
  return undefined;
}

/** The conversation a reply joins, or X's refusal: a post nobody has, or (a self-serve App's) one nobody summoned it to. */
function replyTo(ctx: HandlerContext, all: Resource[], caller: Caller, id: string): { conversationId: string; inReplyToUserId: string; reference: { type: string; id: string } } | Response {
  const parent = findPost(all, ctx.resolve('post', id));
  if (!parent) return send(resourceNotFoundProblem(id, 'tweet', 'reply.in_reply_to_tweet_id'));
  if (!caller.firstParty && caller.plan !== 'enterprise' && Date.parse(ctx.occurredAt) >= SUMMONS_REQUIRED_FROM && !summoned(parent, all, caller.accountId)) return replyNotSummoned();
  return { conversationId: String(parent.conversation_id ?? parent.id), inReplyToUserId: String(parent.author_id), reference: { type: 'replied_to', id: String(parent.id) } };
}

/** A body field the post does not take as sent: a disclosure label that is no boolean (`true` is the manifest's
 *  variant, `false` is taken), or none of the spec's. */
function postFieldRefused(key: string, value: unknown): Response {
  if (POST_DISCLOSURE_FIELDS.has(key)) return send(invalidRequestProblem({ [key]: [JSON.stringify(value)] }, `The \`${key}\` field must be a boolean.`));
  return send(invalidRequestProblem({ [key]: [JSON.stringify(value)] }, `The \`${key}\` field is not a parameter of this request.`));
}

/** A field of `reply` none of the spec's (its documented `exclude_reply_user_ids` is the manifest's variant). */
function replyFieldRefused(key: string, value: unknown): Response {
  return send(invalidRequestProblem({ [`reply.${key}`]: [JSON.stringify(value)] }, `The \`reply.${key}\` field is not a parameter of this request.`));
}

/** From 23 February 2026 a self-serve App's reply is taken only where the original post's author summoned the replier.
 *  An App registered on X's Enterprise plan (`plan: 'enterprise'` at ./doors.ts) is not self-serve; x.com's own client
 *  is not an App. */
// source: https://docs.x.com/changelog "Programmatic replies via POST /2/tweets are now only permitted when the original Post"
const SUMMONS_REQUIRED_FROM = Date.parse('2026-02-23T00:00:00Z');

/** Whether the original post's author summoned the replier: the post @mentions the replier, or quotes one of its posts. */
// source: https://docs.x.com/x-api/posts/manage-tweets/introduction "author has explicitly summoned the replying account by @mentioning them or quoting one of their posts."
// a reply under one's own post is the author's own conversation, not a reply the rule restrains: the rule is made
// against automated replies to others (where the evidence stops: X's pages do not name a self-reply)
// source: https://docs.x.com/changelog "Today, we made changes to reduce automated, low-quality replies on X."
function summoned(parent: Resource, all: Resource[], replierId: string): boolean {
  if (String(parent.author_id) === replierId) return true;
  const handle = String(findAccount(all, replierId)?.username ?? '');
  const mentions = handle !== '' && new RegExp(`(^|[^A-Za-z0-9_])@${handle}(?![A-Za-z0-9_])`, 'i').test(String(parent.text ?? ''));
  const quotes = (Array.isArray(parent.referenced_tweets) ? parent.referenced_tweets : []).some((r: Resource) => r?.type === 'quoted' && String(findPost(all, String(r.id))?.author_id) === replierId);
  return mentions || quotes;
}

/** A self-serve App's reply nobody summoned. Where the documentation stops: the status and words of the refusal are
 *  the twin's, X's forbidden problem with the page's rule; the further restrictions on programmatic @mentions and quotes
 *  the changelog announces are not stated, and not modelled. */
function replyNotSummoned(): Response {
  return send(forbiddenProblem("Replies are only permitted if the original post's author has explicitly summoned the replying account by @mentioning them or quoting one of their posts."));
}

/** A post longer than the account's limit, refused before anything is written. Where the documentation stops: the
 *  limit is X's (docs.x.com counting-characters); the words of its refusal are the twin's, in X's invalid-request form. */
function overLimit(length: number, limit: number): Response {
  return send(invalidRequestProblem({ text: [String(length)] }, `The \`text\` field is ${length} characters, over this account's ${limit}-character limit for a Post.`));
}

/** A video longer than the account may post, in the words X's page gives the 403. */
// source: https://docs.x.com/x-api/media/introduction "This user is not allowed to post a video longer than N minutes."
function videoTooLong(minutes: number): Response {
  return send(forbiddenProblem(`This user is not allowed to post a video longer than ${minutes} minutes.`));
}

/** A post with neither text nor media: "Required unless media is provided". Where the documentation stops: the rule is
 *  the spec's; the words of its refusal are the twin's, in X's invalid-request form. */
function textRequired(text: unknown): Response {
  return send(invalidRequestProblem({ text: [String(text ?? '')] }, 'The `text` field is required when no other content is supplied.'));
}

/** The post a quote references, or X's refusal of an id no live post has. */
function quotedReference(ctx: HandlerContext, all: Resource[], id: string): { type: string; id: string } | XResponse {
  const quoted = findPost(all, ctx.resolve('post', id));
  return quoted ? { type: 'quoted', id: String(quoted.id) } : resourceNotFoundProblem(id, 'tweet', 'quote_tweet_id');
}

/** POST /2/tweets: an original post, a reply or a quote. */
export async function createPosts(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const { all, caller } = open;
  const payload = payloadOf(ctx);
  const refusedField = Object.keys(payload).find((key) => !POST_FIELDS_MODELLED.has(key) && !(POST_DISCLOSURE_FIELDS.has(key) && payload[key] === false));
  if (refusedField !== undefined) return postFieldRefused(refusedField, payload[refusedField]);
  const replyShape = payload.reply === undefined || payload.reply === null ? undefined : replyShapeRefused(payload.reply);
  if (replyShape) return replyShape;
  // MEDIA first: X's `text` is "Required unless media is provided" (spec:createPosts), so whether a post may be
  // text-less depends on its media. Every id must name media THIS account may use, finished and unexpired; anything
  // else is X's own refusal, "Your media IDs are invalid.", and nothing lands.
  const attached = await resolveAttachedMedia(ctx, caller, payload.media);
  if (isAnswer(attached)) return send(attached);
  const poll = pollInput(payload.poll);
  if (poll && isAnswer(poll)) return send(poll);
  // where the documentation stops: the spec's CreatePostsRequest takes a poll or media; a post with both is refused
  if (poll && attached.media.length) return send(invalidRequestProblem({ poll: [JSON.stringify(payload.poll)] }, 'A Post cannot contain both a poll and media.'));
  if (payload.paid_partnership !== undefined && typeof payload.paid_partnership !== 'boolean') return send(invalidRequestProblem({ paid_partnership: [JSON.stringify(payload.paid_partnership)] }, 'The `paid_partnership` field must be a boolean.'));
  const text = payload.text ?? (attached.media.length > 0 ? '' : undefined);
  if (typeof text !== 'string' || (text.trim() === '' && attached.media.length === 0)) return textRequired(text);
  // THE DISCRIMINATOR: its presence makes this request a reply rather than an original post, at the vendor and here
  const inReplyTo = payload.reply?.in_reply_to_tweet_id;
  const isReply = inReplyTo !== undefined && inReplyTo !== null;
  if (isReply) { const checked = postIdField(inReplyTo, 'reply.in_reply_to_tweet_id'); if (typeof checked !== 'string') return send(checked); }
  // the QUOTE discriminator: an ORIGINAL post that REFERENCES another, starting its own conversation
  const quoteOf = payload.quote_tweet_id;
  const isQuote = quoteOf !== undefined && quoteOf !== null;
  // source: https://docs.x.com/x-api/posts/create-post "Quote-posting (using the quote_tweet_id parameter) requires an Enterprise plan."
  if (isQuote && !caller.firstParty && caller.plan !== 'enterprise') return send(forbiddenProblem('Quote-posting requires an Enterprise plan.'));
  if (isQuote) { const checked = postIdField(quoteOf, 'quote_tweet_id'); if (typeof checked !== 'string') return send(checked); }

  // LENGTH, before anything is written: a post the vendor would refuse never lands here
  const account = findAccount(all, caller.accountId);
  const limit = postCharacterLimit(account);
  const length = weightedLength(text);
  if (length > limit) return overLimit(length, limit);
  // a video longer than the posting account may post is refused here, though it uploaded (X checks again at Post create)
  // source: https://docs.x.com/x-api/media/introduction "If the video is longer than that user is allowed to post, the request fails with 403 Forbidden"
  const minutes = videoMinutesAllowed(account);
  if (attached.media.some((m) => (m.duration_ms ?? 0) > minutes * 60_000)) return videoTooLong(minutes);

  let conversationId: string | undefined;
  let inReplyToUserId: string | undefined;
  const referenced: Array<{ type: string; id: string }> = [];
  const reply = isReply ? replyTo(ctx, all, caller, String(inReplyTo)) : undefined;
  if (reply instanceof Response) return reply;
  if (reply) { conversationId = reply.conversationId; inReplyToUserId = reply.inReplyToUserId; referenced.push(reply.reference); }
  const quoted = isQuote ? quotedReference(ctx, all, String(quoteOf)) : undefined;
  if (quoted && 'status' in quoted) return send(quoted);
  if (quoted) referenced.push(quoted);

  // a post's and a poll's ids are snowflakes, the kernel's (./shared.ts): timelines, since_id and pagination order by them
  let pollId: string | undefined;
  if (poll) {
    pollId = mintSnowflakeId(ctx, 'Poll');
    await ctx.write('poll', pollId, { id: pollId, duration_minutes: poll.duration_minutes, end_datetime: new Date(Date.parse(ctx.occurredAt) + poll.duration_minutes * 60_000).toISOString(), options: poll.options.map((label, index) => ({ position: index + 1, label, votes: 0 })), voting_status: 'open' }, 'x.poll.create');
  }
  const id = mintSnowflakeId(ctx);
  for (const reference of referenced) await adjustPostMetrics(ctx, reference.id, { [reference.type === 'replied_to' ? 'reply_count' : 'quote_count']: 1 });
  await ctx.write('post', id, {
    text,
    author_id: caller.accountId,
    created_at: ctx.occurredAt,
    conversation_id: conversationId ?? id,
    edit_history_tweet_ids: [id],
    public_metrics: emptyPublicMetrics(),
    ...(inReplyToUserId ? { in_reply_to_user_id: inReplyToUserId } : {}),
    ...(referenced.length > 0 ? { referenced_tweets: referenced } : {}),
    // each image by key, id and DIGEST: the digest is how a page's url finds the bytes, with no upload record needed
    ...(attached.media.length > 0 ? { media: attached.media } : {}),
    ...(pollId || attached.media.length ? { attachments: { ...(pollId ? { poll_ids: [pollId] } : {}), ...(attached.media.length ? { media_keys: attached.media.map((m) => m.media_key) } : {}) } } : {}),
    // source: spec:/components/schemas/Post/properties/paid_partnership "Indicates if this Post is a paid partnership, i.e. it has been disclosed by the author as containing paid promotion."
    ...(payload.paid_partnership !== undefined ? { paid_partnership: payload.paid_partnership } : {}),
    deleted: false,
  }, isReply ? 'x.post.reply' : isQuote ? 'x.post.quote' : 'x.post.create');
  // the link the post carries, crawled for its card as X's crawler reads it (./shared.ts, a link's card)
  await crawlCard(ctx, text);
  // X's create answer is thin: id, text, edit_history_tweet_ids (spec:createPosts 201). Reading the post back is a
  // separate call, as at the vendor.
  const created = {
    id,
    text,
    edit_history_tweet_ids: [id],
  };
  return send({ status: 201, body: { data: created }, headers: { 'content-type': 'application/json' } });
}


/** GET /2/tweets/{id}. A post nobody created comes back inside `errors`, never as a fabricated `data` object. */
export async function getPostsById(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const id = String(ctx.call.params.id ?? '');
  if (!/^\d+$/.test(id)) return send(invalidRequestProblem({ id: [id] }, `The \`id\` query parameter value [${id}] is not a valid Post id`));
  const shape = parseReadShape(urlOf(ctx), open.publicBase ?? PBS_BASE);
  if (!isShape(shape)) return send(shape);
  const post = findPost(open.all, ctx.resolve('post', id));
  if (!post) return send(lookupResult(undefined, [resourceNotFoundError(id, 'tweet', 'id')]));
  return send(lookupResult(projectPost(post, shape.fields, open.all), [], buildIncludes([post], open.all, shape)));
}

/** GET /2/tweets?ids=. X answers PARTIALLY: the ids that exist ride in `data`, the ones that do not in `errors`, in one
 *  200, in the caller's order. */
export async function getPostsByIds(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const url = urlOf(ctx);
  const raw = url.searchParams.get('ids');
  const ids = csv(raw);
  if (raw === null || ids.length === 0) return send(invalidRequestProblem({ ids: [String(raw ?? '')] }, 'The `ids` query parameter is required and must name at least one Post id.'));
  if (ids.length > 100) return send(invalidRequestProblem({ ids: [String(ids.length)] }, 'The `ids` query parameter accepts at most 100 Post ids.'));
  for (const id of ids) {
    if (!/^\d+$/.test(id)) return send(invalidRequestProblem({ ids: [id] }, `The \`ids\` query parameter value [${id}] is not a valid Post id`));
  }
  const shape = parseReadShape(url, open.publicBase ?? PBS_BASE);
  if (!isShape(shape)) return send(shape);
  const found: Resource[] = [];
  const errors: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const post = findPost(open.all, ctx.resolve('post', id));
    if (post) found.push(post);
    else errors.push(resourceNotFoundError(id, 'tweet', 'ids'));
  }
  const answer = lookupResult(found.length > 0 ? found.map((p) => projectPost(p, shape.fields, open.all)) : undefined, errors, buildIncludes(found, open.all, shape));
  // source: spec:/components/schemas/GetPostsByIdsResponse/properties/meta/properties/result_count "Number of items in the data array."
  return send({ ...answer, body: { ...(answer.body as Record<string, unknown>), meta: { result_count: found.length } } });
}


/** GET /2/tweets/{id}/liking_users: the accounts that liked a post, oldest like first, a page at a time (max_results 1
 *  to 100, default 100; spec:getPostsLikingUsers). Likes are the audience's (the engagement door, ./doors.ts): a post
 *  no one liked answers `result_count` 0 and no `data`, as X omits an empty page's data. A post nobody created is named
 *  in `errors`, as the lookups answer it. Where the documentation stops: the page token, the twin's, the id of the last
 *  like on the page. */
export async function getPostsLikingUsers(ctx: HandlerContext): Promise<Response> {
  const open = opening(ctx);
  if (isAnswer(open)) return send(open);
  const id = String(ctx.call.params.id ?? '');
  if (!/^\d{1,19}$/.test(id)) return send(invalidRequestProblem({ id: [id] }, `The \`id\` query parameter value [${id}] is not a valid Post id`));
  const url = urlOf(ctx);
  const userFields = parseUserFields(url);
  if (!isFieldSet(userFields)) return send(userFields);
  const raw = url.searchParams.get('max_results');
  const size = raw === null ? 100 : Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > 100) return send(invalidRequestProblem({ max_results: [String(raw)] }, `The \`max_results\` query parameter value [${raw}] is not between 1 and 100`));
  const postId = ctx.resolve('post', id);
  if (!findPost(open.all, postId)) return send(lookupResult(undefined, [resourceNotFoundError(id, 'tweet', 'id')]));
  const likes = open.all.filter((r) => r.type === 'like' && String(r.tweet_id) === postId && r.deleted !== true)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  const token = url.searchParams.get('pagination_token');
  const from = token === null ? 0 : likes.findIndex((l) => Buffer.from(String(l.id)).toString('base64url') === token) + 1;
  if (token !== null && from === 0) return send(invalidRequestProblem({ pagination_token: [token] }, `The \`pagination_token\` query parameter value [${token}] is not valid`));
  const page = likes.slice(from, from + size);
  const users = page.map((l) => findAccount(open.all, String(l.user_id))).filter((a): a is Resource => a !== undefined);
  const meta: Record<string, unknown> = { result_count: users.length };
  if (from + size < likes.length) meta.next_token = Buffer.from(String(page.at(-1)!.id)).toString('base64url');
  if (from > 0) meta.previous_token = Buffer.from(String(likes[from - 1]!.id)).toString('base64url');
  return send(ok({ ...(users.length > 0 ? { data: users.map((u) => projectUser(u, userFields, open.all)) } : {}), meta }, { 'content-type': 'application/json' }));
}

/** A poll's body (spec:/components/schemas/CreatePostsPoll): two to four choices of 1 to 25 characters, a duration of 5
 *  to 10,080 minutes, and an optional `reply_settings`; X's invalid request otherwise. */
// source: spec:/components/schemas/CreatePostsPoll/properties/options "Poll options (2-4 choices, 1-25 characters each)."
// source: spec:/components/schemas/CreatePostsPoll/properties/duration_minutes "Duration of the poll in minutes."
function pollInput(value: unknown): { options: string[]; duration_minutes: number } | XResponse | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['options', 'duration_minutes', 'reply_settings'].includes(key))) return invalidRequestProblem({ poll: [JSON.stringify(value)] }, 'The `poll` field must contain `options` and `duration_minutes`.');
  const poll = value as Record<string, any>;
  if (poll.reply_settings !== undefined && !['following', 'mentionedUsers', 'subscribers', 'verified'].includes(poll.reply_settings)) return invalidRequestProblem({ 'poll.reply_settings': [String(poll.reply_settings)] }, 'The `poll.reply_settings` value is not one of following, mentionedUsers, subscribers, verified.');
  if (!Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 4 || poll.options.some((choice: unknown) => typeof choice !== 'string' || Array.from(choice).length < 1 || Array.from(choice).length > 25)) return invalidRequestProblem({ poll: [JSON.stringify(value)] }, 'A poll requires 2 to 4 choices, each 1 to 25 characters.');
  if (!Number.isInteger(poll.duration_minutes) || poll.duration_minutes < 5 || poll.duration_minutes > 10080) return invalidRequestProblem({ poll: [JSON.stringify(value)] }, 'The poll duration must be between 5 and 10080 minutes.');
  return { options: poll.options, duration_minutes: poll.duration_minutes };
}
