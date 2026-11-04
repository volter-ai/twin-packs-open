// What Reddit's handlers, doors and pages share: who is calling, the stored shapes and the views Reddit answers them in
// (an account, a community, a post, a comment, a listing), the media an upload leaves, and Reddit's answers.
import { personOf, sha256, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

export const ACCOUNT = 'account';
export const SUBREDDIT = 'subreddit';
export const LINK = 'link';
export const COMMENT = 'comment';
export const ASSET = 'asset';
export const APP = 'app';
export const TOKEN = '_access_token';
export const CLIENT_SECRET = '_client_secret';
export const RATE_WINDOW = '_rate_window';
export const VOTE = '_vote';
export const MEMBERSHIP = '_membership';
/** The session cookie reddit.com names its person by. */
export const SESSION_COOKIE = 'reddit_session';
/** The caller this pack's front resolved (./around.ts), named to a handler in a header only that front sets. */
export const CALLER_HEADER = 'x-twin-reddit-caller';

// ── answers ─────────────────────────────────────────────────────────────────────────────────────

const WORDS: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 500: 'Internal Server Error' };

/** Reddit's error body for an HTTP error: the status's words and its number.
 *  source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestInbox.test_message__unauthorized.json "Forbidden" */
/** The host a request was sent to (a World's routing names the vendor's host it came for). */
export const hostOf = (request: Request): string => (request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host).replace(/:\d+$/, '').toLowerCase();

/** A community the World does not have, named in a path under /r/: Reddit sends a valid name to its community search
 *  (the page's own extension kept, at a World's place on the twin's base) and answers any other name 404.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py "if Subreddit.is_valid_name(sr_name):"
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py "abort(302, location=BaseController.format_output_url(path))"
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/base.py "make sure the extensions agree with the current page"
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/models/subreddit.py "[A-Za-z0-9][A-Za-z0-9_]{2,20}" */
export function noSuchCommunity(ctx: HandlerContext, name: string, notFound: () => Response): Response {
  if (!/^[A-Za-z0-9][A-Za-z0-9_]{2,20}$/.test(name)) return notFound();
  const url = new URL(ctx.call.request.url);
  const path = `/subreddits/search${url.pathname.endsWith('.json') ? '.json' : ''}?q=${name}`;
  const location = ctx.call.request.headers.has('x-forwarded-prefix') ? `${new URL(ctx.publicBase).pathname.replace(/\/+$/, '')}${path}` : `https://${hostOf(ctx.call.request)}${path}`;
  return new Response(null, { status: 302, headers: { location } });
}

export function httpError(status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ message: WORDS[status] ?? 'Error', error: status }, { status, headers });
}

/** An api_type=json answer: its errors, each [code, message, field], and what it made. */
export function jsonAnswer(errors: Array<[string, string, string | null]>, data?: Row): Response {
  return Response.json({ json: { errors, ...(data ? { data } : {}) } });
}

/** Reddit's error words by code (r2's errors.py; the vendor's own server source). */
const ERRORS: Record<string, string> = {
  USER_REQUIRED: 'Please log in to do that.',
  NO_URL: 'a url is required',
  BAD_URL: 'you should check that url',
  DELETED_COMMENT: 'that comment has been deleted',
  ALREADY_SUB: 'that link has already been submitted',
  SUBREDDIT_EXISTS: 'that subreddit already exists',
  SUBREDDIT_NOEXIST: "that subreddit doesn't exist",
  SUBREDDIT_NOTALLOWED: "you aren't allowed to post there.",
  SUBREDDIT_REQUIRED: 'you must specify a subreddit',
  BAD_SR_NAME: "that name isn't going to work",
  INVALID_OPTION: 'that option is not valid',
  NO_TEXT: 'we need something here',
  NO_SELFS: "that subreddit doesn't allow text posts",
  NO_LINKS: 'that subreddit only allows text posts',
  THREAD_LOCKED: 'Comments are locked.',
  USER_DOESNT_EXIST: "that user doesn't exist",
  ALREADY_MODERATOR: 'that user is already a moderator',
  INVALID_PERMISSIONS: 'invalid permissions string',
  NO_INVITE_FOUND: 'there is no pending invite for that subreddit',
};
/** An error triple, its words Reddit's. */
export const err = (code: string, field: string | null, words?: string): [string, string, string | null] => [code, words ?? ERRORS[code] ?? code, field];

/** A request's parameters as Reddit reads them: the query, then the form or JSON body. */
export function paramsOf(ctx: HandlerContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.params)) if (v !== undefined && v !== null && typeof v !== 'object') out[k] = String(v);
  return out;
}

// ── time ────────────────────────────────────────────────────────────────────────────────────────

