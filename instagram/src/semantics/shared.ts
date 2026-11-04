// What every family of instagram shares: its stored shapes, who is calling, the Graph API's answers and refusals, the
// fields a request selects, and how Instagram fetches a container's media.
import { placeholderPng, type HandlerContext } from '@volter/world-core';
import { imageFormat, jpegFacts, mp4Facts } from '../engine/media.ts';

export type Row = Record<string, unknown>;

// ── stored types ────────────────────────────────────────────────────────────────────────────────
export const APP = '_app';
export const ACCOUNT = '_account';
export const CODE = '_code';
export const TOKEN = '_token';
export const SESSION = '_session';
export const CONTAINER = 'container';
export const MEDIA = 'media';
export const COMMENT = 'comment';

/** The Graph API's own host and its latest version, as a paging link names them. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "The lastest API version is: v26.0"
const GRAPH = 'https://graph.instagram.com/v26.0';
/** The CDN Instagram serves a media's file, a thumbnail and a profile picture from (../screens/cdn.ts). */
// source: https://developers.facebook.com/documentation/instagram-platform/overview "Instagram Platform leverages Content Delivery Network (CDN) URLs which allow you to retrieve rich media content shared by Instagram users."
export const CDN = 'https://scontent.cdninstagram.com';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.sha256(v);
export const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
/** An instant as Instagram writes one: ISO 8601 in UTC with its offset as `+0000`. */
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "2019-09-26T22:36:43+0000"
export const igTime = (iso: string): string => `${new Date(Date.parse(iso)).toISOString().slice(0, 19)}+0000`;
/** A decimal of `width` digits derived from a public seed (an app-scoped or Instagram-scoped user ID). */
const decimalFrom = (ctx: Pick<HandlerContext, 'crypto'>, seed: string, width: number): string => {
  const floor = 10n ** BigInt(width - 1);
  return String(floor + BigInt(`0x${ctx.crypto.sha256(seed).slice(0, 24)}`) % (9n * floor));
};
/** A request's parameters, from its query and its body alike (a Graph API call takes either). */
export const paramsOf = (ctx: HandlerContext): Row => ({ ...obj(ctx.params), ...obj(ctx.body) });
export const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined);
/** A boolean parameter as the Graph API reads one (`true`, `false`), or undefined. */
export const flagOf = (v: unknown): boolean | undefined => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined);

// ── the Graph API's errors ──────────────────────────────────────────────────────────────────────
// source: https://developers.facebook.com/docs/graph-api/guides/error-handling "Internal support identifier."
/** An error in the Graph API's body: `{error: {message, type, code, error_subcode?, fbtrace_id}}`. */
export function graphError(ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, status: number, code: number, message: string, subcode?: number): Response {
  const fbtrace = ctx.crypto.digest('sha256', `${ctx.occurredAt}:${code}:${message}`, 'base64url').slice(0, 23);
  return Response.json({ error: { message, type: 'OAuthException', code, ...(subcode !== undefined ? { error_subcode: subcode } : {}), fbtrace_id: fbtrace } }, { status });
}
/** The token is missing, unknown, expired or no longer held. */
// source: https://developers.facebook.com/docs/graph-api/guides/error-handling "access token has expired, been revoked, or is otherwise invalid"
export const invalidToken = (ctx: HandlerContext): Response => graphError(ctx, 400, 190, 'Invalid OAuth access token: the login status or access token has expired, been revoked, or is otherwise invalid.');
/** A permission the token does not carry. */
// source: https://developers.facebook.com/docs/graph-api/guides/error-handling "Permission is either not granted or has been removed."
const permissionDenied = (ctx: HandlerContext, permission: string): Response => graphError(ctx, 403, 10, `(#10) Permission is either not granted or has been removed: ${permission}.`);
/** A parameter Instagram does not take, or one missing. Where the documentation stops: its pages name the code of the
 *  class (100, invalid parameter) and not each message; the message says which parameter. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The media type {media-type} is unknown."
export const invalidParam = (ctx: HandlerContext, message: string): Response => graphError(ctx, 400, 100, message);
/** A node the caller cannot reach at this ID by this method. Where the documentation stops: its pages give the class
 *  (100) and not the message; the twin answers the Graph API's wording for it. */
