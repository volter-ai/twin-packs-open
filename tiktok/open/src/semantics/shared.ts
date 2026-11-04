// What every family of the open lane shares beyond the vendor's (../../../src/semantics/shared.ts): the open platform's
// envelope, the scopes its apps are granted, and who a request is.
import type { HandlerContext } from '@volter/world-core';
import { ACCESS, ACCESS_TTL, APP, PERSON, PUBLISH, REFRESH, REFRESH_TTL, VIDEO, bySha, credential, next, obj, openIdOf, privacyOptions, seconds, sha256, type Row } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';

/** The scopes an app on the developer site is granted: every product scope the life's app asks for (the World's app is set up
 *  with the products it uses). */
export const APP_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.publish', 'video.upload'];
/** The scopes a business app on the ads portal is granted: those the life's business app asks for. */
export const BUSINESS_SCOPES = ['user.info.basic', 'user.info.username', 'user.info.stats', 'video.list', 'video.upload', 'video.publish'];

// ── the envelope ───────────────────────────────────────────────────────────────────────────────
// source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info "Any code other than"
/** An answer: `{data, error: {code: 'ok', message: '', log_id}}`. */
const logId = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, what: string): string =>
  `${ctx.occurredAt.replace(/\D/g, '').slice(0, 14)}${ctx.crypto.digest('sha256', `${ctx.occurredAt}:${what}`, 'hex').slice(0, 20).toUpperCase()}`;
export const ok = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, data: unknown): Response =>
  Response.json({ data, error: { code: 'ok', message: '', log_id: logId(ctx, JSON.stringify(data)) } });
/** A refusal in the same envelope. */
export const refuse = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, status: number, code: string, message: string): Response =>
  Response.json({ data: {}, error: { code, message, log_id: logId(ctx, code) } }, { status });

/** Who a request is: the access token it bears, live, with its app, its person and its scopes. */
type Caller = { token: Row; app: Row; person: Row; scopes: string[]; openId: string };
function callerOf(ctx: HandlerContext): Caller | undefined {
  const value = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const token = value ? bySha(ctx, ACCESS, value) : undefined;
  if (!token || token.kind === 'business' || token.revoked === true || Number(token.expires_at) <= seconds(ctx.occurredAt)) return undefined;
  const app = ctx.row(APP, String(token.app));
  const person = ctx.row(PERSON, String(token.person));
  if (!app || !person) return undefined;
  return { token, app, person, scopes: String(token.scope).split(','), openId: openIdOf(ctx, app, person) };
}

// source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info "The access_token is invalid or has expired."
const invalidToken = (ctx: HandlerContext): Response => refuse(ctx, 401, 'access_token_invalid', 'The access token is invalid or not found in the request.');
/** The caller, or the refusal: no live token (401 access_token_invalid), or none of the scopes named (401
 *  scope_not_authorized). */
export function authorized(ctx: HandlerContext, ...scopes: string[]): Caller | Response {
  const c = callerOf(ctx);
  if (!c) return invalidToken(ctx);
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info "The access_token does not bear user's grant on"
  if (scopes.length && !scopes.some((s) => c.scopes.includes(s))) return refuse(ctx, 401, 'scope_not_authorized', `The user did not authorize the scope required for completing this request (${scopes.join(' or ')}).`);
  return c;
}


export const oauthError = (ctx: HandlerContext, error: string, description: string): Response =>
  Response.json({ error, error_description: description, log_id: logId(ctx, error) }, { status: error === 'invalid_client' ? 401 : 400 });

/** Whether a code's PKCE challenge refuses the verifier: TikTok's desktop flow sends the challenge as the verifier's
 *  SHA-256 in hex; a code made without one is not checked. */
export const pkceRefused = (ctx: HandlerContext, code: Row, verifier: unknown): boolean =>
  typeof code.challenge === 'string' && ctx.crypto.digest('sha256', String(verifier ?? ''), 'hex') !== code.challenge;

export async function issue(ctx: HandlerContext, app: Row, person: Row, scope: string): Promise<Response> {
  const now = seconds(ctx.occurredAt);
  const access = await credential(ctx, ACCESS, 'act', { app: app.id, person: person.id, scope, expires_at: now + ACCESS_TTL, revoked: false });
  const refresh = await credential(ctx, REFRESH, 'rft', { app: app.id, person: person.id, scope, access: access.id, expires_at: now + REFRESH_TTL, used: false });
  return Response.json({
    access_token: access.value, expires_in: ACCESS_TTL, open_id: openIdOf(ctx, app, person), refresh_expires_in: REFRESH_TTL,
    refresh_token: refresh.value, scope, token_type: 'Bearer',
  });
}

