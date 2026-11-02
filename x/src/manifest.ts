// X's manifest: the vendor facts its published spec does not carry (docs/contributing/architecture.md, "Protocol 3").
// The surface is generated (./generated/surface.gen.json, from ../spec by derive): X's own OpenAPI 3.0.0 document
// "X API v2" version 2.168 (https://api.x.com/2/openapi.json, 195 operations under https://api.x.com), corrected by
// ../spec/patches.json to the names the wire carries (tweet.fields, referenced_tweets, edit_history_tweet_ids,
// pinned_tweet_id), with X's OAuth endpoints the document leaves out patched in from X's authentication pages: the
// OAuth 2.0 token and revoke endpoints and the OAuth 1.0a request_token, access_token and invalidate_token legs
// (provenance in ../spec/SOURCE.md). One vendor, one document, one store: the authorization server that issues a
// credential and the API that honours it are this one pack.
//
// EVERY SERVED OPERATION IS A HANDLER (./semantics/index.ts). An OAuth leg is a credential exchange, not a stored body;
// and X's operations carry more than CRUD can say: one route (POST /2/tweets) is an original post, a reply or a quote
// by a field of its body; every read answers X's three default fields unless `tweet.fields` asks for more, with
// related objects in an `includes` sidecar; a lookup of an id nobody posted is a partial 200; media is uploaded in
// chunks and processed. So the derived core owns none, and the operations no handler serves are the gap (X's 404
// problem), listed in `unmodeled`.
//
// THE SCREENS are X's hosted flows and pages: x.com's OAuth 2.0 authorize screen and api.x.com's OAuth 1.0a authorize
// and authenticate screens, each posting its decision back to the pack (the OAuth 1.0a screen to POST oauth/authorize
// on its own host, as X's own screen does; the OAuth 2.0 screen to POST /i/oauth2/authorize, standing in for the
// undocumented internal endpoint x.com's form posts to); x.com's sign-in (`login`) and home, where a signed-in person
// reads the timeline and posts with the composer, its media uploaded in chunks (`home`); x.com's public post and profile
// pages (the `web` screen); and X's content hosts, where uploaded media and the default avatar are served from (the
// `media` screen).
//
// THE STATE: `oauth_client` (an OAuth 2.0 App), `oauth1_app` (an OAuth 1.0a App), `account` (an X user, in X's own
// field names), `auth_request` (an authorize screen in flight), `post` (a Post,
// with the media it carries by digest), `follow` (who follows whom), `rate_limit` (an armed 15-minute-window refusal),
// and `_oauth1_token` (an OAuth 1.0a access token, with its secret, which the signature is checked against). A
// CREDENTIAL IS BOOKKEEPING, kept by its SHA-256 under a `_` type (never deployed, never in a changeset):
// `_authorization_code`, `_access_token`, `_refresh_token`, `_oauth1_request_token`, an OAuth 2.0 App's
// `_client_secret`; so are a grant (`_grant`, `_oauth1_grant`), a user's GET /2/users/me window (`_rate_window`) and an
// upload session (`upload`). Media bytes are the context's blobs, content-addressed.
//
// A VENDOR-BACKED ROOT signs or renews its own calls: `descriptor.auth` is the kernel's choice between an OAuth 1.0a
// user-context signature (a root holding a consumer key) and the exchange over X's refresh-token grant.
//
// WHY NO MANIFEST `auth`. The core's `auth` reads one header with one scheme. The /2 surface takes an OAuth 2.0 bearer
// or an OAuth 1.0a user-context signature, resolved to the account it acts for before dispatch (./semantics/around.ts,
// as X answers a missing or unknown credential 401 on every /2 path), and each handler asks for the operation's scopes
// (./semantics/shared.ts `opening`); the OAuth 2.0 legs take HTTP Basic or a body client_id, the OAuth 1.0a legs a
// consumer signature, each resolved by its handler.
import type { DerivedManifest } from '@volter/world-core';
import { X_ABS_PATHS, X_PBS_PATHS, X_VIDEO_PATHS, X_WEB_PATHS } from './semantics/shared.ts';
import { states } from './semantics/states.ts';

const CODE_FLOW = 'https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token';
const AUTHORIZATION_CODE = 'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code';
const OAUTH1_REFERENCE = 'https://docs.x.com/fundamentals/authentication/api-reference';
const OAUTH1_THREE_LEGGED = 'https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens';

// ── the documented values the twin holds no state for ──────────────────────────────────────────────────────────
// Each is X's own (the spec's enum or closed schema, spec/openapi.json.gz after spec/patches.json, which names the Post
// fields `tweet.fields` beside the document's `post.fields`) and stands for state no handler keeps: a post's place,
// entities, language or private metrics, a user's banner or affiliation, an Amplify video's title. A request asking one
// is answered the gap before the handler runs, never a body silently without it: a caller that asked for `geo` and got
// a post without it cannot tell "this twin does not model places" from "this post has none". So a value of one of these
// parameters that a handler sees is either one it shapes or one X does not document (./semantics/shared.ts). Each list
// entry `name~=value` is one entry of the comma-separated list the parameter carries.

/** A Post's fields no read shapes, under either of X's names. The fields a read shapes are ./semantics/shared.ts
 *  TWEET_FIELDS_MODELLED: attachments, author_id, conversation_id, created_at, edit_history_tweet_ids, id,
 *  in_reply_to_user_id, paid_partnership, public_metrics, referenced_tweets, text. */
