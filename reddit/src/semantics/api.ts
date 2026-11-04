// Reddit's /api family: the token endpoint, the identity, the media lease, submit, comment, vote, delete, a moderator's
// removal, subscribe and a community's making, each as Reddit answers it.
import { personWith, type HandlerContext } from '@volter/world-core';
import {
  accountNamed, ACCOUNT, APP, ASSET, bucketHost, callerOf, CLIENT_SECRET, COMMENT, commentView, err, hasScope, httpError, IMAGE_TYPES, jsonAnswer, LINK,
  MEDIA_BUCKET, MEMBERSHIP, membership, nowSeconds, paramsOf, previewOf, redditHtml, renditionHeight, slugOf, SUBREDDIT,
  subredditNamed, subscribersOf, TOKEN, VIDEO_BUCKET, VIDEO_TYPES, VOTE, type Row,
} from './shared.ts';


// ── the token endpoint ──────────────────────────────────────────────────────────────────────────

/** The scopes a token may name (the OAuth2 wiki's list, with the ones dev/api's endpoints name since). */
// source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "identity, edit, flair, history, modconfig, modflair, modlog, modposts, modwiki,"
const SCOPES = new Set(['identity', 'edit', 'flair', 'history', 'modconfig', 'modflair', 'modlog', 'modposts', 'modwiki', 'mysubreddits', 'privatemessages', 'read', 'report', 'save', 'submit', 'subscribe', 'vote', 'wikiedit', 'wikiread', 'account', 'creddits', 'livemanage', 'modcontributors', 'modmail', 'modnote', 'modothers', 'modself', 'modtraffic', 'structuredstyles', 'announcements', '*']);
/** How long a token lives: the token answer's expires_in, as recorded for a script app's password grant on 2026-04-13.
 *  source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubmission.test_hide_multiple.json "86400" */
const TOKEN_SECONDS = 86400;

/** The client the HTTP Basic credentials name, when its secret is right (an installed app sends an empty one). */
function clientOf(ctx: HandlerContext): Row | undefined {
  const auth = ctx.call.request.headers.get('authorization') ?? '';
  const basic = /^basic\s+(\S+)$/i.exec(auth.trim())?.[1];
  if (!basic) return undefined;
  let decoded = '';
  try { decoded = atob(basic); } catch { return undefined; }
  const at = decoded.indexOf(':');
  if (at < 1) return undefined;
  const [id, secret] = [decoded.slice(0, at), decoded.slice(at + 1)];
  const app = ctx.row(APP, id);
  if (!app) return undefined;
  if (app.app_type === 'installed') return app;
  const held = ctx.row(CLIENT_SECRET, id);
  return held && secret && held.sha256 === ctx.crypto.sha256(secret) ? app : undefined;
}

/** A grant other than a script's password: the other grants (authorization_code, refresh_token, client_credentials,
 *  installed_client) are flows neither this pack's demand nor its life uses, which answer the gap; an unknown grant is
 *  the wiki's unsupported_grant_type. */
function otherGrant(grant: string): Response {
  // source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "grant_type parameter was invalid or Http Content type was not set correctly"
  return ['authorization_code', 'refresh_token', 'client_credentials', 'https://oauth.reddit.com/grants/installed_client'].includes(grant) ? httpError(404) : Response.json({ error: 'unsupported_grant_type' });
}

export async function POST_api_v1_access_token(ctx: HandlerContext): Promise<Response> {
  const client = clientOf(ctx);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/oauth2.py "abort(401, headers=[(\"WWW-Authenticate\", 'Basic realm=\"reddit\"')])"
  if (!client) return httpError(401, { 'www-authenticate': 'Basic realm="reddit"' });
  const p = paramsOf(ctx);
  const grant = p.grant_type ?? '';
  // source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "Other values not relevant to this flow are refresh_token (for renewing an access token) and password (for script apps only)"
  if (grant !== 'password') return otherGrant(grant);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/oauth2.py "Only script apps may use password auth"
  if (client.app_type !== 'script') return Response.json({ error: 'unauthorized_client', error_description: 'Only script apps may use password auth' });
  const account = accountNamed(ctx, p.username ?? '');
  const right = account ? personWith(ctx, String(account._email), p.password ?? '') !== undefined : false;
  // only the app's own developers sign in with their password (r2: "if not user or user._id not in dev_ids")
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/oauth2.py "return self.api_wrapper({\"error\": \"invalid_grant\"})"
  if (!account || !right || !(client.developers as string[] ?? []).includes(String(account.id))) return Response.json({ error: 'invalid_grant' });
  // a token's scopes are a set, answered sorted and joined by one space (a scope asked twice is one)
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/models/token.py "self.scopes = set(scopes.replace(',', ' ').split(' '))"
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/models/token.py "return sr_part + ' '.join(sorted(self.scopes))"
  const scope = [...new Set((p.scope ?? '*').split(/[\s,]+/).filter(Boolean))].sort();
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/oauth2.py "return self.api_wrapper({\"error\": \"invalid_scope\"})"
  if (!scope.length || scope.some((s) => !SCOPES.has(s))) return Response.json({ error: 'invalid_scope' });
  const issued = await ctx.issue('_token_issue');
  const token = `${String(account.id)}-${(await ctx.secret(`access-token:${issued}`)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30)}`;
  const now = nowSeconds(ctx);
  await ctx.record(TOKEN, { sha256: ctx.crypto.sha256(token), account: account.id, client: client.client_id, scope: scope.join(' '), expires_at: now + TOKEN_SECONDS, issued_utc: now }, `token_${issued}`);
  // source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "will only be present if one was requested"
  return Response.json({ access_token: token, token_type: 'bearer', expires_in: TOKEN_SECONDS, scope: scope.join(' ') });
}