export const unsupported = (ctx: HandlerContext, method: string, id: string): Response =>
  graphError(ctx, 400, 100, `Unsupported ${method.toLowerCase()} request. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`);
/** A media the caller cannot find: none by that ID, or not its own. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Possible permission error due to missing permission or expired token."
export const mediaNotFound = (ctx: HandlerContext, id: string): Response => graphError(ctx, 400, 24, `The media with ${id} cannot be found`, 2207006);
/** The code exchange's own refusal body, on api.instagram.com. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Matching code was not found or was already used"
export const oauthError = (message: string): Response => Response.json({ error_type: 'OAuthException', code: 400, error_message: message }, { status: 400 });

// ── apps, accounts and tokens ───────────────────────────────────────────────────────────────────
// source: https://developers.facebook.com/documentation/instagram-platform/overview "instagram_business_basic"
export const PERMISSIONS = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_messages', 'instagram_business_manage_insights'];
export const BASIC = 'instagram_business_basic';
export const PUBLISH = 'instagram_business_content_publish';
export const COMMENTS = 'instagram_business_manage_comments';
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "instagram_business_manage_insights"
export const INSIGHTS = 'instagram_business_manage_insights';
// source: https://developers.facebook.com/documentation/instagram-platform/overview "This access token is valid for one hour ."
const SHORT_TTL = 3600;
// source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "for long-lived Instagram User access token that expires in 60 days."
const LONG_TTL = 5184000;
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "This code is valid for 1 hour and can only be used once."
export const CODE_TTL = 3600;

/** An app's Instagram App Secret, drawn from the World's secret under its id. */
export const appSecret = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, app: Row): Promise<string> =>
  ctx.crypto.sha256(await ctx.secret(String(app._secret_label ?? `instagram-app-secret:${String(app.id)}`))).slice(0, 32);
export const appById = (ctx: Pick<HandlerContext, 'rowsRaw'>, appId: unknown): Row | undefined => ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.app_id === String(appId ?? ''));
export const accountByName = (ctx: Pick<HandlerContext, 'rowsRaw'>, username: unknown): Row | undefined => ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.username === String(username ?? '').toLowerCase());
/** A professional account is a Business or a Creator account: only one of them uses the API. */
// source: https://developers.facebook.com/documentation/instagram-platform/overview "To use the APIs, your app users must have an Instagram professional account"
export const professional = (account: Row): boolean => account.account_type === 'Business' || account.account_type === 'Media_Creator';
/** The app user's app-scoped ID: the account as this app knows it. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started "app-scoped ID"
export const appScopedId = (ctx: Pick<HandlerContext, 'crypto'>, app: Row, account: Row): string => decimalFrom(ctx, `instagram-app-scoped:${String(app.id)}:${String(account.id)}`, 17);
/** The Instagram-scoped ID of a person who comments on a professional account's media. */
// source: https://developers.facebook.com/documentation/instagram-platform/overview "This ID is specific to the person and the Instagram account they are interacting with."
export const igsid = (ctx: Pick<HandlerContext, 'crypto'>, owner: string, username: string): string => decimalFrom(ctx, `instagram-scoped:${owner}:${username}`, 16);

/** A token of Instagram's form, drawn from the World's secret under its minted id, kept by its SHA-256. The same token
 *  row always gives the same value (the App Dashboard's token is handed out again at every boot). */