// source: spec:/components/parameters/PostFieldsParameter "A comma separated list of Post fields to display."
const POST_FIELDS_UNSHAPED = [
  'tweet.fields~=article', 'tweet.fields~=article_title', 'tweet.fields~=card_uri', 'tweet.fields~=community_id',
  'tweet.fields~=context_annotations', 'tweet.fields~=display_text_range', 'tweet.fields~=edit_controls',
  'tweet.fields~=entities', 'tweet.fields~=geo', 'tweet.fields~=lang', 'tweet.fields~=matched_media_notes',
  'tweet.fields~=media_metadata', 'tweet.fields~=non_public_metrics', 'tweet.fields~=note_request_suggestions',
  'tweet.fields~=note_tweet', 'tweet.fields~=organic_metrics', 'tweet.fields~=possibly_sensitive',
  'tweet.fields~=promoted_metrics', 'tweet.fields~=reply_settings', 'tweet.fields~=scopes', 'tweet.fields~=source',
  'tweet.fields~=suggested_source_links', 'tweet.fields~=suggested_source_links_with_counts',
  'tweet.fields~=withheld', 'post.fields~=article', 'post.fields~=article_title', 'post.fields~=card_uri',
  'post.fields~=community_id', 'post.fields~=context_annotations', 'post.fields~=display_text_range',
  'post.fields~=edit_controls', 'post.fields~=entities', 'post.fields~=geo', 'post.fields~=lang',
  'post.fields~=matched_media_notes', 'post.fields~=media_metadata', 'post.fields~=non_public_metrics',
  'post.fields~=note_request_suggestions', 'post.fields~=note_tweet', 'post.fields~=organic_metrics',
  'post.fields~=possibly_sensitive', 'post.fields~=promoted_metrics', 'post.fields~=reply_settings',
  'post.fields~=scopes', 'post.fields~=source', 'post.fields~=suggested_source_links',
  'post.fields~=suggested_source_links_with_counts', 'post.fields~=withheld',
];
/** The fields a post read shapes (above), unshaped where the answer holds no post, as a user read's does. */
const POST_FIELDS_SHAPED = [
  'tweet.fields~=attachments', 'tweet.fields~=author_id', 'tweet.fields~=conversation_id', 'tweet.fields~=created_at',
  'tweet.fields~=edit_history_tweet_ids', 'tweet.fields~=id', 'tweet.fields~=in_reply_to_user_id',
  'tweet.fields~=paid_partnership', 'tweet.fields~=public_metrics', 'tweet.fields~=referenced_tweets',
  'tweet.fields~=text', 'post.fields~=attachments', 'post.fields~=author_id', 'post.fields~=conversation_id',
  'post.fields~=created_at', 'post.fields~=edit_history_tweet_ids', 'post.fields~=id',
  'post.fields~=in_reply_to_user_id', 'post.fields~=paid_partnership', 'post.fields~=public_metrics',
  'post.fields~=referenced_tweets', 'post.fields~=text',
];
/** A Post's expansions no read fills (./semantics/shared.ts EXPANSIONS_MODELLED holds the ones it does). */
// source: spec:/components/parameters/PostExpansionsParameter "A comma separated list of fields to expand."
const POST_EXPANSIONS_UNFILLED = [
  'expansions~=article.cover_media', 'expansions~=article.media_entities',
  'expansions~=attachments.media_source_tweet', 'expansions~=edit_history_post_ids',
  'expansions~=edit_history_tweet_ids', 'expansions~=entities.mentions.username',
  'expansions~=entities.note.mentions.username', 'expansions~=geo.place_id', 'expansions~=referenced_posts',
  'expansions~=referenced_tweets.id.attachments.media_keys', 'expansions~=username',
];
/** A User's fields no read shapes (./semantics/shared.ts USER_FIELDS_MODELLED holds the ones it does). */
// source: spec:/components/parameters/UserFieldsParameter "A comma separated list of User fields to display."
const USER_FIELDS_UNSHAPED = [
  'user.fields~=affiliation', 'user.fields~=connection_status', 'user.fields~=entities',
  'user.fields~=is_identity_verified', 'user.fields~=most_recent_tweet_id', 'user.fields~=parody',
  'user.fields~=pinned_tweet_id', 'user.fields~=profile_banner_url', 'user.fields~=public_metrics',
  'user.fields~=receives_your_dm', 'user.fields~=subscriber_count', 'user.fields~=subscribes_to_you',
  'user.fields~=subscription', 'user.fields~=subscription_type', 'user.fields~=verified_followers_count',
  'user.fields~=withheld',
];
/** A User's expansions: none is filled. */
// source: spec:/components/parameters/UserExpansionsParameter "A comma separated list of fields to expand."
const USER_EXPANSIONS = [
  'expansions~=affiliation', 'expansions~=most_recent_post_id', 'expansions~=most_recent_tweet_id',
  'expansions~=pinned_post_id', 'expansions~=pinned_tweet_id',
];
/** A Media's fields no read shapes (./semantics/shared.ts MEDIA_FIELDS_MODELLED holds the ones it does): the metadata
 *  endpoint's `alt_text` and every metrics field. */
// source: spec:/components/parameters/MediaFieldsParameter "A comma separated list of Media fields to display."
const MEDIA_FIELDS_UNSHAPED = [
  'media.fields~=alt_text', 'media.fields~=non_public_metrics', 'media.fields~=organic_metrics',
  'media.fields~=promoted_metrics', 'media.fields~=public_metrics',
];
/** A Place's fields: no post carries a place. */
// source: spec:/components/parameters/PlaceFieldsParameter "A comma separated list of Place fields to display."
const PLACE_FIELDS = [
  'place.fields~=contained_within', 'place.fields~=country', 'place.fields~=country_code', 'place.fields~=full_name',
  'place.fields~=geo', 'place.fields~=id', 'place.fields~=name', 'place.fields~=place_type',
];