/** The World's instant in Unix seconds, as Reddit writes `created_utc` (a float with a zero fraction). */
export const nowSeconds = (ctx: HandlerContext): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

// ── who is calling ──────────────────────────────────────────────────────────────────────────────

export type Caller = { account: string; name: string; scopes: string[]; client: string; via: 'bearer' | 'session' };

/** The caller the front resolved, or undefined (an anonymous read on www.reddit.com). */
export function callerOf(ctx: HandlerContext): Caller | undefined {
  const raw = ctx.call.request.headers.get(CALLER_HEADER);
  if (!raw) return undefined;
  try { return JSON.parse(raw) as Caller; } catch { return undefined; }
}

/** Whether a caller's grant holds a scope (`*` holds every one). */
export const hasScope = (caller: Caller, scope: string): boolean => caller.scopes.includes('*') || caller.scopes.includes(scope);

/** An account by its username, as Reddit reads one: case aside. */
export function accountNamed(ctx: HandlerContext, name: string): Row | undefined {
  const lower = name.trim().replace(/^\/?u\//i, '').toLowerCase();
  return ctx.rowsRaw(ACCOUNT).find((a) => String(a.name).toLowerCase() === lower);
}

/** The account a person signed in on reddit.com is (the session kit keys a person by their email). */
export function accountOfPerson(ctx: HandlerContext, email: string): Row | undefined {
  return ctx.rowsRaw(ACCOUNT).find((a) => String(a._email).toLowerCase() === email.toLowerCase());
}

/** The person's account an email or a username names, for the sign-in page ("Email or username"). */
export function personByLogin(ctx: HandlerContext, login: string): { email: string; account: Row } | undefined {
  const byName = accountNamed(ctx, login);
  const account = byName ?? accountOfPerson(ctx, login);
  if (!account) return undefined;
  const email = String(account._email);
  return personOf(ctx, email) ? { email, account } : undefined;
}

/** The `reddit_session` cookie a request carries, or ''. */
export const sessionCookie = (ctx: HandlerContext): string => new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(ctx.call.request.headers.get('cookie') ?? '')?.[1] ?? '';

/** The email of the person a session cookie signed in (world-ui's session kit records the session as `_web_session`). */
export function personSignedIn(ctx: HandlerContext, cookie: string): string | undefined {
  const session = ctx.rowsRaw('_web_session').find((s) => s.token === cookie);
  return session && personOf(ctx, String(session.email)) ? String(session.email) : undefined;
}

/** The modhash a session's pages carry and its own API calls send back (dev/api: "A modhash is a token that the reddit
 *  API requires to help prevent CSRF"), one per session, drawn from the World's secret. */
export async function modhashFor(ctx: HandlerContext, session: string): Promise<string> {
  return (await ctx.secret(`modhash:${session}`)).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32);
}

// ── communities and who joined them ─────────────────────────────────────────────────────────────

