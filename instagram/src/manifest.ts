// instagram's manifest: the vendor facts its spec (../spec/openapi.json, written from Meta's Instagram Platform pages)
// does not carry. Served is what a game studio's tooling calls through the Instagram API with Instagram Login
// (../journeys/demand.json, ../journeys/decisions.json): the authorization window and its tokens, the professional
// account, a Reel's and an image's containers and their publishing, the media, their insights and comments, and the
// community side of comments. Every operation of the spec has a handler; the documented variants no demand reaches
// (carousels, stories, resumable uploads, tags and partnership labels, the other insights metrics) are `variants`.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'instagram',
  service: 'instagram',
  // a Graph API call takes its parameters in the query string, a form or a JSON body (the pages show each)
  body: {},
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "17918920912340654"
  ids: { template: '{digits:17}' },
  time: 'iso',
  // the version a path may carry before the node (`/v26.0/me`), taken off before routing
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media "The API version your app is using. If not specified in your API calls this will be the latest version at the time you created your Meta app"
  pathPrefix: '^/v\\d+\\.\\d+(?=/)',
  // source: https://developers.facebook.com/docs/graph-api/guides/error-handling "The following represents a common error response resulting from a failed API request:"
  error: { error: { message: '{message}', type: '{kind}', code: '{code}' } },
  errorOmitsAbsent: true,
  defaultKind: 'OAuthException',
  readOnly: { status: 403, code: 10, message: 'This twin was started read-only; writes are refused.' },
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes "The media with {media-id} cannot be found"
  notFound: { status: 400, code: 24, message: 'The media with {id} cannot be found' },
  // an operation or variant the twin does not serve: the Graph API's unknown error ("check that you are requesting an
  // existing API"), which is also what a breakdown a metric does not take answers
  // source: https://developers.facebook.com/docs/graph-api/guides/error-handling "Possibly a temporary issue due to downtime. Wait and retry the operation. If it occurs again, check that you are requesting an existing API."
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "An unknown error has occurred."
  gap: { status: 400, code: 1, message: 'An unknown error has occurred.' },
  deleted: { success: true },
  resources: {
    // an IG Container, as its fields answer it, with what the twin keeps beside it (its account, the URL Instagram
    // fetched, the file's digest); read back by its ID, as Instagram lists no account's containers
    container: { idPrefix: '', ...states.container, refresh: { get: 'getNode', known: true, query: { fields: 'id,status_code,status' } } },
    // an IG Media, as its fields answer it: the account's own media, listed newest first by the after cursor, whose last
    // page is the empty one that names no cursor
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Returns a maximum of 10K of the most recently created media."
    media: { idPrefix: '', ...states.media, refresh: { list: 'getUserMedia', items: 'data', next: 'paging.cursors.after', cursor: 'after', complete: false, params: { 'ig-user-id': 'me' }, query: { fields: 'id,caption,media_type,media_product_type,media_url,permalink,shortcode,thumbnail_url,timestamp,username,like_count,comments_count,is_comment_enabled,is_shared_to_feed' } } },
    // an IG Comment on a media; a reply names its top-level comment in parent_id, and goes with it when it is deleted.
    // Listed under its media, top-level comments only (replies ride in each one's replies field), so the list is not the
    // whole type
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments "Returns only top-level comments."
    comment: { idPrefix: '', parent: { param: 'ig-media-id', field: '_media', resource: 'media' }, cascade: [{ resource: 'comment', field: 'parent_id' }], refresh: { list: 'getMediaComments', items: 'data', next: 'paging.cursors.after', cursor: 'after', complete: false, query: { fields: 'id,text,timestamp,hidden,like_count,from,username,replies{id,text,timestamp,hidden,from,username,parent_id}' } } },
    _app: { idPrefix: '', ids: '{digits:15}' },
    _credential_serial: { idPrefix: '', ids: '{n}' },
    _account: { unique: [{ fields: ['username'], refusal: { status: 409, message: 'that username is taken' } }], idPrefix: '', ids: '{digits:17}' },
    _code: { idPrefix: 'code_', ids: '{prefix}{n}' },
    _token: { idPrefix: 'token_', ids: '{prefix}{n}' },
    _session: { idPrefix: 'session_', ids: '{prefix}{n}' },
  },
  variants: {
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media "Required for carousels, stories, and reels."
    createUserMedia: ['media_type=CAROUSEL', 'media_type=STORIES', 'media_type=VIDEO', 'is_carousel_item', 'children', 'upload_type', 'user_tags', 'product_tags', 'collaborators', 'location_id', 'trial_params', 'audio_name', 'branded_content_sponsor_ids', 'is_paid_partnership', 'poll_attachment', 'is_poll_duration_extended', 'is_comment_prompt_used'],
    // source: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights "Designates how to break down results into subsets ."
    getMediaInsights: ['breakdown', 'metric~=follows', 'metric~=profile_activity', 'metric~=profile_visits', 'metric~=ig_reels_avg_watch_time', 'metric~=ig_reels_video_view_total_time', 'metric~=reels_skip_rate', 'metric~=navigation', 'metric~=replies', 'metric~=link_clicks', 'metric~=impressions', 'metric~=reposts', 'metric~=crossposted_views', 'metric~=facebook_views'],
    // source: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container "Used to determine if an uploaded video is violating copyright."
    getNode: ['fields~=copyright_check_status'],
  },
  // source: https://developers.facebook.com/docs/graph-api/overview/rate-limiting "Calls within 24 hours = 4800 * Number of Impressions"
  rateBudget: { reason: 'The Instagram Platform counts calls per app and app user over a rolling 24 hours, 4800 times the account’s impressions: no fixed allowance is documented, so the fallback, 30 calls a minute.', windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60 },
  screens: [
    {
      id: 'authorize', kind: 'flow', host: 'www.instagram.com', hosts: ['api.instagram.com'], path: '/oauth/authorize',
      demand: 'a studio or a creator connects an Instagram professional account: the app sends the person here with its Instagram App ID, redirect URI, scope and state',
      status: 'done', controls: ['Log in', 'Allow', 'Cancel'],
      source: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login',
    },
    {
      id: 'cdn', kind: 'content', host: 'scontent.cdninstagram.com', path: '/', status: 'done',
      demand: "every media_url, thumbnail_url and profile_picture_url the API answers loads the file from Instagram's CDN",
      source: 'https://developers.facebook.com/documentation/instagram-platform/overview',
    },
  ],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "{ account?, deployment?, redirect_uris? }: the App Dashboard: a deployment application and long-lived grant from the first member's professional account" },
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: "{ username, password, name?, account_type? (Business, Media_Creator, Personal), biography?, website?, followers_count?, follows_count? }: an Instagram account, as instagram.com's sign-up makes it", redactBody: ['password'] },
    { id: 'audience', method: 'POST', path: '/_twin/media/{id}/audience', note: "{ views?, reach?, likes?, saved?, shares?, comment?: { username, text, parent_id? } }: the audience at work on a media (each count added), and a comment by a person in the Instagram app, which no API call makes" },
  ],
  discovery: {
    twinOf: "Instagram's API with Instagram Login: Business Login's authorization window and tokens, a professional account, publishing a Reel or an image through a container, its media, their insights and comments",
    stores: "the App Dashboard's app, Instagram accounts, codes and tokens (by their SHA-256), containers, media (their fetched files as blobs) and comments",
    identity: 'an Instagram User access token in the access_token parameter, or Authorization: Bearer',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-instagram',
    resources: ['container', 'media', 'comment'],
    specSource: "written from Meta's Instagram Platform documentation on developers.facebook.com (spec/openapi.json, provenance in spec/SOURCE.md)",
    description: "Instagram twin — the Instagram API with Instagram Login: Business Login's authorization window and tokens, the professional account, Reels and images published through containers, media, insights, and comment moderation.",
    adoption: { sdks: [], envStems: ['INSTAGRAM'] },
    clientCasesNone: 'Meta publishes no Node SDK for the Instagram API with Instagram Login; the demand calls it with fetch.',
    hosts: [{ host: 'graph.instagram.com' }, { host: 'api.instagram.com' }, { host: 'www.instagram.com', pathPattern: '^/oauth/authorize' }, { host: 'scontent.cdninstagram.com' }],
    endpointEnvNone: 'an app calls graph.instagram.com and api.instagram.com and sends people to www.instagram.com; the World claims the hosts',
    // the vendor-backed root's credential: the studio's long-lived Instagram User access token, in the access_token
    // parameter. Where the kernel stops: its token exchange posts, and Instagram refreshes a long-lived token by GET
    // (refresh_access_token), so a root's token is sealed as it is and renewed by its owner
    // source: https://developers.facebook.com/documentation/instagram-platform/reference/me "&access_token={access-token}"
    auth: { in: 'query', name: 'access_token' },
    credentialDoor: { account: { field: 'account', tenancy: 'Meta developer/professional account', source: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started' }, deployment: { field: 'deployment', object: 'developer app with professional-account grant', source: 'https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login', organizationOutputs: ['INSTAGRAM_USER_ID'] }, path: '/_twin/app-credentials', body: {}, fill: { INSTAGRAM_APP_ID: 'app_id', INSTAGRAM_APP_SECRET: 'app_secret', INSTAGRAM_ACCESS_TOKEN: 'access_token', INSTAGRAM_USER_ID: 'user_id' } },
  },
};
