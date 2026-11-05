// YouTube's manifest: the vendor facts the YouTube Data API v3 Discovery document (../spec, converted to OpenAPI) does
// not carry (architecture, "Protocol 3"). The surface is generated (./generated/surface.gen.json, by derive-pack).
//
// WHAT IS SERVED is what a game studio's tooling reaches (../journeys/demand.json, ../journeys/decisions.json): its
// channel (channels.list), uploading a video by Google's resumable protocol or one multipart request, reading and
// editing it (videos.list, videos.update), a live broadcast with its stream and its chat (liveBroadcasts.insert, list,
// bind and transition; liveStreams.insert and list; liveChatMessages.list, insert and delete), and the community's
// comments (commentThreads.list and insert, comments.insert and setModerationStatus). Every other operation answers
// Google's 404, the gap.
//
// WHO IS CALLING. Google's OAuth 2.0 issues every credential YouTube reads: the googleoauth pack is Google's
// authorization server (its account chooser, its token endpoint), and an access token it issued is read here through
// the kernel's cross-pack read (`ownerReads`; architecture A3), never written. A Google account reaches YouTube once it
// has a channel: the channel door is that sign-up. ./semantics/around.ts checks the token and its scopes before any
// operation runs.
//
// THE BROADCAST'S VIDEO. A liveStream's ingestion address takes an encoder's RTMP publish (the manifest's `live`, the
// kernel's live media): the stream is active while the encoder publishes (./semantics/live.ts), and only then may a
// broadcast bound to it move to testing or live.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'youtube',
  service: 'youtube',
  body: { json: 'always' },
  // source: https://developers.google.com/youtube/v3/docs/videos "The ID that YouTube uses to uniquely identify the video."
  // source: https://developers.google.com/youtube/v3/getting-started "7lCDEYXw3mM"
  // a video's id is 11 characters, as the guide's example's is, and a broadcast's (the video it is); each other
  // resource below names its own.
  ids: { template: '{ksuid:11}' },
  time: 'iso',
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The sample JSON response below demonstrates how a global error is communicated:"
  // source: https://developers.google.com/youtube/v3/docs/core_errors "the value of the domain property in the JSON response will be an API-specific value, such as youtube.parameter"
  error: { error: { errors: [{ domain: '{kind}', reason: '{code}', message: '{message}' }], code: '{status}', message: '{message}' } },
  defaultKind: 'global',
  // not YouTube's: the kernel's refusal of a write to a World started read-only, in Google's error body
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The requested operation is forbidden and cannot be completed."
  readOnly: { status: 403, kind: 'global', code: 'forbidden', message: 'The requested operation is forbidden and cannot be completed.' },
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The requested operation failed because a resource associated with the request could not be found."
  notFound: { status: 404, kind: 'global', code: 'notFound', message: 'The requested operation failed because a resource associated with the request could not be found.' },
  gap: { status: 404, kind: 'global', code: 'notFound', message: 'The requested operation failed because a resource associated with the request could not be found.' },
  // source: https://developers.google.com/youtube/v3/docs/core_errors "The request failed because it contained an invalid parameter or parameter value."
  malformedBody: { status: 400, kind: 'global', code: 'invalidParameter', message: 'The request failed because it contained an invalid parameter or parameter value.' },
  deleted: {},
  // the credentials Google OAuth issues (its pack's contract: googleoauth/src/semantics/shared.ts): an access token,
  // by the token itself, with the client, the Google account (`sub`), the scopes granted and its expiry
  // and a Google Cloud project's API key, by its SHA-256 (the same pack: Google's credentials page)
  ownerReads: [{ owner: 'googleoauth', resource: 'access_token' }, { owner: 'googleoauth', resource: 'api_key' }, { owner: 'googleoauth', resource: 'account' }],
  resources: {
    // a YouTube channel: made by the account's YouTube sign-up (the channel door), owned by one Google account
    // source: https://developers.google.com/youtube/v3/docs/channels "A channel resource contains information about a YouTube channel."
    // Where the documentation stops: a channel id's form is not stated on these pages; the World's are UC and 22 characters.
    // source: https://developers.google.com/youtube/v3/docs/channels/list "Set this parameter's value to true to instruct the API to only return channels owned by the authenticated user."
    Channel: { storedAs: 'channel', idPrefix: 'UC', ids: '{prefix}{ksuid:22}', unique: [{ fields: ['_sub'], refusal: { status: 409, message: 'This Google account already has a YouTube channel.' } }], refresh: { list: 'youtube.channels.list', items: 'items', complete: false, query: { part: 'id,snippet,statistics,status', mine: 'true' }, next: 'nextPageToken', cursor: 'pageToken' } },
    // a video, uploaded through videos.insert
    // source: https://developers.google.com/youtube/v3/docs/videos/list "The id parameter specifies a comma-separated list of the YouTube video ID(s) for the resource(s) that are being retrieved."
    Video: { storedAs: 'video', idPrefix: '', ...states.Video, refresh: { get: 'youtube.videos.list', known: true, query: { part: 'id,snippet,status,statistics', id: '{id}' } } },
    // a live broadcast, the event a channel streams
    // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts "A liveBroadcast resource represents an event that will be streamed, using live video, on YouTube."
    // source: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list "The mine parameter can be used to instruct the API to only return broadcasts owned by the authenticated user."
    LiveBroadcast: { storedAs: 'liveBroadcast', idPrefix: '', ...states.LiveBroadcast, refresh: { list: 'youtube.liveBroadcasts.list', items: 'items', complete: false, query: { part: 'id,snippet,contentDetails,status', mine: 'true', broadcastType: 'all' }, next: 'nextPageToken', cursor: 'pageToken' } },
    // the video stream an encoder sends: its ingestion address and stream name
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "A liveStream resource contains information about the video stream that you are transmitting to YouTube."
    // Where the documentation stops: a stream id is opaque; the World's are 27 characters.
    // source: https://developers.google.com/youtube/v3/live/docs/liveStreams/list "Set the parameter value to true to only retrieve your own streams."
    LiveStream: { storedAs: 'liveStream', idPrefix: '', ids: '{ksuid:27}', ...states.LiveStream, refresh: { list: 'youtube.liveStreams.list', items: 'items', complete: false, query: { part: 'id,snippet,cdn,status,contentDetails', mine: 'true' }, next: 'nextPageToken', cursor: 'pageToken' } },
    // a message in a broadcast's live chat
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list "The liveChatId parameter specifies the ID of the chat whose messages will be returned."
    LiveChatMessage: { storedAs: 'liveChatMessage', idPrefix: '', ids: '{ksuid:27}', refresh: { none: "a chat's messages are read only while its chat is live (liveChatMessages.list answers liveChatEnded after), so a root holds what it sent, never a read-back of an ended chat" } },
    // a video's comment thread: its top-level comment and its replies
    // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "The videoId parameter instructs the API to return comment threads associated with the specified video ID."
    // Where the documentation stops: a thread's id is opaque; the World's are 26 characters, the top-level comment's id.
    CommentThread: { storedAs: 'commentThread', idPrefix: '', ids: '{ksuid:26}', parent: { resource: 'Channel', field: '_channel', param: 'allThreadsRelatedToChannelId' }, refresh: { list: 'youtube.commentThreads.list', items: 'items', complete: false, query: { part: 'id,snippet,replies' }, next: 'nextPageToken', cursor: 'pageToken' } },
    // a comment: a thread's top-level comment (the thread's id), or a reply (<thread id>.<its own>)
    // source: https://developers.google.com/youtube/v3/docs/comments "The ID that YouTube uses to uniquely identify the comment."
    Comment: { storedAs: 'comment', idPrefix: '', ids: '{ksuid:22}', ...states.Comment, refresh: { none: "a comment is read back inside its thread (commentThreads.list's replies part), which the thread's refresh reads" } },
    // a resumable upload session (the Location a resumable videos.insert answers) and the bytes it has received
    _upload_session: { idPrefix: '', ids: '{ksuid:27}' },
    // a broadcast's live chat, by its liveChatId
    _live_chat: { idPrefix: '', ids: '{ksuid:27}' },
    // an author whose comments a channel's owner banned (comments.setModerationStatus banAuthor), by channel and author
    _comment_ban: { idPrefix: '' },
  },
  // the operations of the declared resources no demanded call reaches: the gap
  unmodeled: [
    'youtube.channels.update', 'youtube.videos.delete', 'youtube.videos.insert', 'youtube.videos.insert.resumable', 'youtube.videos.rate', 'youtube.videos.getRating', 'youtube.videos.reportAbuse', 'youtube.videos.batchGetStats',
    'youtube.liveBroadcasts.update', 'youtube.liveBroadcasts.delete', 'youtube.liveBroadcasts.insertCuepoint',
    'youtube.liveStreams.update', 'youtube.liveStreams.delete',
    'youtube.liveChatMessages.transition', 'youtube.youtube.v3.liveChat.messages.stream',
    'youtube.comments.list', 'youtube.comments.update', 'youtube.comments.delete', 'youtube.comments.markAsSpam',
  ],
  // the documented variants of served operations no demanded call asks for
  variants: {
    // source: https://developers.google.com/youtube/v3/docs/videos/list "Set this parameter's value to like or dislike to instruct the API to only return videos liked or disliked by the authenticated user."
    'youtube.videos.list': ['chart', 'myRating'],
    // source: https://developers.google.com/youtube/v3/docs/channels/list "The forHandle parameter specifies a YouTube handle, thereby requesting"
    'youtube.channels.list': ['forHandle', 'forUsername', 'managedByMe', 'categoryId'],
    // source: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert "If type is pollEvent , include the snippet.pollDetails object structured as follows:"
    'youtube.liveChatMessages.insert': ['snippet.type=pollEvent'],
    // source: https://developers.google.com/youtube/v3/docs/commentThreads/list "The searchTerms parameter instructs the API to limit the API response to only contain comments that contain the specified search terms."
    'youtube.commentThreads.list': ['searchTerms', 'order=relevance'],
    '*': ['onBehalfOfContentOwner', 'onBehalfOfContentOwnerChannel'],
  },
  // the World's doors (./semantics/doors.ts): what YouTube's sign-up and its audience do outside the API
  doors: [
    { id: 'channels', method: 'POST', path: '/_twin/channels', note: "{ sub, title, handle?, description? }: a Google account's YouTube channel, as YouTube's sign-up makes it (the account is Google OAuth's, its sub the googleoauth account door's)" },
    { id: 'videoAudience', method: 'POST', path: '/_twin/videos/{id}/audience', note: "{ views?, likes?, comment?: { author, text } }: the audience at work on a video: views and likes it adds, and a comment from someone outside the World" },
    { id: 'chatAudience', method: 'POST', path: '/_twin/live-chats/{liveChatId}/audience', note: "{ author, text }: a chat line in a live chat from someone outside the World" },
    { id: 'channelAudience', method: 'POST', path: '/_twin/channels/{id}/audience', note: '{ subscribers }: how many people subscribe to the channel' },
  ],
  // YouTube's RTMP ingest: an encoder publishes to <ingestionAddress>/<streamName> (./semantics/live.ts)
  // source: https://developers.google.com/youtube/v3/live/docs/liveStreams "you may need to concatenate them in the following format:"
  live: [{
    id: 'ingest', app: 'live2',
    note: "YouTube's RTMP ingest: a liveStream's stream name names its stream, which is active while the encoder publishes and inactive after",
    source: 'https://developers.google.com/youtube/v3/live/docs/liveStreams',
  }],
  // source: https://developers.google.com/youtube/v3/getting-started "10,000 units per day combined for all other endpoints"
  // Where the documentation stops: the allowance is a day's, in quota units; the kernel bounds a window at an hour, so the
  // World keeps to the day's 10,000 spread over its hours (400 an hour), and in any minute to the fallback's 30, since Google
  // documents no per-minute allowance for the Data API.
  rateBudget: {
    windowMs: 3_600_000, ceiling: 400, burstCeiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 3600,
    reason: 'A project that enables the YouTube Data API has a default allocation of 10,000 units a day (https://developers.google.com/youtube/v3/getting-started); the kernel bounds a window at an hour, so a live root keeps to 400 calls an hour (the daily allocation over 24 hours, rounded down) and 30 a minute (the fallback), as Google documents no per-minute allowance.',
  },
  discovery: {
    twinOf: "YouTube Data API v3 as a game studio's tooling uses it: its channel, uploading videos (resumable and multipart) and editing them, live broadcasts bound to a stream an encoder publishes to over RTMP, their live chat, and comment threads with replies and moderation",
    stores: "channels, videos (their bytes as blobs), resumable upload sessions, live broadcasts and their chats, live streams, chat messages, comment threads and comments",
    identity: "`Authorization: Bearer <access token>` (or `?access_token=`) from Google OAuth 2.0 (the googleoauth twin) with a YouTube scope, whose Google account must have a channel; or, on the list methods that read public data, a Google Cloud project's API key (`?key=` or `X-Goog-Api-Key`, issued by googleoauth)",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-youtube',
    resources: ['channel', 'video', 'liveBroadcast', 'liveStream', 'liveChatMessage', 'commentThread', 'comment', '_upload_session', '_live_chat', '_comment_ban', '_live', '_live_segment'],
    specSource: 'YouTube Data API v3 Discovery document, revision 20261026, converted to OpenAPI by twin-world\'s spec-discovery-to-openapi.ts; provenance in spec/SOURCE.md',
    description: "YouTube twin: a channel's videos (resumable and multipart uploads, reads and edits), live broadcasts and streams with an RTMP ingest, live chat, and comment threads with replies and moderation, authorized by Google OAuth's tokens.",
    // the umbrella googleapis client is Google's as a whole (Drive, Sheets, Calendar, YouTube and more), never one vendor's
    // (twin-world's known-external-services.json keeps it unmapped): YouTube adopts its own client only
    adoption: { sdks: ['@googleapis/youtube'], envStems: ['YOUTUBE'] },
    // www.googleapis.com is shared with the other Google API packs and Google OAuth, so only YouTube's paths are claimed
    // there; youtube.googleapis.com is the Discovery document's root and carries the World's doors
    // source: spec:/servers/0/url "https://youtube.googleapis.com"
    // source: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part= PARTS"
    hosts: [
      { host: 'www.googleapis.com', pathPattern: '^/(upload/|resumable/upload/)?youtube/v3(/|$)' },
      { host: 'youtube.googleapis.com', pathPattern: '^/(upload/|resumable/upload/)?youtube/v3(/|$)|^/_twin/' },
    ],
    // the RTMP ingest beside the HTTP host: the World records rtmp://127.0.0.1:<port>/live2 as the twin's `ingest`, the
    // server an encoder is given in place of rtmp://a.rtmp.youtube.com/live2 (with the stream's stream name)
    sidePorts: [{ name: 'ingest', option: 'ingestPort', flag: '--ingest-port', scheme: 'rtmp', path: '/live2', note: "YouTube's RTMP ingest (<ingestionAddress>/<streamName>): an encoder publishes a liveStream's video here" }],
    endpointEnvNone: "Google's generated clients take rootUrl in code (googleapis: https://youtube.googleapis.com/); the World routes the declared YouTube paths on both API hosts",
    // The first member's channel is shared by deployments. GoogleOAuth owns the Google identity and credentials.
    // source: https://raw.githubusercontent.com/dubinc/dub/7e0101363b2a/apps/web/lib/youtube/client.ts "X-Goog-Api-Key"
    credentialDoor: { path: '/_twin/channels', body: {}, account: { field: 'account', tenancy: 'Google/YouTube user', source: 'https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps' }, deployment: { field: 'deployment', object: "none (the user's channel)", source: 'https://developers.google.com/youtube/v3/docs/channels/list', organizationOutputs: ['YOUTUBE_CHANNEL_ID'] }, fill: { YOUTUBE_CHANNEL_ID: 'id' } },
    credentialIssuer: 'googleoauth',
    // source: https://developers.google.com/youtube/v3/docs/errors "YouTube does not support Service Accounts, and if you attempt to authenticate using a Service Account, you will get this error."
    clientCasesNone: "No demanded application uses an official YouTube SDK: Dub calls the API with its own HTTP client, and videogame-ai's games sandbox people with fetch; googleapis is named for detection.",
  },
};