export function subredditNamed(ctx: HandlerContext, name: string): Row | undefined {
  const lower = name.trim().replace(/^\/?r\//i, '').toLowerCase();
  return ctx.rowsRaw(SUBREDDIT).find((s) => String(s.display_name).toLowerCase() === lower);
}

/** A person's standing in a community: a moderator (its creator), a subscriber, both or neither. */
export function membership(ctx: HandlerContext, srId: string, accountId: string | undefined): { moderator: boolean; subscriber: boolean } {
  if (!accountId) return { moderator: false, subscriber: false };
  const row = ctx.row(MEMBERSHIP, `${srId}:${accountId}`);
  return { moderator: row?.moderator === true, subscriber: row?.subscriber === true };
}

export const subscribersOf = (ctx: HandlerContext, srId: string): number => ctx.rowsRaw(MEMBERSHIP).filter((m) => m.subreddit === srId && m.subscriber === true).length;

/** A community as GET /r/{subreddit}/about answers it, to the account reading it. */
export function subredditView(ctx: HandlerContext, sr: Row, viewer?: string): Row {
  const m = membership(ctx, String(sr.id), viewer);
  const md = (text: unknown): string | null => (typeof text === 'string' && text ? redditHtml(text) : null);
  return {
    user_flair_background_color: null, submit_text_html: md(sr.submit_text), restrict_posting: true, user_is_banned: viewer ? false : null,
    free_form_reports: true, wiki_enabled: sr.wiki_enabled ?? null, user_is_muted: viewer ? false : null, user_can_flair_in_sr: null,
    display_name: sr.display_name, header_img: null, title: sr.title, allow_galleries: true, icon_size: null, primary_color: '',
    active_user_count: null, icon_img: '', display_name_prefixed: `r/${String(sr.display_name)}`, accounts_active: null, public_traffic: false,
    subscribers: subscribersOf(ctx, String(sr.id)), user_flair_richtext: [], name: `t5_${String(sr.id)}`, quarantine: false, hide_ads: false,
    prediction_leaderboard_entry_type: 'IN_FEED', emojis_enabled: false, advertiser_category: '', public_description: sr.public_description ?? '',
    comment_score_hide_mins: 0, allow_predictions: false, user_has_favorited: viewer ? false : null, user_flair_template_id: null, community_icon: '',
    banner_background_image: '', original_content_tag_enabled: false, community_reviewed: false, submit_text: sr.submit_text ?? '',
    description_html: md(sr.description), spoilers_enabled: true, header_title: sr.header_title ?? '', header_size: null, user_flair_position: 'right',
    all_original_content: false, collections_enabled: true, is_enrolled_in_new_modmail: null, key_color: '', event_posts_enabled: true,
    can_assign_user_flair: false, created: sr.created_utc, wls: null, show_media_preview: true, submission_type: sr.submission_type ?? 'any',
    user_is_subscriber: viewer ? m.subscriber : null, disable_contributor_requests: false, allow_videogifs: sr.allow_videos !== false,
    should_archive_posts: false, user_flair_type: 'text', allow_polls: true, collapse_deleted_comments: false, coins: 0, emojis_custom_size: null,
    public_description_html: md(sr.public_description), allow_videos: sr.allow_videos !== false, is_crosspostable_subreddit: true,
    notification_level: viewer && m.subscriber ? 'low' : null, can_assign_link_flair: false, has_menu_widget: false, accounts_active_is_fuzzed: false,
    allow_prediction_contributors: false, submit_text_label: '', link_flair_position: '', user_sr_flair_enabled: null, user_flair_enabled_in_sr: false,
    allow_chat_post_creation: false, allow_discovery: true, accept_followers: true, user_sr_theme_enabled: true, link_flair_enabled: false,
    subreddit_type: sr.subreddit_type ?? 'public', suggested_comment_sort: null, banner_img: '', user_flair_text: null, banner_background_color: '',
    show_media: true, id: sr.id, user_is_moderator: viewer ? m.moderator : null, over18: sr.over18 === true, description: sr.description ?? '',
    is_chat_post_feature_enabled: false, submit_link_label: '', user_flair_text_color: null, restrict_commenting: false, user_flair_css_class: null,
    allow_images: sr.allow_images !== false, lang: sr.lang ?? 'en', whitelist_status: null, url: `/r/${String(sr.display_name)}/`, created_utc: sr.created_utc,
    banner_size: null, mobile_banner_image: '', user_is_contributor: viewer ? m.moderator : null, allow_predictions_tournament: false,
  };
}

// ── markdown ────────────────────────────────────────────────────────────────────────────────────

/** A body's HTML as Reddit answers `selftext_html` and `body_html`: its markdown inside `<div class="md">`, between the
 *  SC_OFF and SC_ON markers (as recorded on 2025-05-07 and 2025-06-19). */
export const redditHtml = (text: string): string => `<!-- SC_OFF --><div class="md">${markdown(text)}\n</div><!-- SC_ON -->`;

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown as Reddit renders a body: paragraphs, emphasis, code and links. Where the documentation stops: Reddit's
 *  renderer (snudown) also draws lists, quotes, tables and headings; a body holding them is drawn as paragraphs here. */
/** A bare URL's end as snudown's autolink finds it: trailing `?`, `!`, `.` and `,` are the sentence's, and a closing
 *  parenthesis the URL does not open is the text's; what is cut off follows the link as text.
 *  source: https://raw.githubusercontent.com/reddit/snudown/master/src/autolink.c "Try to close the final punctuation sign in this same line;" */
function linkEnd(url: string): [string, string] {
  let end = url.length;
  while (end > 0 && '?!.,'.includes(url[end - 1]!)) end--;
  if (url[end - 1] === ')' && (url.slice(0, end).match(/\(/g) ?? []).length < (url.slice(0, end).match(/\)/g) ?? []).length) end--;
  return [url.slice(0, end), url.slice(end)];
}

function markdown(text: string): string {
  // what must not be read again (an escaped sign, a code span, a link) is set aside as it is drawn, so emphasis never runs
  // inside code and a link's text is never linked again, then put back
  const inline = (s: string): string => {
    const held: string[] = [];
    const hold = (html: string): string => `\u0000${held.push(html) - 1}\u0000`;
    const back = (t: string): string => t.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => back(held[Number(n)] ?? ''));
    return back(escapeHtml(s)
      .replace(/\\([\\`*_~^[\]])/g, (_m, c: string) => hold(`&#${c.charCodeAt(0)};`))
      .replace(/`([^`]+)`/g, (_m, code: string) => hold(`<code>${code}</code>`))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, href: string) => hold(`<a href="${href}">${label}</a>`))
      .replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+)/g, (_m, pre: string, url: string) => { const [href, rest] = linkEnd(url); return `${pre}${hold(`<a href="${href}">${href}</a>`)}${rest}`; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>'));
  };
  // a NUL is no character of a body (snudown stops a link at one), and here it marks what is set aside: a sent one is replaced
  return text.replace(/\u0000/g, '\ufffd').trim().split(/\n{2,}/).map((p) => `<p>${inline(p.trim()).replace(/\n/g, '<br/>\n')}</p>`).join('\n\n');
}

/** A title as its permalink's slug (r2's title_to_url: whitespace to `_`, non-word characters dropped, at most 50
 *  characters cut at a word).
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/utils/utils.py "def title_to_url(title, max_length = 50):" */
export function slugOf(title: string): string {
  let t = title.replace(/\s+/gu, '_').replace(/[^\p{L}\p{N}_]+/gu, '').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  if (t.length > 50) { t = t.slice(0, 50); const last = t.lastIndexOf('_'); if (last > 0) t = t.slice(0, last); }
  return t || '_';
}

// ── votes and scores ────────────────────────────────────────────────────────────────────────────

/** An account's vote on a thing: 1, -1, or 0 for none. */
function voteOf(ctx: HandlerContext, fullname: string, accountId: string | undefined): number {
  if (!accountId) return 0;
  return Number(ctx.row(VOTE, `${accountId}:${fullname}`)?.dir ?? 0);
}
/** A thing's ups and downs: every account's vote on it. */
function tally(ctx: HandlerContext, fullname: string): { ups: number; downs: number } {
  let ups = 0;
  let downs = 0;
  for (const v of ctx.rowsRaw(VOTE)) {
    if (v.thing !== fullname) continue;
    if (v.dir === 1) ups += 1;
    if (v.dir === -1) downs += 1;
  }
  return { ups, downs };
}

/** Reddit's hot rank of a post: the order of magnitude of its score, signed, plus its age over 45,000 seconds since
 *  Reddit's epoch.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/db/_sorts.pyx "return round(sign * order + seconds / 45000, 7)" */
function hotRank(score: number, createdUtc: number): number {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/db/_sorts.pyx "seconds = date - 1134028003"
  const seconds = createdUtc - 1134028003;
  return Math.round((sign * order + seconds / 45000) * 1e7) / 1e7;
}

// ── posts ───────────────────────────────────────────────────────────────────────────────────────

/** The posts of a community a reader sees: live ones, by the order asked. A post its moderator removed is in none. */
// source: spec:POST_api_remove "it will be removed from all subreddit listings"
export function linksOf(ctx: HandlerContext, srId: string): Row[] {
  return ctx.rowsRaw(LINK).filter((l) => l.subreddit_id === `t5_${srId}` && l.removed_by_category !== 'deleted' && l.removed_by_category !== 'moderator');
}

/** Posts in a listing's order. Two made in the same second keep the order they were made in, the later first, as Reddit's
 *  ids (a counter in base 36) order them. */
export function sortLinks(ctx: HandlerContext, links: Row[], sort: 'hot' | 'new' | 'top'): Row[] {
  const score = (l: Row): number => { const t = tally(ctx, `t3_${String(l.id)}`); return t.ups - t.downs; };
  const made = new Map(links.map((l, i) => [l, i]));
  const created = (l: Row): number => Number(l.created_utc ?? 0) + made.get(l)! / 1e6;
  const key = sort === 'new' ? created : sort === 'top' ? (l: Row) => score(l) * 1e12 + created(l) : (l: Row) => hotRank(score(l), created(l)) * 1e6 + made.get(l)! / 1e6;
  return [...links].sort((a, b) => key(b) - key(a));
}

/** A post as Reddit answers its `data`, to the account reading it: its stored facts, its votes and comments counted
 *  now, what the reader's own vote is, and the fields Reddit answers with every post (the 2025-05-07 recording's set,
 *  with a moderator's own fields where the reader moderates the community, as the 2020-12-03 recording shows). */
export function linkView(ctx: HandlerContext, l: Row, viewer?: string): Row {
  const fullname = `t3_${String(l.id)}`;
  const t = tally(ctx, fullname);
  const sr = ctx.row(SUBREDDIT, String(l.subreddit_id).replace(/^t5_/, ''));
  const mod = sr ? membership(ctx, String(sr.id), viewer).moderator : false;
  const deleted = l.removed_by_category === 'deleted';
  const mine = voteOf(ctx, fullname, viewer);
  const score = t.ups - t.downs;
  // a deleted comment leaves the count (r2's POST_del: one fewer, once)
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "link._incr('num_comments', -1)"
  const comments = ctx.rowsRaw(COMMENT).filter((c) => c.link_id === fullname && c._deleted !== true).length;
  const v: Row = {
    approved_at_utc: null, subreddit: l.subreddit, selftext: deleted && l.is_self ? '[deleted]' : l.selftext ?? '', user_reports: [], saved: false,
    mod_reason_title: null, gilded: 0, clicked: false, title: l.title, link_flair_richtext: [], subreddit_name_prefixed: `r/${String(l.subreddit)}`,
    hidden: false, pwls: null, link_flair_css_class: null, downs: 0, thumbnail_height: l.thumbnail_height ?? null, top_awarded_type: null,
    hide_score: false, name: fullname, quarantine: false, link_flair_text_color: l.link_flair_text ? 'dark' : null,
    upvote_ratio: t.ups + t.downs === 0 ? 1.0 : Math.round((t.ups / (t.ups + t.downs)) * 100) / 100, author_flair_background_color: null,
    ups: score, total_awards_received: 0, media_embed: {}, thumbnail_width: l.thumbnail_width ?? null, author_flair_template_id: null,
    is_original_content: false, ...(deleted ? {} : { author_fullname: l.author_fullname }), secure_media: l.media ?? null,
    is_reddit_media_domain: l.is_reddit_media_domain === true, is_meta: false, category: null, secure_media_embed: {}, link_flair_text: l.link_flair_text ?? null,
    can_mod_post: mod, score, approved_by: null, is_created_from_ads_ui: false, author_premium: false, thumbnail: l.thumbnail ?? 'default',
    edited: false, author_flair_css_class: null, author_flair_richtext: [], gildings: {}, ...(l.post_hint ? { post_hint: l.post_hint } : {}),
    content_categories: null, is_self: l.is_self === true, subreddit_type: sr?.subreddit_type ?? 'public', created: l.created_utc, link_flair_type: 'text',
    wls: null, removed_by_category: deleted ? 'deleted' : l.removed_by_category === 'moderator' ? 'moderator' : null, banned_by: null, author_flair_type: 'text', domain: l.domain, allow_live_comments: false,
    selftext_html: deleted && l.is_self ? redditHtml('[deleted]') : l.selftext_html ?? null, likes: viewer ? (mine === 1 ? true : mine === -1 ? false : null) : null,
    suggested_sort: null, banned_at_utc: null, ...(l.url_overridden_by_dest ? { url_overridden_by_dest: l.url_overridden_by_dest } : {}), view_count: null,
    archived: false, no_follow: score < 2, is_crosspostable: !deleted, pinned: false, over_18: l.over_18 === true, ...(l.preview ? { preview: l.preview } : {}),
    all_awardings: [], awarders: [], media_only: false, can_gild: false, spoiler: l.spoiler === true, locked: false, author_flair_text: l.link_flair_text_author ?? null,
    treatment_tags: [], rte_mode: 'markdown', visited: false, removed_by: null, mod_note: null, distinguished: null, subreddit_id: l.subreddit_id,
    author_is_blocked: false, mod_reason_by: null, num_reports: mod ? 0 : null, removal_reason: null, link_flair_background_color: '', id: l.id,
    is_robot_indexable: !deleted, num_duplicates: 0, report_reasons: mod ? [] : null, author: deleted ? '[deleted]' : l.author, discussion_type: null,
    num_comments: comments, send_replies: l.send_replies !== false, media: l.media ?? null, contest_mode: false, author_patreon_flair: false,
    author_flair_text_color: null, permalink: l.permalink, stickied: false, url: l.url, subreddit_subscribers: sr ? subscribersOf(ctx, String(sr.id)) : 0,
    created_utc: l.created_utc, num_crossposts: 0, mod_reports: [], is_video: l.is_video === true,
    ...(mod ? { approved: false, removed: l.removed_by_category === 'moderator', spam: false, ignore_reports: false } : {}),
  };
  return v;
}

export const linkThing = (ctx: HandlerContext, l: Row, viewer?: string): Row => ({ kind: 't3', data: linkView(ctx, l, viewer) });

// ── comments ────────────────────────────────────────────────────────────────────────────────────

export function commentView(ctx: HandlerContext, c: Row, viewer?: string, depth = 0, replies?: Row | ''): Row {
  const fullname = `t1_${String(c.id)}`;
  const t = tally(ctx, fullname);
  const sr = ctx.row(SUBREDDIT, String(c.subreddit_id).replace(/^t5_/, ''));
  const mod = sr ? membership(ctx, String(sr.id), viewer).moderator : false;
  const link = ctx.row(LINK, String(c.link_id).replace(/^t3_/, ''));
  const mine = voteOf(ctx, fullname, viewer);
  const score = t.ups - t.downs;
  return {
    author_flair_background_color: null, subreddit_id: c.subreddit_id, approved_at_utc: null, author_is_blocked: false, comment_type: null, awarders: [],
    mod_reason_by: null, banned_by: null, author_flair_type: 'text', total_awards_received: 0, subreddit: c.subreddit, author_flair_template_id: null,
    likes: viewer ? (mine === 1 ? true : mine === -1 ? false : null) : null, replies: replies ?? '', user_reports: [], saved: false, id: c.id,
    banned_at_utc: null, mod_reason_title: null, gilded: 0, archived: false, collapsed_reason_code: null, no_follow: score < 2, can_mod_post: mod,
    send_replies: true, parent_id: c.parent_id, score, author_fullname: c.author_fullname, removal_reason: null, approved_by: null, mod_note: null,
    all_awardings: [], collapsed: false, body: c.body, edited: false, top_awarded_type: null, author_flair_css_class: null, name: fullname,
    is_submitter: link ? link.author === c.author : false, downs: 0, author_flair_richtext: [], author_patreon_flair: false, body_html: c.body_html,
    gildings: {}, collapsed_reason: null, distinguished: null, associated_award: null, stickied: false, author_premium: false, can_gild: false,
    link_id: c.link_id, unrepliable_reason: null, author_flair_text_color: null, score_hidden: false, permalink: c.permalink,
    subreddit_type: sr?.subreddit_type ?? 'public', locked: false, report_reasons: mod ? [] : null, created: c.created_utc, author_flair_text: null,
    treatment_tags: [], author: c.author, created_utc: c.created_utc, subreddit_name_prefixed: `r/${String(c.subreddit)}`, controversiality: 0,
    depth, collapsed_because_crowd_control: null, mod_reports: [], num_reports: mod ? 0 : null, ups: score,
    ...(mod ? { approved: false, removed: c._removed === true, spam: false, ignore_reports: false } : {}),
  };
}

/** A post's comment tree, as its comments page and GET /comments/{article} answer it: top-level comments by the sort,
 *  each with its replies as a Listing (or an empty string when there are none). */
export function commentTree(ctx: HandlerContext, linkFullname: string, viewer: string | undefined, sort: string, depthLimit: number): Row[] {
  const all = ctx.rowsRaw(COMMENT).filter((c) => c.link_id === linkFullname);
  const score = (c: Row): number => { const t = tally(ctx, `t1_${String(c.id)}`); return t.ups - t.downs; };
  // each comment's place in the order asked: newest, oldest, or by score then age (Reddit's best, which the twin draws
  // from the votes alone)
  const rank: (c: Row) => number[] = sort === 'new' ? (c) => [-Number(c.created_utc)] : sort === 'old' ? (c) => [Number(c.created_utc)] : (c) => [-score(c), Number(c.created_utc)];
  const order = (xs: Row[]): Row[] => [...xs].sort((a, b) => { const [ra, rb] = [rank(a), rank(b)]; return (ra[0]! - rb[0]!) || ((ra[1] ?? 0) - (rb[1] ?? 0)); });
  // a deleted comment no reply hangs under is left out of the tree; one with replies stays, as [deleted]; a comment a
  // moderator removed is redacted the same way, as [removed]
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/models/builder.py "if item.deleted and not item.num_children:"
  // source: spec:POST_api_remove "it will be redacted and removed from all"
  const shown = (c: Row): boolean => (c._deleted !== true && c._removed !== true) || all.some((x) => x.parent_id === `t1_${String(c.id)}`);
  const build = (parent: string, depth: number): Row[] => order(all.filter((c) => c.parent_id === parent && shown(c))).map((c) => {
    const kids = depth + 1 < depthLimit ? build(`t1_${String(c.id)}`, depth + 1) : [];
    return { kind: 't1', data: commentView(ctx, c, viewer, depth, kids.length ? listing(kids, { after: null, before: null, dist: null }) : '') };
  });
  return build(linkFullname, 0);
}

// ── listings ────────────────────────────────────────────────────────────────────────────────────

/** A Listing: its things and its anchors (the JSON wiki: before, after, modhash, children; dist and geo_filter as
 *  recorded on 2025-05-07). */
export function listing(children: Row[], anchors: { after: string | null; before: string | null; dist: number | null }, modhash: string | null = null): Row {
  return { kind: 'Listing', data: { after: anchors.after, dist: anchors.dist, modhash, geo_filter: '', children, before: anchors.before } };
}

/** A slice of things by the listing's parameters: after or before a fullname, at most `limit` (dev/api's listings: "after
 *  / before - only one should be specified. these indicate the fullname of an item in the listing to use as the anchor
 *  point of the slice"). */
export function slice<T extends Row>(items: T[], fullnameOf: (t: T) => string, params: Record<string, string>): { page: T[]; after: string | null; before: string | null } {
  // source: https://www.reddit.com/dev/api "limit - the maximum number of items to return in this slice of the listing."
  const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit ?? '25', 10) || 25));
  let start = 0;
  let end = items.length;
  if (params.after) { const i = items.findIndex((t) => fullnameOf(t) === params.after); start = i < 0 ? items.length : i + 1; end = Math.min(items.length, start + limit); }
  else if (params.before) { const i = items.findIndex((t) => fullnameOf(t) === params.before); end = i < 0 ? 0 : i; start = Math.max(0, end - limit); }
  else end = Math.min(items.length, limit);
  const page = items.slice(start, end);
  // a before anchor only when the request's count says items were already seen ("on the html site, the builder uses this to
  // determine when to give values for before and after in the response")
  // source: https://www.reddit.com/dev/api "count - the number of items already seen in this listing."
  const seen = Number.parseInt(params.count ?? '0', 10) > 0;
  return { page, after: end < items.length && page.length ? fullnameOf(page[page.length - 1]!) : null, before: seen && start > 0 && page.length ? fullnameOf(page[0]!) : null };
}

// ── media ───────────────────────────────────────────────────────────────────────────────────────

/** The two buckets a lease names: images to reddit-uploaded-media, videos to reddit-uploaded-video (as recorded on
 *  2025-05-07 and 2020-12-03). */
export const MEDIA_BUCKET = 'reddit-uploaded-media';
export const VIDEO_BUCKET = 'reddit-uploaded-video';
export const bucketHost = (bucket: string): string => `${bucket}.s3-accelerate.amazonaws.com`;

/** The media types Reddit takes for a post. Where the documentation stops: Reddit documents no list for the lease;
 *  these are the image and video types its posts carry (PNG, JPEG, GIF; MP4 and QuickTime, both recorded as leased). */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };
export const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

/** The size an uploaded file says it is: an image's width and height, a video's and its duration. */
export function mediaFacts(bytes: Uint8Array, mimetype: string): { width?: number; height?: number; duration?: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reader = mimetype in VIDEO_TYPES ? mp4Facts : READERS[mimetype];
  return reader ? reader(bytes, view) : {};
}

type Facts = { width?: number; height?: number; duration?: number };
/** A PNG's header chunk holds its width and height. */
const pngFacts = (bytes: Uint8Array, view: DataView): Facts => (bytes.length > 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : {});
/** A GIF's screen descriptor holds its width and height, little-endian. */
const gifFacts = (bytes: Uint8Array, view: DataView): Facts => (bytes.length > 10 ? { width: view.getUint16(6, true), height: view.getUint16(8, true) } : {});
const READERS: Record<string, (bytes: Uint8Array, view: DataView) => Facts> = { 'image/png': pngFacts, 'image/gif': gifFacts, 'image/jpeg': jpegFacts };

/** A JPEG's start-of-frame segment holds its height and width: its segments walked to the first frame header. */
function jpegFacts(bytes: Uint8Array, view: DataView): Facts {
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff && !isFrameHeader(bytes[at + 1]!)) at += 2 + view.getUint16(at + 2);
  return at + 9 < bytes.length && bytes[at] === 0xff ? { height: view.getUint16(at + 5), width: view.getUint16(at + 7) } : {};
}
/** A JPEG marker that starts a frame (SOF0 to SOF15, not DHT, JPG or DAC). */
const isFrameHeader = (marker: number): boolean => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** An MP4's duration (its movie header's duration over its timescale) and its first video track's width and height
 *  (the track header's, 16.16 fixed point). */
function mp4Facts(bytes: Uint8Array, view: DataView): { width?: number; height?: number; duration?: number } {
  const out: { width?: number; height?: number; duration?: number } = {};
  const walk = (from: number, to: number): void => {
    let at = from;
    while (at + 8 <= to) {
      let size = view.getUint32(at);
      const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
      let header = 8;
      if (size === 1 && at + 16 <= to) { size = Number(view.getBigUint64(at + 8)); header = 16; }
      if (size === 0) size = to - at;
      if (size < header || at + size > to) return;
      if (type === 'moov' || type === 'trak') walk(at + header, at + size);
      if (type === 'mvhd') {
        const v = bytes[at + header]!;
        const timescale = v === 1 ? view.getUint32(at + header + 20) : view.getUint32(at + header + 12);
        const duration = v === 1 ? Number(view.getBigUint64(at + header + 24)) : view.getUint32(at + header + 16);
        if (timescale) out.duration = Math.round(duration / timescale);
      }
      if (type === 'tkhd' && out.width === undefined) {
        const v = bytes[at + header]!;
        const base = at + header + (v === 1 ? 88 : 76);
        const w = view.getUint32(base) / 65536;
        const h = view.getUint32(base + 4) / 65536;
        if (w > 0 && h > 0) { out.width = Math.round(w); out.height = Math.round(h); }
      }
      at += size;
    }
  };
  walk(0, bytes.length);
  return out;
}

/** The rendition height Reddit names a hosted video's file by (DASH_<height>.mp4): the smallest of its ladder that holds
 *  the video (a 200-pixel video was named DASH_240, as recorded on 2020-12-03). Where the documentation stops: the
 *  ladder (240, 360, 480, 720, 1080) is Reddit's renditions as their names show; the twin transcodes nothing and serves
 *  the uploaded file under the name. */
export function renditionHeight(height: number | undefined): number {
  const ladder = [240, 360, 480, 720, 1080];
  return ladder.find((h) => (height ?? 0) <= h) ?? 1080;
}

/** A signature Reddit's preview URLs carry (`s=`): a digest the World draws from its secret, so a URL is the World's. */
async function previewSignature(ctx: HandlerContext, path: string): Promise<string> {
  return sha256(`${await ctx.secret('preview-signature')}:${path}`).slice(0, 40);
}

/** An image's preview as Reddit answers it: the source and its smaller resolutions (Reddit's widths, the ones under the
 *  source's), each on the preview host with its signature. The twin resizes nothing: each URL serves the file. */
export async function previewOf(ctx: HandlerContext, host: string, file: string, width: number, height: number, query: string): Promise<Row> {
  const widths = [108, 216, 320, 640, 960, 1080].filter((w) => w < width);
  const sig = await previewSignature(ctx, file);
  return {
    images: [{
      source: { url: `https://${host}/${file}?${query}${query ? '&' : ''}s=${sig}`, width, height },
      resolutions: widths.map((w) => ({ url: `https://${host}/${file}?width=${w}&crop=smart&${query}${query ? '&' : ''}s=${sig}`, width: w, height: Math.round((height * w) / width) })),
      variants: {},
      id: sha256(`preview:${file}`).slice(0, 43),
    }],
    enabled: host === 'preview.redd.it',
  };
}

// ── the legacy encoding ─────────────────────────────────────────────────────────────────────────

/** A JSON answer as Reddit encodes it without raw_json=1: every <, > and & in its strings written as an entity.
 *  source: https://www.reddit.com/dev/api "If you wish to opt out of this behaviour, add a raw_json=1 parameter to your request." */
export function legacyEncoded(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (Array.isArray(value)) return value.map(legacyEncoded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, legacyEncoded(v)]));
  return value;
}