/** A post read's (getPostsById, getPostsByIds, getUsersPosts). */
const POST_READ_VARIANTS = [...POST_FIELDS_UNSHAPED, ...POST_EXPANSIONS_UNFILLED, ...USER_FIELDS_UNSHAPED, ...MEDIA_FIELDS_UNSHAPED, ...PLACE_FIELDS];
/** A user read's (getUsersMe, getPostsLikingUsers): no user expansion is filled, so no expanded post is there for the
 *  Post fields to shape. */
const USER_READ_VARIANTS = [...USER_FIELDS_UNSHAPED, ...USER_EXPANSIONS, ...POST_FIELDS_UNSHAPED, ...POST_FIELDS_SHAPED];
/** The fields of a post's body no create keeps: a card, a community, a DM deep link, an edit, a place, super-followers,
 *  an AI label that labels something (`made_with_ai: false` labels nothing and is taken), the public-timeline opt-out,
 *  who may reply, a reply's exclusions, and the Amplify fields and tagged users of its media. (A reply's
 *  `auto_populate_reply_metadata` is no variant: X takes and drops it, ./semantics/tweets.ts.) */
// source: spec:/components/schemas/CreatePostsRequest/properties/card_uri "Card URI parameter."
// source: spec:/components/schemas/CreatePostsRequest/properties/geo "Geo location for the tweet."
// source: spec:/components/schemas/CreatePostsRequest/properties/made_with_ai "Disclose that the tweet contains AI-generated media."
// source: spec:/components/schemas/CreatePostsReply/properties/exclude_reply_user_ids "User IDs to exclude from the reply thread."
// source: spec:/components/schemas/CreatePostsMedia/properties/tagged_user_ids "User IDs tagged in the media."
// source: spec:/components/schemas/CreatePostsMedia/properties/title "Title for the media, rendered on the Post card for video and Amplify content."
const POST_CREATE_VARIANTS = [
  'card_uri', 'community_id', 'direct_message_deep_link', 'edit_options', 'for_super_followers_only', 'geo', 'made_with_ai=true',
  'nullcast', 'reply_settings', 'share_with_followers',
  'reply.exclude_reply_user_ids',
  'media.tagged_user_ids', 'media.title', 'media.description', 'media.preview_media_id', 'media.embeddable', 'media.call_to_actions',
];
/** An upload no session keeps: a media id shared across accounts, and the categories and types no post or page of the
 *  twin shows (a GIF, a DM's video, subtitles; WebM, QuickTime, a transport stream, captions, BMP, TIFF, a 3D model).
 *  ./semantics/media.ts IMAGE_TYPES, VIDEO_TYPES, IMAGE_CATEGORIES and ./semantics/shared.ts VIDEO_CATEGORIES hold the
 *  ones it keeps. */
// source: spec:/components/schemas/InitializeMediaUploadRequest/properties/shared "Whether this media is shared or not."
// source: spec:/components/schemas/InitializeMediaUploadRequest/properties/media_category "The media category of the upload."
// source: spec:/components/schemas/InitializeMediaUploadRequest/properties/media_type "The type of media."
const UPLOAD_VARIANTS = [
  'shared=true', 'media_category=dm_gif', 'media_category=dm_video', 'media_category=subtitles',
  'media_category=tweet_gif', 'media_type=video/webm', 'media_type=video/mp2t', 'media_type=video/quicktime',
  'media_type=text/srt', 'media_type=text/vtt', 'media_type=image/bmp', 'media_type=image/pjpeg',
  'media_type=image/tiff', 'media_type=model/gltf-binary', 'media_type=model/vnd.usdz+zip',
];

/** What X serves on x.com and twitter.com beside its public pages: the OAuth 2.0 consent leg, and the World's doors.
 *  x.com is the whole X web property, so the claim is anchored (the googleoauth lesson: an unanchored claim swallows
 *  `/i/oauth2/authorize2` and friends). */
const X_CONSENT_PATHS = '^/i/oauth2/authorize/?$|^/_twin/';

/** What X serves on api.x.com and api.twitter.com: every path of its API v2 (an operation the twin does not model answers
 *  X's 404 problem, the gap), OAuth 1.0a's legs and its screens, v1.1's invalidate_token, and the World's doors. The
 *  rest of the host (v1.1's REST API) is not claimed, so a client that reaches for it is refused loudly. */
const X_API_PATHS = '^/2/|^/oauth/(?:request_token|authorize|authenticate|access_token)/?$|^/1\\.1/oauth/invalidate_token(?:\\.json)?/?$|^/_twin/';