// ── the identity ────────────────────────────────────────────────────────────────────────────────

export async function GET_api_v1_me(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const a = ctx.row(ACCOUNT, caller.account)!;
  const profile = ctx.row(SUBREDDIT, String(a._profile));
  const links = ctx.rowsRaw(LINK).filter((l) => l.author === a.name);
  const comments = ctx.rowsRaw(COMMENT).filter((c) => c.author === a.name);
  const karma = (things: Row[], prefix: string): number => things.reduce((n, t) => n + ctx.rowsRaw(VOTE).filter((v) => v.thing === `${prefix}${String(t.id)}` && v.voter !== a.id).reduce((s, v) => s + Number(v.dir), 0), 0);
  const isMod = ctx.rowsRaw(MEMBERSHIP).some((m) => m.user === a.id && m.moderator === true);
  // source: spec:GET_api_v1_me "Returns the identity of the user."
  return Response.json({
    is_employee: false, seen_layout_switch: false, has_visited_new_profile: false, pref_no_profanity: true, has_external_account: false, pref_geopopular: '',
    seen_redesign_modal: false, pref_show_trending: true,
    subreddit: profile ? {
      default_set: true, user_is_contributor: false, banner_img: '', restrict_posting: true, user_is_banned: false, free_form_reports: true, community_icon: null,
      show_media: true, icon_color: '#94E044', user_is_muted: null, display_name: profile.display_name, header_img: null, title: '', coins: 0, previous_names: [],
      over_18: false, icon_size: [256, 256], primary_color: '', icon_img: 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png', description: '',
      submit_link_label: '', header_size: null, restrict_commenting: false, subscribers: subscribersOf(ctx, String(profile.id)), submit_text_label: '',
      is_default_icon: true, link_flair_position: '', display_name_prefixed: `u/${String(a.name)}`, key_color: '', name: `t5_${String(profile.id)}`,
      is_default_banner: true, url: `/user/${String(a.name)}/`, banner_size: null, user_is_moderator: true, public_description: '', link_flair_enabled: false,
      disable_contributor_requests: false, subreddit_type: 'user', user_is_subscriber: false,
    } : null,
    is_sponsor: false, gold_expiration: null, has_gold_subscription: false, num_friends: 0, features: {}, has_android_subscription: false, verified: true,
    new_modmail_exists: null, pref_autoplay: true, coins: 0, has_paypal_subscription: false, has_subscribed_to_premium: false, id: a.id,
    has_stripe_subscription: false, seen_premium_adblock_modal: false, can_create_subreddit: true, over_18: false, is_gold: false, is_mod: isMod,
    suspension_expiration_utc: null, has_verified_email: true, is_suspended: false, pref_video_autoplay: true, in_chat: false, can_edit_name: false,
    in_redesign_beta: true, icon_img: 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_3.png', has_mod_mail: false, pref_nightmode: false,
    oauth_client_id: caller.via === 'bearer' ? caller.client : null, hide_from_robots: false, link_karma: karma(links, 't3_'), force_password_reset: false,
    seen_give_award_tooltip: false, inbox_count: 0, pref_top_karma_subreddits: true, has_mail: false, pref_show_snoovatar: false, name: a.name,
    pref_clickgadget: 5, created: a.created_utc, gold_creddits: 0, created_utc: a.created_utc, has_ios_subscription: false, pref_show_twitter: false,
    in_beta: false, comment_karma: karma(comments, 't1_'), has_subscribed: true, seen_subreddit_chat_ftux: false,
  });
}