export const tokenValue = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> =>
  `IGAA${(await ctx.secret(`instagram-token:${id}`)).replace(/[^A-Za-z0-9]/g, '')}${(await ctx.secret(`instagram-token:${id}:tail`)).replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 120);
export async function issueToken(ctx: HandlerContext, fields: { app: string; account: string; permissions: string[]; kind: 'short' | 'long'; source: string }): Promise<{ id: string; value: string; expiresIn: number }> {
  const id = await ctx.issue(TOKEN);
  const value = await tokenValue(ctx, id);
  const expiresIn = fields.kind === 'short' ? SHORT_TTL : LONG_TTL;
  const now = seconds(ctx.occurredAt);
  await ctx.record(TOKEN, { ...fields, sha256: sha256(ctx, value), issued_at: now, expires_at: now + expiresIn }, id);
  return { id, value, expiresIn };
}
export const tokenBySha = (ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto'>, value: string): Row | undefined =>
  ctx.rowsRaw(TOKEN).find((t) => t.deleted !== true && t.sha256 === sha256(ctx, value));

/** The token a request carries: the access_token parameter, or the Authorization header (Bearer, or OAuth as the
 *  upload host takes it). */
// source: https://developers.facebook.com/documentation/instagram-platform/content-publishing "Authorization: Bearer <ACCESS_TOKEN>"
function presented(ctx: HandlerContext): string | undefined {
  const given = text(paramsOf(ctx).access_token);
  if (given) return given;
  return /^(?:Bearer|OAuth)\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
}

/** Who a request is: the live token's app, account and granted permissions. */
export type Caller = { app: Row; account: Row; permissions: string[]; scoped: string };
function callerOf(ctx: HandlerContext): Caller | undefined {
  const value = presented(ctx);
  const token = value ? tokenBySha(ctx, value) : undefined;
  if (!token || Number(token.expires_at) <= seconds(ctx.occurredAt)) return undefined;
  const app = ctx.row(APP, String(token.app));
  const account = ctx.row(ACCOUNT, String(token.account));
  if (!app || !account) return undefined;
  return { app, account, permissions: (token.permissions as string[] | undefined) ?? [], scoped: appScopedId(ctx, app, account) };
}
/** The caller, or the refusal: no live token (190), or a permission the endpoint needs that it lacks (10). */
export function authorized(ctx: HandlerContext, ...permissions: string[]): Caller | Response {
  const c = callerOf(ctx);
  if (!c) return invalidToken(ctx);
  const missing = [BASIC, ...permissions].find((p) => !c.permissions.includes(p));
  return missing ? permissionDenied(ctx, missing) : c;
}
/** Whether a path's user ID is the caller's account: `me`, its app-scoped ID, or its Instagram professional account ID. */
// source: https://developers.facebook.com/documentation/instagram-platform/overview "Instagram professional account ID or /me"
export const isCaller = (c: Caller, id: unknown): boolean => id === 'me' || id === c.scoped || id === String(c.account.id);

// ── selecting fields ────────────────────────────────────────────────────────────────────────────
/** A field a request selects, with what it expands (`replies{id,text}`, field expansion). */
type Field = { name: string; sub?: Field[] };
/** The `fields` parameter read: a comma-separated list whose entries may expand an edge in braces; undefined when it
 *  is not well formed. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Replies to comments are not included unless you use field expansion to request the replies field."
function parseFields(given: string): Field[] | undefined {
  let at = 0;
  const list = (): Field[] | undefined => {
    const out: Field[] = [];
    while (at < given.length) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*/.exec(given.slice(at));
      if (!m) return undefined;
      at += m[0].length;
      const field: Field = { name: m[1]! };
      if (given[at] === '{') {
        at += 1;
        const sub = list();
        if (!sub || given[at] !== '}') return undefined;
        at += 1;
        field.sub = sub;
      }
      out.push(field);
      while (given[at] === ' ') at += 1;
      if (given[at] === ',') { at += 1; continue; }
      break;
    }
    return out;
  };
  const fields = list();
  return fields && at === given.length && fields.length ? fields : undefined;
}
/** The fields a request asks, or `fallback` when it names none; a malformed list is refused. */
export function selection(ctx: HandlerContext, fallback: string[]): Field[] | Response {
  const given = text(paramsOf(ctx).fields);
  if (given === undefined || given.trim() === '') return fallback.map((name) => ({ name }));
  return parseFields(given) ?? invalidParam(ctx, `(#100) The fields parameter is not well formed: ${given}`);
}
const nonexisting = (ctx: HandlerContext, field: string, node: string): Response => invalidParam(ctx, `(#100) Tried accessing nonexisting field (${field}) on node type (${node})`);