export const manifest: DerivedManifest = {
  vendor: 'x',
  service: 'x',
  body: {},
  // Handler-created identities use the kernel's clock and resource minting rules.
  // source: spec:/components/schemas/Post/properties/id "Unique identifier of this Post."
  ids: { template: '{snowflake:1288834974657}' },
  time: 'iso',
  // X's problem body (spec:/components/schemas/Problem: type, title, detail, status), for the refusals the kernel
  // answers around the handlers
  error: { title: '{code}', type: '{kind}', status: '{status}', detail: '{message}' },
  defaultKind: 'about:blank',
  // not X's: the kernel's refusal of a write to a World started read-only, in X's problem form
  readOnly: { status: 405, code: 'Method Not Allowed', kind: 'about:blank', message: 'This twin is running read-only; writes are refused.' },
  malformedBody: { status: 400, code: 'Invalid Request', kind: 'https://api.x.com/2/problems/invalid-request', message: 'The request body could not be parsed as a JSON object.' },
  notFound: { status: 404, code: 'Not Found Error', kind: 'about:blank', message: 'Not Found' },
  // required by the type; the handlers page every list themselves (pagination_token, meta.next_token)
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'max_results', default: 10, max: 100 } },
  deleted: { data: { deleted: true } },
  // the operations of X's API v2 this pack does not model: the gap
  unmodeled: [
    // /2/account
    'ensureAccount', 'getDeveloperAccount',
    // /2/account_activity
    'createAccountActivitySubscription', 'deleteAccountActivitySubscription', 'getAccountActivitySubscriptionCount', 'getAccountActivitySubscriptions', 'validateAccountActivitySubscription',
    // /2/activity
    'activityStream', 'createActivitySubscription', 'deleteActivitySubscription', 'deleteActivitySubscriptionsByIds', 'getActivitySubscriptions', 'updateActivitySubscription',
    // /2/bots
    'createBot', 'deleteBot', 'getBots', 'revokeBotToken', 'rotateBotToken', 'updateBot',
    // /2/broadcasts
    'addChatModerator', 'createScheduledBroadcast', 'deleteBroadcastChatMessage', 'deleteScheduledBroadcast', 'getBroadcast', 'getBroadcastChat', 'getChatModerators', 'getScheduledBroadcast', 'goLiveScheduledBroadcast', 'listBroadcasts', 'listScheduledBroadcasts', 'muteBroadcastChatUser', 'removeChatModerator', 'sendBroadcastChat', 'unmuteBroadcastChatUser', 'updateScheduledBroadcast',
    // /2/chat
    'addChatGroupMembers', 'addConversationKeys', 'chatMediaDownload', 'chatMediaUploadAppend', 'chatMediaUploadFinalize', 'chatMediaUploadInitialize', 'createChatConversation', 'deleteChatMessages', 'getChatConversation', 'getChatConversationEvents', 'getChatConversations', 'initializeChatGroup', 'markChatConversationRead', 'sendChatMessage', 'sendChatTypingIndicator',
    // /2/communities
    'getCommunitiesById', 'searchCommunities',
    // /2/compliance
    'createComplianceJobs', 'deleteComplianceJobsById', 'downloadComplianceJobResults', 'getComplianceJobs', 'getComplianceJobsById', 'uploadComplianceJobSubmission',
    // /2/connections
    'deleteAllConnections', 'deleteConnectionsByEndpoint', 'deleteConnectionsByUuids', 'getConnectionHistory',
    // /2/dm_conversations
    'createDirectMessagesByConversationId', 'createDirectMessagesByParticipantId', 'createDirectMessagesConversation', 'dmConversationsMediaDownload', 'getDirectMessagesEventsByConversationId', 'getDirectMessagesEventsByParticipantId',
    // /2/dm_events
    'deleteDirectMessagesEvents', 'getDirectMessagesEvents', 'getDirectMessagesEventsById',
    // /2/likes
    'streamLikesCompliance', 'streamLikesFirehose', 'streamLikesSample10',
    // /2/lists
    'addListsMember', 'createLists', 'deleteLists', 'getListsById', 'getListsFollowers', 'getListsMembers', 'getListsPosts', 'removeListsMemberByUserId', 'updateLists',
    // /2/media (upload is served)
    'createMediaMetadata', 'createMediaSubtitles', 'deleteMediaSubtitles', 'getMediaAnalytics', 'getMediaByMediaKey', 'getMediaByMediaKeys',
    // /2/news
    'getNews', 'searchNews',
    // /2/notes
    'createCommunityNotes', 'deleteCommunityNotes', 'evaluateCommunityNotes', 'searchCommunityNotesWritten', 'searchEligiblePosts',
    // /2/openapi.json
    'getOpenApiSpec',
    // /2/spaces
    'getSpacesBuyers', 'getSpacesByCreatorIds', 'getSpacesById', 'getSpacesByIds', 'getSpacesPosts', 'searchSpaces',
    // /2/trends
    'getTrendsByWoeid',
    // /2/tweets (create, lookup and who liked a post are served)
    'createWebhooksStreamLink', 'deleteWebhooksStreamLink', 'getPostsAnalytics', 'getPostsCountsAll', 'getPostsCountsRecent', 'getPostsQuotedPosts', 'getPostsRepostedBy', 'getPostsReposts', 'getRuleCounts', 'getRules', 'getWebhooksStreamLinks', 'hidePostsReply', 'searchPostsAll', 'streamLabelsCompliance', 'streamPosts', 'streamPostsCompliance', 'streamPostsFirehose', 'streamPostsFirehoseEn', 'streamPostsFirehoseJa', 'streamPostsFirehoseKo', 'streamPostsFirehosePt', 'streamPostsSample', 'streamPostsSample10', 'updateRules',
    // /2/usage
    'getUsage', 'getUsageCredits',
    // /2/users (the caller's lookup, the account's own posts and a repost are served)
    'addUserPublicKey', 'blockUsersDms', 'createUsersBookmark', 'createUsersBookmarkFolder', 'deleteUsersBookmark', 'followList', 'followUser', 'getTrendsPersonalizedTrends', 'getUsersAffiliates', 'getUsersBlocking', 'getUsersBookmarkFolders', 'getUsersBookmarks', 'getUsersBookmarksByFolderId', 'getUsersByIds', 'getUsersByUsernames', 'getUsersFollowedLists', 'getUsersFollowers', 'getUsersFollowing', 'getUsersLikedPosts', 'getUsersListMemberships', 'getUsersMuting', 'getUsersOwnedLists', 'getUsersPinnedLists', 'getUsersPublicKey', 'getUsersPublicKeys', 'getUsersRepostsOfMe', 'likePost', 'muteUser', 'pinList', 'searchUsers', 'streamUsersCompliance', 'unblockUsersDms', 'unfollowList', 'unfollowUser', 'unlikePost', 'unmuteUser', 'unpinList', 'unrepostPost', 'usersIdBlock', 'usersIdUnblock',
    // /2/webhooks
    'createWebhookReplayJob', 'createWebhooks', 'deleteWebhooks', 'getWebhooks', 'validateWebhooks',
    // served before, called by no application here (journeys/demand.json): a post's deletion, a user by id or by
    // username, the mentions and home timelines, recent search, the one-shot upload, OAuth 2.0 revoke and OAuth 1.0a
    // invalidate_token
    'deletePosts', 'getUsersById', 'getUsersByUsername', 'getUsersMentions', 'getUsersTimeline', 'searchPostsRecent', 'mediaUpload',
    'post_2_oauth2_revoke', 'post_1_1_oauth_invalidate_token', 'post_1_1_oauth_invalidate_token_json',
  ],
  // what X documents and no demand asks, answered with the gap before the handler runs (architecture, "Creating a
  // pack", step 7): the account's own timeline windowed by a post id (since_id, until_id; Scheduler's analytics window is
  // by start_time and end_time), and every documented value of a parameter that the twin holds no state for (below)
  variants: {
    getPostsById: POST_READ_VARIANTS,
    getPostsByIds: POST_READ_VARIANTS,
    getUsersPosts: ['since_id', 'until_id', ...POST_READ_VARIANTS],
    getUsersMe: USER_READ_VARIANTS,
    getPostsLikingUsers: USER_READ_VARIANTS,
    createPosts: POST_CREATE_VARIANTS,
    initializeMediaUpload: UPLOAD_VARIANTS,
  },
  // X's hosted flows: the pages an application sends its user through, served from the store (./screens/)
  // X's documented limits, per user per 15-minute window (https://docs.x.com/x-api/fundamentals/rate-limits): the
  // budget is the per-user window of the reads the demand makes (GET /2/tweets/:id, /2/users/:id/tweets and
  // /2/users/by/username, 900), each call weighted by how much of it its own endpoint's limit spends
  // source: https://docs.x.com/x-api/fundamentals/rate-limits "Exceeding limits results in a 429 error until the window resets."
  // source: https://docs.x.com/x-api/fundamentals/rate-limits "Limits are shown per 15 minutes unless otherwise noted"
  // source: https://docs.x.com/x-api/fundamentals/rate-limits "GET /2/tweets/:id 450/15min 900/15min"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 60, source: 'https://docs.x.com/x-api/fundamentals/rate-limits' },
    reason: 'X limits each endpoint per user per 15 minutes (https://docs.x.com/x-api/fundamentals/rate-limits): GET /2/tweets/:id, /2/users/:id/tweets and /2/users/by/username 900, POST /2/tweets 100, GET /2/users/me and /2/tweets/:id/liking_users 75, POST /2/users/:id/retweets 50, GET /2/tweets 5,000, the chunked upload 1,875 and its STATUS 1,000; a ceiling of 900 a window, each call weighted 900 / its limit. X documents no limit for Articles: priced as its tightest write',
    windowMs: 900_000, ceiling: 900, burstCeiling: 60, defaultWeight: 1, maxRetryAfterSeconds: 900,
    rules: [
      { match: '^POST /2/tweets$', weight: 9 },
      { match: '^POST /2/users/[^/]+/retweets$', weight: 18 },
      { match: '^POST /2/articles/', weight: 18 },
      { match: '^GET /2/users/me$', weight: 12 },
      { match: '^GET /2/tweets/[^/]+/liking_users$', weight: 12 },
    ],
  },
  // the World's doors (./semantics/doors.ts): what X's developer console, sign-up and x.com session do outside its API
  doors: [
    { id: 'clients', method: 'POST', path: '/_twin/clients', note: "an OAuth 2.0 App, as X's developer console makes it" },
    { id: 'oauth1Apps', method: 'POST', path: '/_twin/oauth1_apps', note: 'an OAuth 1.0a App (the developer console has no API)' },
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: "an X account, as X's sign-up and profile pages make it, with the password its person signs in to x.com with" },
    { id: 'tokens', method: 'POST', path: '/_twin/tokens', note: 'an OAuth 2.0 access token for an account, without the authorize leg' },
    { id: 'posts', method: 'POST', path: '/_twin/posts', note: 'a post someone outside the World made: on its own, a reply or a quote' },
    { id: 'engagement', method: 'POST', path: '/_twin/engagement', note: 'the audience at work on a post: a like, a repost, a bookmark, or views' },
    { id: 'rateLimit', method: 'POST', path: '/_twin/rate_limit', note: "arms X's 15-minute-window refusal for every /2 request until disarmed" },
    { id: 'rateWindows', method: 'POST', path: '/_twin/rate_windows', note: "sets an account's GET /2/users/me window at `used` spends" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's App as the developer console shows its owner: API Key and Secret, the owner's personal Access Token and Secret, and its OAuth 2.0 Client ID and Secret (the descriptor's credentialDoor)" },
  ],
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: "X (Twitter): the API v2 as Dub and an account's scheduled voice call it (posts, replies and quotes, reposts, Articles, post and user lookup with public metrics, an account's own posts, who liked a post, image and video upload, GET /2/users/me), its OAuth 2.0 + PKCE and OAuth 1.0a authorization server with the authorize screens, x.com's sign-in and home with the composer a person posts from, its post and profile pages with a link's card, and X's media hosts",
    stores: 'OAuth Apps, X accounts and the people who sign in to them, the x.com session, a link\'s card as X\'s crawler read it, authorize screens in flight, grants, posts and the media they carry, Articles, reposts, the audience\'s likes, bookmarks and views, the rate windows, and every credential issued (by its SHA-256)',
    identity: 'Send `Authorization: Bearer <token>` for an access token the token endpoint issued or POST /_twin/tokens recorded (the account it names, with its scopes), or an OAuth 1.0a User Context signature over an access token the three legs issued (the account that approved it, with its App\'s permission).',
  },
  screens: [
    {
      // source: recording:2026-10-03-tweet-button.html "https://x.com/intent/tweet"
      id: 'intent', kind: 'flow', host: 'x.com', hosts: ['twitter.com'], path: '/intent/tweet', status: 'done',
      controls: ['Post'],
      demand: 'videogame.ai ShareDialog opens a Web Intent with text and url (src/components/ui/ShareDialog.tsx:29)',
      source: 'recording:2026-10-03-tweet-button.html; recording:2026-10-03-how-to-post.json',
    },
    {
      id: 'login', kind: 'flow', host: 'x.com', path: '/i/flow/login', status: 'done',
      controls: ['Phone, email, or username', 'Password', 'Log in'],
      demand: "every x.com page a person needs to be signed in for sends a visitor here first (the home timeline where the model editor's launch is posted, the owner's ruling of 2026-10-02); signs in the World's accounts with the password the World gave each",
      source: "x.com's sign-in flow at /i/flow/login, which home and the other signed-in routes answer a visitor with (RESERVED in ./semantics/shared.ts); its labels are X's own",
    },
    {
      id: 'home', kind: 'workspace', host: 'x.com', path: '/home', status: 'done',
      controls: ['Post text', 'Add photos or video', 'Remove media', 'Post'],
      demand: "the owner's ruling of 2026-10-02: the model editor's launch is posted to X by a person through x.com's UI, \"primarily going to be UI since posting is not really automated\": its text, an image or the MP4 video attached from their machine, and Post (journeys/demand.json)",
      source: "https://docs.x.com/x-api/media (the chunked upload the composer makes) and spec:createPosts; the composer's words and control names are X's own labels (./screens/home.tsx)",
    },
    {
      id: 'oauth2-authorize', kind: 'flow', host: 'x.com', hosts: ['twitter.com'], path: '/i/oauth2/authorize', status: 'done',
      controls: ['Authorize app', 'Cancel'],
      demand: 'every sign-in-with-X integration sends its user here (NextAuth\'s X provider, both official SDKs\' authorize-URL builders); twitter.com answers the same path',
      source: AUTHORIZATION_CODE,
    },
    {
      id: 'oauth1-authorize', kind: 'flow', host: 'api.x.com', path: '/oauth/authorize', status: 'done',
      controls: ['Authorize app', 'Cancel'],
      demand: 'step 2 of the 3-legged OAuth flow: an app sends its user here with a request token (twitter-api-v2 generateAuthLink linkMode authorize); api.twitter.com answers the same path',
      source: OAUTH1_THREE_LEGGED,
    },
    {
      id: 'oauth1-authenticate', kind: 'flow', host: 'api.x.com', path: '/oauth/authenticate', status: 'done',
      controls: ['Authorize app', 'Cancel'],
      demand: 'Sign in with X: an app connects an X account through it (twitter-api-v2 generateAuthLink linkMode authenticate); it skips the screen for an App the person already approved',
      source: OAUTH1_REFERENCE,
    },
    {
      id: 'oauth1-login', kind: 'flow', host: 'api.x.com', path: '/oauth/authenticate', status: 'todo',
      demand: 'force_login=true and screen_name: the x.com sign-in before the screen; the authenticate screen takes the person already signed in at x.com',
      source: OAUTH1_REFERENCE,
    },
    {
      id: 'post', kind: 'workspace', host: 'x.com', path: '/{handle}/status/{id}', status: 'done',
      controls: ['Back', 'Reply', 'Repost', 'Like', 'Bookmark', 'Post text'],
      demand: "Volter Browsers' frontline (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:9-27, lucarne-interact/src/frontline-session.ts:8) presses Reply to open the composer and Back, and must find Like, Repost and Follow to refuse them; an app links a published post to it; a walk of 2026-09-28 opened it; the person who posted the launch from home opens it from the toast's View",
      source: 'x.com itself, observed logged out on 2026-09-28 (./screens/post.tsx, its page drawn in ./screens/shared.tsx)',
    },
    {
      id: 'profile', kind: 'workspace', host: 'x.com', path: '/{handle}', status: 'done',
      controls: ['Back', 'Follow', 'Reply', 'Repost', 'Like', 'Bookmark'],
      demand: "Volter Browsers' frontline refuses Follow on a profile (volter-ai/lucarne 83c544c packages/lucarne-interact/src/frontline-session.ts:8); a post's page links its author's profile; a walk of 2026-09-28 opened it; RH2's and Runhuman's sites link x.com/volterai, videogame.ai's twitter.com/videogame_ai",
      source: 'x.com itself, observed logged out on 2026-09-28 (./screens/profile.tsx, its page drawn in ./screens/shared.tsx)',
    },
    {
      id: 'post-replies', kind: 'workspace', host: 'x.com', path: '/{handle}/status/{id}', status: 'todo',
      demand: "the replies under a post on its page (the conversation); no application in this pack's demand reads them there",
      source: 'x.com itself, observed logged out on 2026-09-28 (./screens/post.tsx)',
    },
    {
      // x.com's root, and X's other web hosts' moves toward x.com for every page the pack claims (./screens/web.ts)
      id: 'web', kind: 'workspace', host: 'x.com', hosts: ['twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.x.com', 'mobile.twitter.com'], path: '/', status: 'done',
      demand: "x.com's root, where a World's console frames the workspace (a person signed in is sent home, a visitor to sign in); twitter.com, www. and mobile. move toward x.com for every page the pack claims (videogame.ai links twitter.com/videogame_ai)",
      source: 'x.com itself, observed logged out on 2026-09-28 (./screens/web.ts)',
    },
    {
      id: 'media', kind: 'content', host: 'pbs.twimg.com', hosts: ['video.twimg.com', 'abs.twimg.com'], path: '/', status: 'done',
      demand: "every API media url and x.com's pages load uploaded images and video from these hosts, and every photo-less account's profile_image_url names abs.twimg.com's default avatar (an app fetches it at channel connect)",
      source: 'the media urls X answers (spec:/components/schemas/Media) and abs.twimg.com observed on 2026-09-28 (./screens/media.ts)',
    },
  ],
  resources: {
    CreatePostsResponseData: { idPrefix: '', storedAs: 'post', refresh: { none: 'The create response is a thin view of Post; Post refresh reads the user timeline.' } },
    // source: spec:getUsersMe "Get Users Me"
    User: { idPrefix: '', ...states.User, storedAs: 'account', refresh: { get: 'getUsersMe', query: { 'user.fields': 'created_at,description,location,url,profile_image_url,protected,verified,verified_type' } } },
    // source: spec:getUsersPosts "Get Users Posts"
    Post: { idPrefix: '', storedAs: 'post', embeds: { conversation_id: 'Post', in_reply_to_user_id: 'User', article_id: 'article' }, parent: { resource: 'User', field: 'author_id', param: 'id' }, refresh: { list: 'getUsersPosts', items: 'data', next: 'meta.next_token', cursor: 'pagination_token', query: { 'tweet.fields': 'author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics,attachments' } } },

    // the vendor-backed refresh (architecture, "The real-system adapters"): X's API reads none of these back
    auth_request: { idPrefix: 'ar_', ...states.auth_request, refresh: { none: "an authorize screen in flight is a person's browser at x.com; X's API reads none back" } },
    _authorization_code: { idPrefix: '', ...states._authorization_code },
    _refresh_token: { idPrefix: '', ...states._refresh_token },
    _access_token: { idPrefix: '' },
    _oauth1_request_token: { idPrefix: '', ...states._oauth1_request_token },
    _oauth1_token: { idPrefix: '', refresh: { none: "an OAuth 1.0a access token is answered once, by POST oauth/access_token; X's API lists no tokens" } },
    Poll: { idPrefix: '', storedAs: 'poll', refresh: { none: 'Polls are exposed through a Post attachments.poll_ids expansion; X publishes no independent poll lookup or list.' } },
    // an Article's publication (./semantics/articles.ts)
    article: { idPrefix: '', ...states.article, embeds: { post_id: 'Post' }, companions: { Post: 'data.post_id' }, refresh: { none: 'X reads no Article back: the document has only POST /2/articles/draft and /2/articles/{article_id}/publish; the published post is read as a post' } },
    // source: spec:initializeMediaUpload "Initialize Media Upload"
    InitializeMediaUploadResponseData: { idPrefix: '', storedAs: 'upload', refresh: { none: 'The initialize answer is a thin upload view; no API lists uploads.' } },
    upload: { idPrefix: '', ...states.upload, refresh: { none: 'The API exposes only a known upload id; it has no account upload listing. Completed media is included in Post expansions.' } },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest, surface),
  // which derives the vendor-backed half from the resources' refresh declarations above
  descriptor: {
    transport: 'rest',
    protocol: '3',
    archetype: 'crud',
    bin: 'world-x',
    resourcesUnreachable: { poll: 'The customer applications publish text, photos, videos and Articles; poll creation is exercised separately by the vendor-published Post with poll example.', _refresh_token: 'Dub requests tweet.read users.read for handle verification without offline.access, so its grant issues no refresh token. The vendor-backed root exchanges refresh tokens, exercised by the published examples.' },
    resources: ['oauth_client', 'oauth1_app', 'account', 'auth_request', 'post', 'poll', 'rate_limit', '_oauth1_token', 'article', 'like', 'repost', 'bookmark', '_impressions', '_card', '_grant', '_oauth1_grant', '_rate_window', '_authorization_code', '_access_token', '_refresh_token', '_oauth1_request_token', '_client_secret', '_code_challenge', 'upload'],
    specSource:
      "X's own OpenAPI document, X API v2 version 2.168 (https://api.x.com/2/openapi.json, spec/openapi.json.gz, provenance "
      + 'in spec/SOURCE.md), corrected by spec/patches.json to the names the wire carries (tweet.fields, referenced_tweets, '
      + "edit_history_tweet_ids, pinned_tweet_id) and with X's OAuth endpoints it omits patched in from docs.x.com "
      + '(POST /2/oauth2/token and /2/oauth2/revoke from the Authorization Code Flow page; POST /oauth/request_token, '
      + '/oauth/access_token and /1.1/oauth/invalidate_token from the OAuth API reference). The official SDK sources '
      + "(@xdevplatform/xdk, twitter-api-typescript-sdk) ground the token bodies; twitter-api-v2@1.29 the posting surface.",
    description:
      "X twin — an account's scheduled voice and its sign-in, as applications use them: post, reply and quote, repost, "
      + 'publish an Article, upload images and video, look posts and accounts back up, read the account\'s own timeline, '
      + 'who liked a post and its public metrics (the audience\'s likes, reposts, bookmarks and views are a World door), '
      + "with X's own tweet.fields projection and problem envelopes; and the authorization server behind it — the x.com "
      + 'authorize screen, OAuth 2.0 + PKCE (token, refresh), OAuth 1.0a three-legged (request_token, '
      + "authorize/authenticate, access_token) and GET /2/users/me; x.com's post and profile pages and X's media hosts.",
    adoption: {
      // X's official SDKs (the current XDK and the legacy, archived but still installed, SDK), X's own npm scope,
      // twitter-api-v2 (the third-party client spanning the whole API) and tweepy (the de-facto Python client; X ships
      // none). X_* / TWITTER_* name the OAuth App's credentials: the single-letter `X` stem fires on any X_<credential
      // suffix> shape, accepted deliberately (a var named bare X_* with a credential suffix is overwhelmingly the vendor)
      pypi: ['tweepy'],
      sdks: ['@xdevplatform/xdk', 'twitter-api-sdk', 'twitter-api-v2'],
      scopes: ['@xdevplatform/'],
      envStems: ['X', 'TWITTER'],
    },
    // x.com is the whole X web property and api.x.com the whole API host, so each is path-scoped to what the pack
    // serves, and the rest is refused loudly (the Cal.com mis-route lesson). twitter.com and api.twitter.com are the
    // hosts X's legacy clients still target; www. and mobile. answer X's own moves toward x.com. pbs.twimg.com and
    // video.twimg.com serve uploaded media, and abs.twimg.com the default profile image paths.
    hosts: [
      { host: 'api.x.com', pathPattern: X_API_PATHS },
      { host: 'api.twitter.com', pathPattern: X_API_PATHS },
      { host: 'x.com', pathPattern: `${X_CONSENT_PATHS}|${X_WEB_PATHS}|^/intent/tweet/?$` },
      { host: 'twitter.com', pathPattern: `${X_CONSENT_PATHS}|${X_WEB_PATHS}|^/intent/tweet/?$` },
      { host: 'www.x.com', pathPattern: X_WEB_PATHS },
      { host: 'www.twitter.com', pathPattern: X_WEB_PATHS },
      { host: 'mobile.twitter.com', pathPattern: X_WEB_PATHS },
      { host: 'mobile.x.com', pathPattern: X_WEB_PATHS },
      { host: 'pbs.twimg.com', pathPattern: X_PBS_PATHS },
      { host: 'video.twimg.com', pathPattern: X_VIDEO_PATHS },
      { host: 'abs.twimg.com', pathPattern: X_ABS_PATHS },
    ],
    // the vendor-backed root's credential: an OAuth 2.0 App's refresh token (offline.access), traded on X's refresh-token
    // grant for the access token every call carries. The root's App is confidential, so the grant authenticates it
    // with HTTP Basic over its client id and secret.
    // source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token "You can make a POST request to the following endpoint: https://api.x.com/2/oauth2/token"
    // source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token "you will also need to pass in your refresh_token, set your grant_type to be a refresh_token, and define your client_id"
    // source: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/user-access-token "If you are working with confidential clients, you will need to use a basic authentication scheme"
    // Where the documentation stops: X's pages do not say that a refresh grant answers a new refresh_token and spends the
    // one presented; that is the wire's reported behaviour (the twin's oauth2.ts rotates it the same way), so `rotate`
    // keeps whatever new one an answer carries and changes nothing when an answer carries none.
    auth: { in: 'choice', choices: [
      { credential: 'consumerKey', strategy: { in: 'signature', algorithm: 'oauth1-hmac-sha1' } },
      { credential: 'refresh_token', strategy: {
      in: 'exchange',
      request: {
        method: 'POST', path: '/2/oauth2/token', format: 'form',
        body: { grant_type: 'refresh_token', refresh_token: { credential: 'refresh_token' }, client_id: { credential: 'client_id' } },
        basicAuth: { user: { credential: 'client_id' }, password: { credential: 'client_secret' } },
      },
      token: 'access_token',
      rotate: { answer: 'refresh_token', credential: 'refresh_token' },
    } },
    ] },
    // a browser is REDIRECTED to x.com/i/oauth2/authorize: the loader host is the consent host and the prefix the OAuth
    // path root
    browserRouting: { apiPathPrefix: '/i/oauth2/', loaderHost: 'https://x.com' },
    // the World application's credentials, as the developer console's Apps section gives them to the App's owner (the
    // API Key and Secret, the personal Access Token and Secret, the OAuth 2.0 Client ID and Secret), under the names an
    // application reads them by: Dub's TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET, and the TWITTER_ stem's API key and
    // access token pair a twitter-api-v2 User Context client is made with
    credentialDoor: { account: { field: 'account' }, path: '/_twin/app-credentials', body: {}, fill: {
      TWITTER_API_KEY: 'consumer_key', TWITTER_API_SECRET: 'consumer_secret',
      TWITTER_ACCESS_TOKEN: 'access_token', TWITTER_ACCESS_SECRET: 'access_token_secret',
      TWITTER_CLIENT_ID: 'client_id', TWITTER_CLIENT_SECRET: 'client_secret',
    } },
  },
};