// ── the media lease ─────────────────────────────────────────────────────────────────────────────

export async function POST_api_media_asset_json(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  const filepath = (p.filepath ?? '').split(/[\\/]/).pop() ?? '';
  const mimetype = (p.mimetype ?? '').toLowerCase();
  // Where the documentation stops: Reddit documents no refusal for this endpoint; a missing field or a media type its
  // posts do not carry is answered in its field-refusal form (400: fields, explanation, message, reason, as recorded on
  // 2018-09-15 for a refused field)
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestRedditor.test_trophies__user_not_exist.json "explanation"
  if (!filepath) return Response.json({ fields: ['filepath'], explanation: 'we need something here', message: 'Bad Request', reason: 'NO_TEXT' }, { status: 400 });
  const isVideo = mimetype in VIDEO_TYPES;
  if (!isVideo && !(mimetype in IMAGE_TYPES)) return Response.json({ fields: ['mimetype'], explanation: 'that option is not valid', message: 'Bad Request', reason: 'INVALID_OPTION' }, { status: 400 });
  const id = ctx.mint(ASSET);
  const now = nowSeconds(ctx);
  const date = new Date(now * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const bucket = isVideo ? VIDEO_BUCKET : MEDIA_BUCKET;
  const ext = (isVideo ? VIDEO_TYPES : IMAGE_TYPES)[mimetype]!;
  // an image's lease allows 1 byte to 20 MiB (its policy's content-length-range, recorded 2025-05-07; the size S3 answers
  // as the most an image may be in PRAW's test of a large one)
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/models/reddit/test_subreddit.py "<MaxSizeAllowed>20971520</MaxSizeAllowed>"
  // Where the documentation stops: a video's ceiling, 2 GiB, is the 2020-12-03 lease's policy (its base64 decoded), the
  // last recorded for the video bucket
  const max = isVideo ? 2147483648 : 20971520;
  // a lease's policy expires fifteen minutes after its date (recorded 2025-05-07: x-amz-date 17:13:41, expiration 17:28:41)
  const expiration = new Date((now + 900) * 1000).toISOString();
  const credential = `ASIATWINWORLD${id.slice(0, 7).toUpperCase()}/${date.slice(0, 8)}/us-east-1/s3/aws4_request`;
  const securityToken = (await ctx.secret(`s3-session:${id}`)).replace(/[^A-Za-z0-9+/=]/g, '');
  const conditions = [['eq', '$acl', 'private'], ['eq', '$x-amz-meta-ext', ext], ['eq', '$x-amz-date', date], ['eq', '$x-amz-algorithm', 'AWS4-HMAC-SHA256'], ['eq', '$x-amz-credential', credential], ['eq', '$bucket', bucket], ['eq', '$key', id], ['eq', '$Content-Type', mimetype], ['eq', '$success_action_status', '201'], ['eq', '$x-amz-storage-class', 'STANDARD'], ['eq', '$x-amz-security-token', securityToken], ['content-length-range', 1, max]];
  const policy = btoa(JSON.stringify({ expiration, conditions }));
  const signature = ctx.crypto.hmac(await ctx.secret('s3-signing-key'), policy, 'hex');
  const websocket = `wss://k8s-lb.wss.redditmedia.com/${id}?m=${(await ctx.secret(`asset-socket:${id}`)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 52)}`;
  await ctx.write(ASSET, id, { asset_id: id, filepath, mimetype, bucket, key: id, ext, owner: caller.account, policy_expires: now + 900, max_bytes: max, _uploaded: false, created_utc: now }, 'asset.lease');
  // the lease, its fields in the order recorded on 2025-05-07
  return Response.json({
    args: {
      action: `//${bucketHost(bucket)}`,
      fields: [
        { name: 'x-amz-algorithm', value: 'AWS4-HMAC-SHA256' }, { name: 'key', value: id }, { name: 'x-amz-storage-class', value: 'STANDARD' },
        { name: 'success_action_status', value: '201' }, { name: 'bucket', value: bucket }, { name: 'acl', value: 'private' },
        { name: 'x-amz-signature', value: signature }, { name: 'x-amz-security-token', value: securityToken }, { name: 'x-amz-date', value: date },
        { name: 'x-amz-meta-ext', value: ext }, { name: 'policy', value: policy }, { name: 'x-amz-credential', value: credential },
        { name: 'Content-Type', value: mimetype },
      ],
    },
    asset: { asset_id: id, processing_state: 'incomplete', payload: { filepath }, websocket_url: websocket },
  });
}

// ── submit ──────────────────────────────────────────────────────────────────────────────────────

/** The uploaded file a submitted URL names: a lease of this account's whose file arrived, at the Location its upload
 *  answered (the bucket's host and the key). */
function assetAt(ctx: HandlerContext, url: string, owner: string): Row | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  const bucket = [MEDIA_BUCKET, VIDEO_BUCKET].find((b) => bucketHost(b) === u.hostname);
  if (!bucket) return undefined;
  const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const a = ctx.row(ASSET, key);
  return a && a.bucket === bucket && a.owner === owner ? a : undefined;
}