// ── a post's page of comments ───────────────────────────────────────────────────────────────────

/** GET [/r/{subreddit}]/comments/{article}: the post as a one-item Listing, then its comment tree as a Listing (recorded
 *  on 2025-05-07: two listings, the second empty for a post with no comments). A post in another community than the
 *  path names is not there. */
export function commentsPage(ctx: HandlerContext, community: string | undefined): Response {
  // `.json` names the JSON form, as reddit.com's own pages read it (/comments/<id>.json)
  const id = String(ctx.call.params.article ?? '').replace(/\.json$/, '');
  const link = ctx.row(LINK, id);
  if (!link || (community !== undefined && String(link.subreddit).toLowerCase() !== community.replace(/^r\//i, '').toLowerCase())) return httpError(404);
  const viewer = callerOf(ctx)?.account;
  const sort = String(ctx.params.sort ?? 'confidence');
  const depth = Number.parseInt(String(ctx.params.depth ?? ''), 10);
  const tree = commentTree(ctx, `t3_${id}`, viewer, sort, Number.isFinite(depth) && depth > 0 ? depth : 10);
  const limit = Number.parseInt(String(ctx.params.limit ?? ''), 10);
  const shown = Number.isFinite(limit) && limit > 0 ? tree.slice(0, limit) : tree;
  return Response.json([listing([linkThing(ctx, link, viewer)], { after: null, before: null, dist: 1 }), listing(shown, { after: null, before: null, dist: null })]);
}