// source: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info "The set of user fields to request for"
export const FIELD_SCOPE: Record<string, string> = {
  open_id: 'user.info.basic', union_id: 'user.info.basic', avatar_url: 'user.info.basic', avatar_url_100: 'user.info.basic', avatar_large_url: 'user.info.basic', display_name: 'user.info.basic',
  bio_description: 'user.info.profile', profile_deep_link: 'user.info.profile', is_verified: 'user.info.profile', username: 'user.info.profile',
  follower_count: 'user.info.stats', following_count: 'user.info.stats', likes_count: 'user.info.stats', video_count: 'user.info.stats',
};

// source: https://developers.tiktok.com/doc/tiktok-api-v2-video-query "choose from"
const FIELDS = ['id', 'create_time', 'cover_image_url', 'share_url', 'video_description', 'duration', 'height', 'width', 'title', 'embed_html', 'embed_link', 'like_count', 'comment_count', 'share_count', 'view_count', 'is_aigc'];

export function fieldsOf(ctx: HandlerContext): string[] | Response {
  const fields = String(new URL(ctx.call.request.url).searchParams.get('fields') ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  const unknown = fields.filter((f) => !FIELDS.includes(f));
  return !fields.length || unknown.length ? refuse(ctx, 400, 'invalid_params', `Invalid fields: ${unknown.join(',') || '(none)'}`) : fields;
}

export const project = (ctx: HandlerContext, v: Row, fields: string[]): Row => {
  const served = ctx.get(VIDEO, String(v.id)) ?? {};
  return Object.fromEntries(fields.map((f) => [f, served[f]]));
};

const MB = 1024 * 1024;

const UPLOAD_HOST = 'https://open-upload.tiktokapis.com';

export const invalid = (ctx: HandlerContext, message: string): Response => refuse(ctx, 400, 'invalid_param', message);

// source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "Each chunk must be at least 5 MB but no greater than 64 MB, except for the final chunk, which can be greater than"
/** The chunk plan's refusal, or undefined when it holds: whole below 5 MB, chunks of 5–64 MB, floor(size/chunk) of
 *  them, 1–1000, at most 4 GB in all, and the final chunk (the whole of a one-chunk plan) at most 128 MB. */
function chunkRefusal(size: number, chunk: number, count: number): string | undefined {
  if (!Number.isInteger(size) || size <= 0) return 'video_size must be a positive integer';
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "Maximum of 4GB"
  if (size > 4 * 1024 * MB) return 'video_size is over 4GB';
  if (!Number.isInteger(chunk) || chunk <= 0 || !Number.isInteger(count)) return 'chunk_size and total_chunk_count are required for FILE_UPLOAD';
  if (size < 5 * MB) return chunk === size && count === 1 ? undefined : 'a video under 5 MB is uploaded whole: chunk_size equal to video_size, total_chunk_count 1';
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "should be equal to"
  if (count !== Math.floor(size / chunk)) return 'total_chunk_count must be video_size divided by chunk_size, rounded down';
  if (count < 1 || count > 1000) return 'total_chunk_count must be between 1 and 1000';
  if (count > 1 && (chunk < 5 * MB || chunk > 64 * MB)) return 'chunk_size must be between 5 MB and 64 MB';
  // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "which can be greater than"
  if (size - chunk * (count - 1) > 128 * MB) return 'the final chunk must be at most 128 MB';
  return undefined;
}

export async function initVideo(ctx: HandlerContext, direct: boolean): Promise<Response> {
  const c = authorized(ctx, direct ? 'video.publish' : 'video.upload');
  if (c instanceof Response) return c;
  const b = obj(ctx.body);
  const post = obj(b.post_info);
  const source = obj(b.source_info);
  if (direct) {
    // source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post "privacy_level is not specified or not among the options from the privacy_level_options returned in /publish/creator_info/query/ API."
    if (!privacyOptions(c.person).includes(String(post.privacy_level))) return refuse(ctx, 403, 'privacy_level_option_mismatch', 'privacy_level is not specified or not among the options from the privacy_level_options returned in /publish/creator_info/query/ API.');
    // source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post "The maximum length is 2200 in UTF-16 runes."
    if (typeof post.title === 'string' && post.title.length > 2200) return invalid(ctx, 'title is over 2200 characters');
  }
  // Where the twin stops: the life uploads its videos (FILE_UPLOAD); a video pulled from a URL is the twin's gap, refused
  // as such, never answered as though pulled
  if (source.source === 'PULL_FROM_URL') return invalid(ctx, 'the twin does not model PULL_FROM_URL video posts');
  if (source.source !== 'FILE_UPLOAD') return invalid(ctx, 'source must be FILE_UPLOAD or PULL_FROM_URL');
  const size = Number(source.video_size);
  const bad = chunkRefusal(size, Number(source.chunk_size), Number(source.total_chunk_count));
  if (bad) return invalid(ctx, bad);
  const n = await next(ctx, 'publish');
  const id = `${direct ? 'v_pub_file' : 'v_inbox_file'}~v2.${n}`;
  const uploadId = String(7_300_000_000_000_000_000n + BigInt(n));
  const token = (await ctx.secret(`tiktok-upload-token:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  await ctx.write(PUBLISH, id, {
    status: 'PROCESSING_UPLOAD', fail_reason: '', publicaly_available_post_id: [], uploaded_bytes: 0,
    _person: c.person.id, _app: c.app.id, _kind: direct ? 'direct' : 'inbox', _media: 'VIDEO', _post_info: direct ? post : {},
    _video_size: size, _chunk_size: Number(source.chunk_size), _chunks: Number(source.total_chunk_count),
    _upload_id: uploadId, _upload_token_sha256: sha256(ctx, token), _upload_expires: seconds(ctx.occurredAt) + 3600,
  }, direct ? 'videoInit' : 'inboxVideoInit');
  return ok(ctx, { publish_id: id, upload_url: `${UPLOAD_HOST}/video/?upload_id=${uploadId}&upload_token=${token}` });
}

/** A pull from URLs: each must be under a URL property the app verified (403 url_ownership_unverified); the vendor
 *  pulls them through the World (ctx.vendorFetch, the World's one network) and a URL the World does not serve fails the
 *  post (photo_pull_failed, video_pull_failed). */
export async function pull(ctx: HandlerContext, c: Caller, kind: 'direct' | 'inbox', media: 'PHOTO', urls: string[], post: Row): Promise<Response> {
  const app = ctx.row(APP, String(c.app.id))!;
  const props = (app.url_properties as string[] | undefined) ?? [];
  const verified = (url: string): boolean => {
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    // source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "The media URL must use"
    if (u.protocol !== 'https:') return false;
    return props.some((p) => (p.includes('/') ? url.startsWith(p) : u.hostname === p || u.hostname.endsWith(`.${p}`)));
  };
  // source: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post "the developer must verify the ownership of the URL prefix or domain"
  if (!urls.every(verified)) return refuse(ctx, 403, 'url_ownership_unverified', 'To use PULL_FROM_URL as the media transfer method, the developer must verify the ownership of the URL prefix or domain.');
  const n = await next(ctx, 'publish');
  const id = `p_${kind === 'direct' ? 'pub' : 'inbox'}_url~v2.${n}`;
  await ctx.write(PUBLISH, id, {
    status: 'PROCESSING_DOWNLOAD', fail_reason: '', publicaly_available_post_id: [], downloaded_bytes: 0,
    _person: c.person.id, _app: c.app.id, _kind: kind, _media: media, _post_info: post, _urls: urls,
  }, 'contentInit');
  let downloaded = 0;
  let failed = false;
  for (const url of urls) {
    try {
      const r = await ctx.vendorFetch(url, { method: 'GET' });
      if (!r.ok) { failed = true; break; }
      downloaded += (await r.arrayBuffer()).byteLength;
    } catch { failed = true; break; }
  }
  const to = failed ? 'FAILED' : kind === 'direct' ? 'PUBLISH_COMPLETE' : 'SEND_TO_USER_INBOX';
  const refused = ctx.legal(PUBLISH, 'status', 'contentInit', 'PROCESSING_DOWNLOAD', to, id, 'vendor');
  if (refused) throw new Error(refused.message);
  const postId = !failed && kind === 'direct' && post.privacy_level === 'PUBLIC_TO_EVERYONE' ? String(7_400_000_000_000_000_000 + (await next(ctx, 'video')) * 1024) : undefined;
  await ctx.write(PUBLISH, id, {
    status: to, downloaded_bytes: downloaded, ...(failed ? { fail_reason: 'photo_pull_failed' } : {}),
    ...(postId ? { publicaly_available_post_id: [Number(postId)] } : {}),
  }, 'contentInit');
  return ok(ctx, { publish_id: id });
}

/** A chunk that is not the last: its progress kept, answered 206 with the bytes so far. */
// source: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide "There are additional chunks yet to be uploaded."
export async function partialChunk(ctx: HandlerContext, id: string, now: number, size: number): Promise<Response> {
  await ctx.write(PUBLISH, id, { uploaded_bytes: now }, 'uploadVideo');
  return new Response(null, { status: 206, headers: { 'content-range': `bytes 0-${now - 1}/${size}` } });
}