const validUrl = (url: string): boolean => { try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/** A body sent as rich text (richtext_json), as the body's Markdown: its paragraphs, each its text runs joined, every
 *  inline Markdown sign in a run escaped (a run is text as typed: its asterisks are asterisks, not emphasis); null where the
 *  JSON does not parse.
 *  source: spec:POST_api_submit "richtext_json"
 *  Where the documentation stops: dev/api names the parameter as JSON data; the document's shape (paragraphs of text runs)
 *  is the one reddit.com's editor sends, and the escaping is the twin's reading of a run as plain text. */
function bodyOfRichtext(json: string): string | null {
  let doc: unknown;
  try { doc = JSON.parse(json); } catch { return null; }
  const paras = (doc as { document?: Array<{ c?: Array<{ t?: string }> }> }).document ?? [];
  const plain = (t: string): string => t.replace(/([\\`*_~^[\]])/g, '\\$1');
  return paras.map((para) => (para.c ?? []).map((run) => plain(run.t ?? '')).join('')).join('\n\n');
}

export async function POST_api_submit(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  const truthy = (v: string | undefined): boolean => v === 'true' || v === 'True' || v === '1' || v === 'on';
  // source: spec:POST_api_submit "one of (link, self, image, video, videogif)"
  const kind = p.kind ?? '';
  if (!['link', 'self', 'image', 'video', 'videogif'].includes(kind)) return jsonAnswer([err('INVALID_OPTION', 'kind')]);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "you must specify a subreddit"
  if (!p.sr) return jsonAnswer([err('SUBREDDIT_REQUIRED', 'sr')]);
  const sr = subredditNamed(ctx, p.sr);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "SUBREDDIT_NOEXIST"
  if (!sr) return jsonAnswer([err('SUBREDDIT_NOEXIST', 'sr')]);
  const standing = membership(ctx, String(sr.id), caller.account);
  const ownProfile = sr._profile_of === caller.account;
  // a restricted or private community takes posts from its moderators alone (its approved users are not modelled); a
  // profile community from its own account
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "SUBREDDIT_NOTALLOWED"
  if ((sr.subreddit_type === 'restricted' || sr.subreddit_type === 'private' || sr.subreddit_type === 'user') && !standing.moderator && !ownProfile) return jsonAnswer([err('SUBREDDIT_NOTALLOWED', 'sr')]);
  const isSelf = kind === 'self';
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "NO_SELFS"
  if (isSelf && sr.submission_type === 'link') return jsonAnswer([err('NO_SELFS', 'sr')]);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "NO_LINKS"
  if (!isSelf && sr.submission_type === 'self') return jsonAnswer([err('NO_LINKS', 'sr')]);
  const title = (p.title ?? '').replace(/\s+/gu, ' ').trim();
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "we need something here"
  if (!title) return jsonAnswer([err('NO_TEXT', 'title')]);
  // source: spec:POST_api_submit "title of the submission. up to 300 characters long"
  if (title.length > 300) return jsonAnswer([err('TOO_LONG', 'title', 'this is too long (max: 300)')]);
  // source: spec:POST_api_submit "An error is thrown if both text and richtext_json are present."
  // Where the documentation stops: the page names no error for it; the twin answers Reddit's error for an option it does not take
  if (p.text && p.richtext_json) return jsonAnswer([err('INVALID_OPTION', 'richtext_json')]);
  const rich = !p.text && p.richtext_json ? bodyOfRichtext(p.richtext_json) : undefined;
  if (rich === null) return jsonAnswer([err('JSON_PARSE_ERROR', 'richtext_json', 'unable to parse JSON data')]);
  const text = p.text ?? rich ?? '';
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/models/link.py "SELFTEXT_MAX_LENGTH = 40000"
  if (text.length > 40000) return jsonAnswer([err('TOO_LONG', 'text', 'this is too long (max: 40000)')]);
  const url = (p.url ?? '').trim();
  const now = nowSeconds(ctx);
  const id = ctx.mint(LINK);
  const permalink = `/r/${String(sr.display_name)}/comments/${id}/${slugOf(title)}/`;
  const base: Row = {
    id, name: `t3_${id}`, title, author: caller.name, author_fullname: `t2_${caller.account}`, subreddit: sr.display_name, subreddit_id: `t5_${String(sr.id)}`,
    created_utc: now, permalink, selftext: text, selftext_html: text ? redditHtml(text) : null, over_18: truthy(p.nsfw), spoiler: truthy(p.spoiler),
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "sendreplies = is_self"
    send_replies: p.sendreplies === undefined ? isSelf : truthy(p.sendreplies),
    link_flair_text: p.flair_text ? p.flair_text.slice(0, 64) : null, removed_by_category: null, is_self: isSelf, is_video: false,
  };
  let media: Row = {};
  let answer: Row;
  if (isSelf) {
    media = { url: `https://www.reddit.com${permalink}`, domain: `self.${String(sr.display_name)}`, thumbnail: 'self', is_reddit_media_domain: false };
    answer = { url: `https://www.reddit.com${permalink}`, drafts_count: 0, id, name: `t3_${id}` };
  } else if (kind === 'link') {
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "a url is required"
    if (!url) return jsonAnswer([err('NO_URL', 'url')]);
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "you should check that url"
    if (!validUrl(url)) return jsonAnswer([err('BAD_URL', 'url')]);
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "If a link with the same URL has already been submitted to the specified"
    if (!truthy(p.resubmit) && ctx.rowsRaw(LINK).some((l) => l.subreddit_id === base.subreddit_id && l.url === url && l.removed_by_category !== 'deleted')) return jsonAnswer([err('ALREADY_SUB', 'url')]);
    media = { url, domain: new URL(url).hostname.replace(/^www\./, ''), thumbnail: 'default', post_hint: 'link', is_reddit_media_domain: false, url_overridden_by_dest: url };
    answer = { url: `https://www.reddit.com${permalink}`, drafts_count: 0, id, name: `t3_${id}` };
  } else {
    if (!url) return jsonAnswer([err('NO_URL', 'url')]);
    const asset = assetAt(ctx, url, caller.account);
    const wanted = kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES;
    // a submitted media url is one of this account's uploads, of the kind posted, whose file arrived
    if (!asset || !(String(asset.mimetype) in wanted)) return jsonAnswer([err('BAD_URL', 'url')]);
    const refused = asset._uploaded === true ? undefined : ctx.legal(ASSET, '_uploaded', 'POST_api_submit', asset._uploaded, undefined, String(asset.asset_id));
    if (refused) return jsonAnswer([err(String(refused.code ?? 'BAD_URL'), 'url', refused.message)]);
    if (kind === 'image') {
      const file = `${String(asset.asset_id)}.${String(asset.ext)}`;
      const w = Number(asset.width ?? 0);
      const h = Number(asset.height ?? 0);
      media = {
        url: `https://i.redd.it/${file}`, url_overridden_by_dest: `https://i.redd.it/${file}`, domain: 'i.redd.it', post_hint: 'image', is_reddit_media_domain: true,
        thumbnail: `https://b.thumbs.redditmedia.com/${file}`, thumbnail_width: 140, thumbnail_height: w ? Math.round((140 * h) / w) : 140,
        ...(w && h ? { preview: await previewOf(ctx, 'preview.redd.it', file, w, h, 'auto=webp') } : {}),
      };
    } else {
      // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/praw/models/reddit/subreddit/subreddit.py "if we're uploading without a thumbnail, use the PRAW logo"
      // Where the documentation stops: a video post may carry its poster (video_poster_url), one of the account's uploads;
      // PRAW sends its own logo when a script names none, and Reddit draws a video's thumbnail itself once it has
      // transcoded it, which the twin does not do: a video posted without a poster has no thumbnail and no preview
      const posterUrl = (p.video_poster_url ?? '').trim();
      const poster = posterUrl ? assetAt(ctx, posterUrl, caller.account) : undefined;
      if (posterUrl && (!poster || !(String(poster.mimetype) in IMAGE_TYPES) || poster._uploaded !== true)) return jsonAnswer([err('BAD_URL', 'video_poster_url')]);
      const vid = String(asset.asset_id);
      const height = renditionHeight(Number(asset.height ?? 0));
      const seconds = Number(asset.duration ?? 0);
      const posterFile = poster ? `${String(poster.asset_id)}.${String(poster.ext)}` : undefined;
      const pw = Number(poster?.width ?? 0);
      const ph = Number(poster?.height ?? 0);
      // the post's hosted video (recorded 2020-12-03: bitrate_kbps, fallback_url, height, width, scrubber_media_url,
      // dash_url, duration, hls_url, is_gif, transcoding_status)
      // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_video.json "transcoding_status"
      const video = {
        // the file's own rate: its bytes over its seconds (the twin transcodes nothing)
        bitrate_kbps: seconds ? Math.round((Number(asset.size ?? 0) * 8) / seconds / 1000) : 0,
        fallback_url: `https://v.redd.it/${vid}/DASH_${height}.mp4?source=fallback`, height: Number(asset.height ?? 0), width: Number(asset.width ?? 0),
        scrubber_media_url: `https://v.redd.it/${vid}/DASH_96.mp4`, dash_url: `https://v.redd.it/${vid}/DASHPlaylist.mpd`, duration: seconds,
        hls_url: `https://v.redd.it/${vid}/HLSPlaylist.m3u8`, is_gif: kind === 'videogif', transcoding_status: 'completed',
      };
      media = {
        url: `https://v.redd.it/${vid}`, url_overridden_by_dest: `https://v.redd.it/${vid}`, domain: 'v.redd.it', post_hint: 'hosted:video', is_reddit_media_domain: true,
        is_video: true, media: { reddit_video: video },
        ...(poster && posterFile ? {
          thumbnail: `https://b.thumbs.redditmedia.com/${posterFile}`, thumbnail_width: 140, thumbnail_height: pw ? Math.round((140 * ph) / pw) : 140, _poster: poster.asset_id,
          ...(pw && ph ? { preview: await previewOf(ctx, 'external-preview.redd.it', posterFile, pw, ph, 'format=pjpg&auto=webp') } : {}),
        } : { thumbnail: 'default' }),
      };
    }
    media._asset = asset.asset_id;
    // an image or video answers no id: the submitter's page and the media's websocket (recorded on 2025-05-07)
    // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json "user_submitted_page"
    answer = { user_submitted_page: `https://www.reddit.com/user/${caller.name}/submitted/`, websocket_url: `wss://k8s-lb.wss.redditmedia.com:443/${String(asset.asset_id)}?m=${(await ctx.secret(`asset-socket:${String(asset.asset_id)}`)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 52)}` };
  }
  await ctx.write(LINK, id, { ...base, ...media }, 'link.create');
  // the author's own vote, as Reddit records it on a new post (recorded: likes true, score 1 on a fresh post)
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit__url.json "likes"
  await ctx.write(VOTE, `${caller.account}:t3_${id}`, { voter: caller.account, thing: `t3_${id}`, dir: 1 }, 'vote.cast');
  return jsonAnswer([], answer);
}

// ── comment ─────────────────────────────────────────────────────────────────────────────────────

export async function POST_api_comment(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  // a comment needs the submit scope whatever dev/api's badge says (r2: "requires `submit` scope", abort(403, 'forbidden'))
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "the fullname of a Link: a top-level comment in that Link's thread. (requires `submit` scope)"
  if (!hasScope(caller, 'submit')) return httpError(403);
  const p = paramsOf(ctx);
  const parentName = p.thing_id ?? p.parent ?? '';
  const [prefix, parentId] = [parentName.slice(0, 3), parentName.slice(3)];
  const parent = prefix === 't3_' ? ctx.row(LINK, parentId) : prefix === 't1_' ? ctx.row(COMMENT, parentId) : undefined;
  // a parent that is not there, or not a link or comment, is 403 (r2's VSubmitParent: abort(403, "forbidden"))
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/validator/validator.py "abort(403, \"forbidden\")"
  if (!parent) return httpError(403);
  const link = prefix === 't3_' ? parent : ctx.row(LINK, String(parent.link_id).replace(/^t3_/, ''));
  if (!link || link.removed_by_category === 'deleted') return httpError(403);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "that comment has been deleted"
  if (prefix === 't1_' && parent._deleted === true) return jsonAnswer([err('DELETED_COMMENT', 'parent')]);
  const body = p.text ?? p.comment ?? '';
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "we need something here"
  if (!body.trim()) return jsonAnswer([err('NO_TEXT', 'text')]);
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "comment=VMarkdownLength(['text', 'comment'], max_length=10000)"
  if (body.length > 10000) return jsonAnswer([err('TOO_LONG', 'text', 'this is too long (max: 10000)')]);
  const id = ctx.mint(COMMENT);
  const now = nowSeconds(ctx);
  const row: Row = {
    id, name: `t1_${id}`, body, body_html: redditHtml(body), author: caller.name, author_fullname: `t2_${caller.account}`, link_id: link.name, parent_id: parentName,
    subreddit: link.subreddit, subreddit_id: link.subreddit_id, created_utc: now, permalink: `${String(link.permalink)}${id}/`,
  };
  await ctx.write(COMMENT, id, row, 'comment.create');
  await ctx.write(VOTE, `${caller.account}:t1_${id}`, { voter: caller.account, thing: `t1_${id}`, dir: 1 }, 'vote.cast');
  const depth = prefix === 't1_' ? depthOf(ctx, parent) + 1 : 0;
  return jsonAnswer([], { things: [{ kind: 't1', data: commentView(ctx, row, caller.account, depth) }] });
}

/** How deep a comment sits: the count of comments above it. */
function depthOf(ctx: HandlerContext, c: Row): number {
  let depth = 0;
  let at = c;
  while (String(at.parent_id).startsWith('t1_')) {
    const up = ctx.row(COMMENT, String(at.parent_id).slice(3));
    if (!up) break;
    depth += 1;
    at = up;
  }
  return depth;
}

// ── vote ────────────────────────────────────────────────────────────────────────────────────────

export async function POST_api_vote(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  // source: spec:POST_api_vote "vote direction. one of (1, 0, -1)"
  const dir = Number(p.dir);
  // Where the documentation stops: the page names no refusal for another direction; the twin answers Reddit's 400
  if (![1, 0, -1].includes(dir) || p.dir === undefined || p.dir === '') return httpError(400);
  const thing = p.id ?? '';
  const target = thing.startsWith('t3_') ? ctx.row(LINK, thing.slice(3)) : thing.startsWith('t1_') ? ctx.row(COMMENT, thing.slice(3)) : undefined;
  if (!target) return httpError(400);
  await ctx.write(VOTE, `${caller.account}:${thing}`, { voter: caller.account, thing, dir }, dir === 0 ? 'vote.clear' : 'vote.cast');
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubmission.test_upvote.json "api/vote"
  return Response.json({});
}

// ── delete ──────────────────────────────────────────────────────────────────────────────────────

export async function POST_api_del(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  const thing = p.id ?? '';
  // only the author's own thing is deleted; anything else is answered as one deleted, and nothing changes (r2's POST_del
  // takes the thing through VByNameIfAuthor, and returns at once when it names none)
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "thing = VByNameIfAuthor('id'))"
  if (thing.startsWith('t3_')) {
    const link = ctx.row(LINK, thing.slice(3));
    // a post already deleted is left as it is: deleting it again moves nothing
    const live = link && link.author === caller.name && link.removed_by_category !== 'deleted' ? link : undefined;
    if (live && !ctx.legal(LINK, 'removed_by_category', 'POST_api_del', live.removed_by_category, 'deleted', String(live.id))) await ctx.write(LINK, String(live.id), { removed_by_category: 'deleted', send_replies: false }, 'link.delete');
  } else if (thing.startsWith('t1_')) {
    const c = ctx.row(COMMENT, thing.slice(3));
    if (c && c.author === caller.name && c._deleted !== true) await ctx.write(COMMENT, String(c.id), { _deleted: true, body: '[deleted]', body_html: redditHtml('[deleted]'), author: '[deleted]' }, 'comment.delete');
  }
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubmission.test_delete.json "api/del"
  return Response.json({});
}

// ── a moderator's removal ───────────────────────────────────────────────────────────────────────

// source: spec:POST_api_remove "Remove a link, comment, or modmail message."
export async function POST_api_remove(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const thing = paramsOf(ctx).id ?? '';
  const link = thing.startsWith('t3_') ? ctx.row(LINK, thing.slice(3)) : undefined;
  const comment = thing.startsWith('t1_') ? ctx.row(COMMENT, thing.slice(3)) : undefined;
  const srId = String((link ?? comment)?.subreddit_id ?? '').replace(/^t5_/, '');
  // only a moderator of the thing's community removes it; anyone else, or a thing Reddit does not have, is forbidden
  // (Where the twin stops: a modmail message is not modelled, no demanded client has one)
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "VSrCanBan('id')"
  if (!(link ?? comment) || !membership(ctx, srId, caller.account).moderator) return httpError(403);
  // a deleted thing is left as it is, and a removed one is not removed again
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/api.py "if thing._deleted:"
  if (link && link.removed_by_category !== 'deleted' && link.removed_by_category !== 'moderator') {
    if (!ctx.legal(LINK, 'removed_by_category', 'POST_api_remove', link.removed_by_category, 'removed', String(link.id))) await ctx.write(LINK, String(link.id), { removed_by_category: 'moderator' }, 'link.remove');
  } else if (comment && comment._deleted !== true && comment._removed !== true) {
    await ctx.write(COMMENT, String(comment.id), { _removed: true, body: '[removed]', body_html: redditHtml('[removed]') }, 'comment.remove');
  }
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubmissionModeration.test_remove.json "api/remove"
  return Response.json({});
}

// ── subscribe ───────────────────────────────────────────────────────────────────────────────────

export async function POST_api_subscribe(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  // source: spec:POST_api_subscribe "one of (sub, unsub)"
  if (!['sub', 'unsub'].includes(p.action ?? '')) return httpError(400);
  const names = (p.sr_name ?? '').split(',').filter(Boolean);
  const fullnames = (p.sr ?? '').split(',').filter(Boolean);
  const targets = [...names.map((n) => subredditNamed(ctx, n)), ...fullnames.map((f) => ctx.row(SUBREDDIT, f.replace(/^t5_/, '')))];
  if (!targets.length || targets.some((t) => !t)) return httpError(404);
  for (const sr of targets as Row[]) {
    const key = `${String(sr.id)}:${caller.account}`;
    const held = ctx.row(MEMBERSHIP, key);
    await ctx.write(MEMBERSHIP, key, { subreddit: sr.id, user: caller.account, moderator: held?.moderator === true, subscriber: p.action === 'sub' }, p.action === 'sub' ? 'membership.subscribe' : 'membership.unsubscribe');
  }
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_subscribe.json "api/subscribe"
  return Response.json({});
}

// ── a community ─────────────────────────────────────────────────────────────────────────────────

export async function POST_api_site_admin(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx)!;
  const p = paramsOf(ctx);
  const editing = p.sr ? ctx.row(SUBREDDIT, p.sr.replace(/^t5_/, '')) : undefined;
  if (p.sr && (!editing || !membership(ctx, String(editing.id), caller.account).moderator)) return httpError(403);
  const name = p.name ?? '';
  // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/errors.py "BAD_SR_NAME"
  if (!editing && !/^[A-Za-z0-9][A-Za-z0-9_]{2,20}$/.test(name)) return jsonAnswer([err('BAD_SR_NAME', 'name')]);
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_create__exists.json "that subreddit already exists"
  if (!editing && subredditNamed(ctx, name)) return jsonAnswer([err('SUBREDDIT_EXISTS', 'name')]);
  const title = (p.title ?? '').trim();
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_create__missing_parameter.json "we need something here"
  if (!title) return jsonAnswer([err('NO_TEXT', 'title')]);
  // source: spec:POST_api_site_admin "a string no longer than 100 characters"
  if (title.length > 100) return jsonAnswer([err('TOO_LONG', 'title', 'this is too long (max: 100)')]);
  // source: spec:POST_api_site_admin "one of (gold_restricted, archived, restricted, private, employees_only, gold_only, public, user)"
  const type = p.type ?? 'public';
  if (!['gold_restricted', 'archived', 'restricted', 'private', 'employees_only', 'gold_only', 'public', 'user'].includes(type)) return jsonAnswer([err('INVALID_OPTION', 'type')]);
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_create__invalid_parameter.json "that option is not valid"
  const linkType = p.link_type ?? 'any';
  if (!['any', 'link', 'self'].includes(linkType)) return jsonAnswer([err('INVALID_OPTION', 'link_type')]);
  const fields: Row = {
    display_name: editing ? editing.display_name : name, title, subreddit_type: type, submission_type: linkType,
    public_description: p.public_description ?? '', description: p.description ?? '', submit_text: p.submit_text ?? '', header_title: p.header_title ?? '',
    lang: p.lang ?? 'en', over18: p.over_18 === 'true', allow_images: p.allow_images !== 'false', allow_videos: p.allow_videos !== 'false',
    wiki_enabled: p.wikimode !== undefined && p.wikimode !== 'disabled',
  };
  if (editing) {
    await ctx.write(SUBREDDIT, String(editing.id), fields, 'subreddit.update');
    return jsonAnswer([]);
  }
  const id = ctx.mint(SUBREDDIT);
  await ctx.write(SUBREDDIT, id, { id, ...fields, created_utc: nowSeconds(ctx) }, 'subreddit.create');
  // its maker moderates it and is subscribed to it (recorded: user_is_moderator and user_is_subscriber true, subscribers 1)
  // source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_create.json "user_is_moderator"
  await ctx.write(MEMBERSHIP, `${id}:${caller.account}`, { subreddit: id, user: caller.account, moderator: true, subscriber: true }, 'membership.create');
  return jsonAnswer([]);
}