// ── views ───────────────────────────────────────────────────────────────────────────────────────
/** The IG User as its fields answer it (the Instagram API with Instagram Login's fields). */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started "You can use the fields query string parameter to request the following fields on a User."
export function userView(ctx: HandlerContext, c: Pick<Caller, 'app' | 'account'>, fields: Field[]): Row | Response {
  const a = c.account;
  const all: Row = {
    id: appScopedId(ctx, c.app, a), user_id: String(a.id), username: a.username, name: a.name ?? a.username, account_type: a.account_type,
    profile_picture_url: `${CDN}/v/t51.2885-19/${String(a.id)}_profile.png`, followers_count: Number(a.followers_count ?? 0), follows_count: Number(a.follows_count ?? 0),
    // "The number of Media object on the User": its published media, counted from the set
    media_count: ctx.rowsRaw(MEDIA).filter((m) => m.deleted !== true && m._account === a.id).length,
    biography: a.biography ?? '', website: a.website ?? '',
  };
  const out: Row = {};
  for (const f of fields) {
    if (!(f.name in all)) return nonexisting(ctx, f.name, 'User');
    out[f.name] = all[f.name];
  }
  return out;
}

/** An IG Container as its fields answer it. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container "A comma-separated list of fields and edges you want returned. If omitted, default fields will be returned."
export function containerView(ctx: HandlerContext, row: Row, fields: Field[]): Row | Response {
  const own = ctx.render(row, CONTAINER);
  const all: Row = { id: own.id, status_code: own.status_code, status: own.status };
  const out: Row = { id: own.id };
  for (const f of fields) {
    if (!(f.name in all)) return nonexisting(ctx, f.name, 'ShadowIGMediaBuilder');
    out[f.name] = all[f.name];
  }
  return out;
}

/** A media's comments, replies included, counted from its live comments. */
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Includes replies on comments."
export const commentsCount = (ctx: Pick<HandlerContext, 'rowsRaw'>, mediaId: string): number => ctx.rowsRaw(COMMENT).filter((r) => r.deleted !== true && obj(r.media).id === mediaId).length;

/** An IG Media as its fields answer it to its owner. */
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "Comma-separated list of fields you want returned."
export function mediaView(ctx: HandlerContext, row: Row, fields: Field[]): Row | Response {
  const own = ctx.own(row);
  const video = own.media_type === 'VIDEO';
  const out: Row = {};
  for (const f of fields) {
    switch (f.name) {
      case 'id': case 'caption': case 'comments_count': case 'is_comment_enabled': case 'like_count': case 'media_type': case 'media_product_type':
      case 'media_url': case 'permalink': case 'shortcode': case 'timestamp': case 'username': case 'is_ai_generated':
        out[f.name] = f.name === 'id' ? String(own.id ?? row.id) : f.name === 'comments_count' ? commentsCount(ctx, String(own.id ?? row.id)) : own[f.name];
        break;
      // "Only available on VIDEO media."
      case 'thumbnail_url': if (video) out.thumbnail_url = own.thumbnail_url; break;
      // "For Reels only."
      case 'is_shared_to_feed': if (own.media_product_type === 'REELS') out.is_shared_to_feed = own.is_shared_to_feed; break;
      case 'alt_text': if (!video && typeof own.alt_text === 'string') out.alt_text = own.alt_text; break;
      // "Only returned if the app user making the query also created the media"
      case 'owner': out.owner = { id: String(row._account) }; break;
      case 'comments': {
        const list = commentList(ctx, String(own.id ?? row.id), f.sub ?? [{ name: 'timestamp' }, { name: 'text' }, { name: 'id' }]);
        if (list instanceof Response) return list;
        out.comments = { data: list };
        break;
      }
      default: return nonexisting(ctx, f.name, 'Media');
    }
  }
  return out;
}

/** A media's top-level comments, newest first, each as the fields select it. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Returns results in reverse chronological order by default."
export function commentList(ctx: HandlerContext, mediaId: string, fields: Field[]): Row[] | Response {
  const rows = ctx.rowsRaw(COMMENT).filter((r) => r.deleted !== true && obj(r.media).id === mediaId && r.parent_id === undefined).reverse();
  const out: Row[] = [];
  for (const r of rows) {
    const v = commentView(ctx, r, fields);
    if (v instanceof Response) return v;
    out.push(v);
  }
  return out;
}
/** A comment's replies, newest first. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies "Returns a list of IG Comments on an IG Comment ."
export const repliesOf = (ctx: HandlerContext, commentId: string): Row[] =>
  ctx.rowsRaw(COMMENT).filter((r) => r.deleted !== true && r.parent_id === commentId).reverse();

/** An IG Comment as its fields answer it. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment "Comma-separated list of IG Comment fields you want returned for each IG Comment in the result set."
export function commentView(ctx: HandlerContext, row: Row, fields: Field[]): Row | Response {
  const own = ctx.own(row);
  const out: Row = {};
  for (const f of fields) {
    switch (f.name) {
      case 'id': out.id = String(own.id ?? row.id); break;
      case 'text': case 'timestamp': case 'hidden': case 'like_count': case 'username': out[f.name] = own[f.name]; break;
      case 'from': out.from = own.from; break;
      // "media_product_type — Published surface of the IG Media"
      case 'media': {
        const m = obj(own.media);
        const wanted = f.sub?.map((s) => s.name) ?? ['id'];
        out.media = Object.fromEntries(wanted.filter((k) => k === 'id' || k === 'media_product_type').map((k) => [k, m[k]]));
        break;
      }
      // "ID of the parent IG Comment if this comment was created on another IG Comment"
      case 'parent_id': if (typeof own.parent_id === 'string') out.parent_id = own.parent_id; break;
      // "Only returned if the app user created the IG Comment, otherwise username will be returned instead."
      case 'user': if (typeof row._user === 'string') out.user = { id: row._user }; else out.username = own.username; break;
      case 'replies': {
        const data: Row[] = [];
        for (const r of repliesOf(ctx, String(own.id ?? row.id))) {
          const v = commentView(ctx, r, (f.sub ?? [{ name: 'timestamp' }, { name: 'text' }, { name: 'id' }]).filter((s) => s.name !== 'replies'));
          if (v instanceof Response) return v;
          data.push(v);
        }
        out.replies = { data };
        break;
      }
      default: return nonexisting(ctx, f.name, 'IGCommentFromUser');
    }
  }
  return out;
}

// ── paging ──────────────────────────────────────────────────────────────────────────────────────
const cursorOf = (id: string): string => btoa(id).replace(/=+$/, '');
const idOfCursor = (cursor: string): string | undefined => { try { return atob(cursor); } catch { return undefined; } };
/** A page of a list as the Graph API answers it: `data`, and `paging` with its cursors and, when more follow, the
 *  `next` link (the Graph host's, at `path`, carrying the request's other parameters). */
// source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "An object containing URLs used to request the next set of results."
export function paged(ctx: HandlerContext, items: Array<{ id: string; view: Row }>, path: string, limitDefault: number, limitMax: number): Response {
  const p = paramsOf(ctx);
  const limit = Math.max(1, Math.min(limitMax, Number(text(p.limit) ?? limitDefault) || limitDefault));
  const given = text(p.after);
  const after = given ? idOfCursor(given) : undefined;
  const start = after !== undefined ? items.findIndex((i) => i.id === after) + 1 : 0;
  // a cursor this list never answered names no place in it: refused, never read as the first page. Where the
  // documentation stops: the pages give no message for it; it is the invalid-parameter class (100)
  if (given && start === 0) return invalidParam(ctx, '(#100) The after cursor is not valid for this list.');
  const page = items.slice(start, start + limit);
  if (!page.length) return Response.json({ data: [] });
  const more = start + limit < items.length;
  const keep = new URLSearchParams(Object.entries(obj(ctx.params)).filter(([k, v]) => k !== 'after' && k !== 'access_token' && !(k in ctx.call.params) && typeof v === 'string') as Array<[string, string]>);
  // the next link is fetched as given, so it carries the request's token, as the Graph API's own does
  const token = presented(ctx);
  if (token) keep.set('access_token', token);
  keep.set('limit', String(limit));
  keep.set('after', cursorOf(page.at(-1)!.id));
  return Response.json({
    data: page.map((i) => i.view),
    paging: { cursors: { before: cursorOf(page[0]!.id), after: cursorOf(page.at(-1)!.id) }, ...(more ? { next: `${GRAPH}${path}?${keep}` } : {}) },
  });
}

// ── what Instagram fetches ──────────────────────────────────────────────────────────────────────
/** A media file Instagram fetches from the URL a container names, through the World (ctx.vendorFetch: the World's one
 *  network): its bytes, or why there are none. A URL the World holds nothing at is one Instagram cannot reach. */
// source: https://developers.facebook.com/documentation/instagram-platform/content-publishing "We cURL media used in publishing attempts, so the media must be hosted on a publicly accessible server at the time of the attempt."
export async function fetchMedia(ctx: HandlerContext, url: string): Promise<{ bytes: Uint8Array } | undefined> {
  let target: URL;
  try { target = new URL(url); } catch { return undefined; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return undefined;
  try {
    const r = await ctx.vendorFetch(target, { method: 'GET' });
    if (!r.ok) return undefined;
    return { bytes: new Uint8Array(await r.arrayBuffer()) };
  } catch { return undefined; }
}
/** A fetched file kept in the World's blobs by its digest. */
export async function keep(ctx: HandlerContext, bytes: Uint8Array): Promise<string> {
  const digest = ctx.crypto.digest('sha256', bytes, 'hex');
  await ctx.blobs.put(`media/${digest}`, bytes);
  return digest;
}
export { imageFormat, jpegFacts, mp4Facts };

/** A placeholder picture the CDN answers for a profile picture (the twin makes no picture of anyone). */
export const profilePicture = (id: string): Uint8Array => placeholderPng({ width: 320, height: 320 }, `instagram:profile:${id}`, `placeholder profile picture from the Instagram twin: ${id}`);

/** A container's moment of expiry: 24 hours after it was made. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Containers expire after 24 hours"
const CONTAINER_TTL = 86400;
/** A container read or published at or past its expiry moves to EXPIRED, at the moment it fell due (the vendor's move,
 *  recorded with no caller), unless it was published or failed first. Answers the container as it now stands. */
export async function settled(ctx: HandlerContext, row: Row): Promise<Row> {
  const due = Number(row._created) + CONTAINER_TTL;
  if (row.status_code !== 'FINISHED' || seconds(ctx.occurredAt) < due) return row;
  const id = String(row.id);
  const at = await ctx.at(new Date(due * 1000).toISOString());
  const refused = at.legal(CONTAINER, 'status_code', ctx.call.operation.id, 'FINISHED', 'EXPIRED', id, 'vendor');
  if (refused) throw new Error(refused.message);
  await ctx.asVendor(() => at.write(CONTAINER, id, { status_code: 'EXPIRED', status: 'EXPIRED' }, ctx.call.operation.id));
  return ctx.row(CONTAINER, id) ?? row;
}

/** The subcodes the Graph API answers beside a container refusal's code. */
// source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "Check the container status and publish when its status is FINISHED ."
export const SUBCODES: Record<string, number> = { 9007: 2207027, 24: 2207008 };
