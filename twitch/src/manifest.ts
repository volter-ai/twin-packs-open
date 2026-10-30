// Twitch's manifest: the vendor facts its reference page does not carry (docs/contributing/architecture.md,
// "Protocol 3"). The surface is generated (./generated/surface.gen.json, from ../spec by derive-pack): the Twitch API
// (Helix) as written from Twitch's reference page (../spec/SOURCE.md), 149 operations under https://api.twitch.tv/helix.
// One vendor, one store: Twitch's authentication service at id.twitch.tv (the OAuth token, validate and revoke
// endpoints and the authorize page) is this pack's lane `id` (../id), over the same state.
//
// WHAT IS SERVED is what the owner's ruling of 2026-10-07 and the AI VTuber stream rig reach (../journeys/demand.json):
// - the UI mirror of twitch.tv: the sign-in, a channel's page (its player, its live chat, viewers, title and
//   category), the chat popout, and the creator dashboard's stream manager and stream key settings (./screens/);
// - the broadcast: OBS publishes RTMP to the World's ingest (the manifest's `live`, the kernel's live media library),
//   the channel goes live, and its pages play the recording as HLS from Twitch's playback host (./screens/video.ts);
// - chat: Twitch's IRC over WebSocket at irc-ws.chat.twitch.tv (the socket `chat`, ./semantics/sockets.ts), which hears
//   every chat message as it is sent, and Send Chat Message, which the simulated viewers and the pages post with;
// - the Helix reads those need: Get Users, Get Channel Information (and Modify), Get Streams, Get Stream Key, Search
//   Categories. Every other operation answers Twitch's 404, the gap.
//
// THE STATE: users (`user`, in Get Users' shape), their channels (`channel`, Get Channel Information's), a live
// broadcast's stream (`stream`, Get Streams', present only while the channel is live), chat messages (`chat_message`),
// and the developer console's applications (`application`). A CREDENTIAL IS BOOKKEEPING, kept by its SHA-256: an
// application's client secret (`_client_secret`), the tokens id.twitch.tv issues (`_token`) and its authorization codes
// (`_authorization_code`, the lane's), and a channel's stream key (`_stream_key`). A broadcast's recording is the
// kernel's (`_live`, `_live_segment`, its bytes the pack's blobs).
//
// WHY NO MANIFEST `auth`. The core's `auth` reads one header. Helix reads two: a Bearer token and the Client-Id of the
// application it was issued to, which must match ("The ID specified in the Client-Id header does not match the client
// ID specified in the access token", Get Users' 401). ./semantics/around.ts resolves both to the caller before dispatch,
// and each handler asks the caller for the token type and scope its operation requires (./semantics/shared.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

/** The twitch.tv paths the pack's pages answer: the sign-in, a channel's page, its chat popout (and the root, which
 *  moves a person on). */
const WWW_PATHS = '^/$|^/login/?$|^/popout/[A-Za-z0-9_]{1,25}/chat/?$|^/[A-Za-z0-9_]{1,25}/?$|^/_twin/';
/** The creator dashboard's pages: the stream manager and the stream key settings. */
const DASHBOARD_PATHS = '^/u/[A-Za-z0-9_]{1,25}/(?:stream-manager|settings/stream)/?$';

export const manifest: DerivedManifest = {
  vendor: 'twitch',
  service: 'twitch',
  body: { json: 'always' },
  // source: https://dev.twitch.tv/docs/api/guide/ "All IDs are strings and should be considered opaque"
  // A user's id is a decimal string (the reference's examples: "141981764"); where the documentation stops, its width is
  // the examples' nine digits.
  ids: { template: '{digits:9}' },
  time: 'iso',
  // source: https://dev.twitch.tv/docs/api/reference/ "user is already banned"
  // the reference's examples answer a refusal { "error": "Bad Request", "status": 400, "message": "user is already banned" }
  error: { error: '{statusText}', status: '{status}', message: '{message}' },
  // not Twitch's: the kernel's refusal of a write to a World started read-only, in Twitch's error body
  readOnly: { status: 403, message: 'This twin is running read-only; writes are refused.' },
  malformedBody: { status: 400, message: 'The request body could not be parsed as JSON.' },
  // Where the documentation stops: Twitch documents no answer for a path the API does not have; the twin answers its
  // error body with 404 Not Found.
  notFound: { status: 404, message: 'Not Found' },
  // source: https://dev.twitch.tv/docs/api/guide/ "first — Use to specify the number of items to include per page"
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'first', default: 20, max: 100 }, after: 'after', before: 'before' },
  deleted: {},
  resources: {
    // a Twitch account (the sign-up the World's doors stand in for), in Get Users' shape; its email is answered only to a
    // user access token with user:read:email (./semantics/users.ts)
    // source: spec:getUsers "Gets information about one or more users."
    // Get Users lists no whole type: with no id or login it answers the token's own user, so a refresh reads that one and
    // never takes the type as complete
    GetUsersResponseData: { storedAs: 'user', idPrefix: '', refresh: { list: 'getUsers', items: 'data', complete: false } },
    // a user's channel, made with the account (every account has one), keyed by the broadcaster's id
    // source: spec:getChannelInformation "Gets information about one or more channels."
    GetChannelInformationResponseData: { storedAs: 'channel', idPrefix: '', ...states.GetChannelInformationResponseData, parent: { resource: 'GetUsersResponseData', field: 'broadcaster_id', param: 'broadcaster_id' }, refresh: { list: 'getChannelInformation', items: 'data' } },
    // a live broadcast: made when the channel goes live and gone when it is offline (./semantics/live.ts)
    // source: spec:getStreams "Gets a list of all streams."
    // A stream id is a decimal string (the reference's example: "40952121085"), eleven digits.
    GetStreamsResponseData: { storedAs: 'stream', idPrefix: '', ids: '{digits:11}', ...states.GetStreamsResponseData, refresh: { list: 'getStreams', items: 'data', next: 'pagination.cursor', cursor: 'after' } },
    // a message sent to a channel's chat room; the API reads none back (chat delivers it as it is sent)
    // source: https://dev.twitch.tv/docs/chat/irc/ "An ID that uniquely identifies the message."
    chat_message: { idPrefix: '', ids: '{uuid}', refresh: { none: "Twitch's API reads no chat message back: chat delivers each message as it is sent (IRC, EventSub)" } },
    // an application registered in the developer console, by its client id
    application: { idPrefix: '', refresh: { none: "Twitch's API reads no application back: the developer console makes and shows them" } },
  },
  // the World's doors (./semantics/doors.ts): what Twitch's sign-up, developer console and audience do outside its API
  doors: [
    { id: 'developerConsole', method: 'POST', path: '/_twin/console', note: "{ login, password, email, display_name?, application: { name, redirect_uris } }: a Twitch account signed up and an application registered in its developer console; answers the client id and secret (the World's credential door)" },
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: '{ login, password, email, display_name? }: a Twitch account, as its sign-up page makes it, with the password its person logs in with' },
    { id: 'audience', method: 'POST', path: '/_twin/audience', note: "{ login, viewers }: how many people are watching the channel's live stream (its viewer count)" },
  ],
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: "Twitch as an AI VTuber's stream rig and its audience use it: twitch.tv's channel page, chat popout, sign-in and creator dashboard (stream manager, stream key), the RTMP ingest OBS streams to and the HLS its pages play, chat over IRC on WebSocket, id.twitch.tv's OAuth (authorize, token, validate, revoke) and the Helix reads and writes those need (users, channels, streams, stream key, categories, Send Chat Message)",
    stores: "accounts and the people who log in to them, their channels and live streams, chat messages, the developer console's applications, every credential issued (by its SHA-256), stream keys, and each broadcast's recording (its segments' bytes as blobs)",
    identity: "Helix: `Authorization: Bearer <token>` and `Client-Id: <the token's application>`, a token id.twitch.tv issued (an app access token from the client credentials grant, or a user access token from the authorization code grant). Chat: an anonymous justinfan login. The ingest: the channel's stream key.",
  },
  screens: [
    {
      id: 'login', kind: 'flow', host: 'www.twitch.tv', path: '/login', status: 'done',
      controls: ['Username', 'Password', 'Log In'],
      demand: "every twitch.tv page a person must be logged in for (the creator dashboard, chatting) sends a visitor here first; the owner's ruling of 2026-10-07 (journeys/demand.json): the UI mirror is the pack's focus",
      source: "twitch.tv's own log-in, its labels Twitch's (./screens/login.tsx); https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ (If they're not logged in, Twitch first asks them to log in)",
    },
    {
      id: 'popout-chat', kind: 'workspace', host: 'www.twitch.tv', path: '/popout/{login}/chat', status: 'done',
      controls: ['Send a message', 'Chat'],
      demand: "a channel's chat on its own, as its chat panel's Popout Chat opens it; the owner's ruling of 2026-10-07: the UI mirror",
      source: "twitch.tv's own chat popout (./screens/popout-chat.tsx); chat messages are Send Chat Message's (spec:sendChatMessage)",
    },
    {
      id: 'stream-manager', kind: 'workspace', host: 'dashboard.twitch.tv', path: '/u/{login}/stream-manager', status: 'done',
      controls: ['Edit Stream Info', 'Title', 'Category', 'Done', 'Send a message', 'Chat'],
      demand: "the owner's ruling of 2026-10-07: the creator dashboard where the streamer sees the stream live or offline, edits its title and category and answers chat (journeys/demand.json)",
      source: 'spec:modifyChannelInformation, spec:searchCategories, spec:getStreams and spec:sendChatMessage; the stream manager\'s labels are Twitch\'s own (./screens/stream-manager.tsx)',
    },
    {
      id: 'stream-key', kind: 'workspace', host: 'dashboard.twitch.tv', path: '/u/{login}/settings/stream', status: 'done',
      controls: ['Show', 'Copy'],
      demand: "the rig's stream-key.txt holds the channel's stream key (agent-stream README.md:29), copied from the dashboard's Stream settings",
      source: 'spec:getStreamKey; the page\'s labels are Twitch\'s own (./screens/stream-key.tsx)',
    },
    {
      id: 'channel', kind: 'workspace', host: 'www.twitch.tv', path: '/{login}', status: 'done',
      controls: ['Send a message', 'Chat', 'Popout Chat'],
      demand: "the owner's ruling of 2026-10-07: \"the main focus of the twitch pack should be the UI mirror of course. And the fact that you can actually video cast to it\": a channel's page with its player, its live chat, the viewer count, the title and the category",
      source: 'spec:getUsers, spec:getChannelInformation, spec:getStreams and spec:sendChatMessage; the page\'s labels are Twitch\'s own (./screens/channel.tsx)',
    },
    {
      id: 'video', kind: 'content', host: 'usher.ttvnw.net', path: '/api/channel/hls/', status: 'done',
      demand: "the owner's ruling of 2026-10-07, \"the fact that you can actually video cast to it\": the channel page's and the stream manager's player play the channel's broadcast as HLS from Twitch's playback host",
      source: "the kernel's live media (architecture, \"Other wires\": live media); Twitch's playback host as twitch.tv's own player reaches it (./screens/video.ts)",
    },
    {
      id: 'web', kind: 'workspace', host: 'www.twitch.tv', hosts: ['twitch.tv', 'm.twitch.tv', 'player.twitch.tv'], path: '/', status: 'done',
      demand: "twitch.tv's root, where a World's console frames the workspace: a person logged in is sent to their channel, a visitor to the log-in; twitch.tv and m.twitch.tv move to www.twitch.tv for every page the pack claims; player.twitch.tv/?channel= is the embedded player a site frames (./screens/player.tsx), which videogame.ai's game page plays its cast in",
      source: "twitch.tv itself, and the embedded player on player.twitch.tv (./screens/web.tsx)",
    },
  ],
  // Twitch's IRC chat on WebSocket (./semantics/sockets.ts)
  sockets: [{
    id: 'chat', host: 'irc-ws.chat.twitch.tv', path: '/',
    note: "Twitch chat over IRC on WebSocket: CAP REQ, PASS and NICK (an anonymous justinfan login), JOIN and PART, PING, and each chat message sent to a joined channel as a PRIVMSG, tagged when the client asked for twitch.tv/tags",
    source: 'https://dev.twitch.tv/docs/chat/irc/',
  }],
  lanes: {
    // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "send an HTTP POST request to https://id.twitch.tv/oauth2/token"
    // id.twitch.tv's paths (all under /oauth2) are the lane's on any host: at a World's place every host is one base
    routes: [{ lane: 'id', host: '^id\\.twitch\\.tv$' }, { lane: 'id', path: '/oauth2' }],
  },
  // Twitch's ingest: a broadcaster's encoder publishes to rtmp://<ingest-server>/app/<stream-key> (./semantics/live.ts)
  live: [{
    id: 'ingest', app: 'app',
    note: "Twitch's RTMP ingest: a stream key names its channel, which is live from the broadcast's first segment until the encoder stops; ?bandwidthtest=true is recorded and shown to no one",
    source: 'https://dev.twitch.tv/docs/video-broadcast/',
  }],
  // Twitch's rate limits: a bucket of points per client id (and per user for a user access token), refilled each minute;
  // the API guide's example bucket is 800 points
  // source: https://dev.twitch.tv/docs/api/guide/ "If your bucket runs out of points within 1 minute, the request returns status code 429."
  // source: https://dev.twitch.tv/docs/api/guide/ "Ratelimit-Limit: 800"
  rateBudget: {
    allowance: { perMinute: 800, source: 'https://dev.twitch.tv/docs/api/guide/' },
    reason: "Twitch gives each app a bucket of points refilled within a minute, a point per request by default (https://dev.twitch.tv/docs/api/guide/: its example bucket, Ratelimit-Limit: 800). The World keeps to 800 a minute.",
    windowMs: 60_000, ceiling: 800, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-twitch',
    resources: ['user', 'channel', 'stream', 'chat_message', 'application', '_token', '_authorization_code', '_client_secret', '_stream_key', '_live', '_live_segment'],
    specSource: "the Twitch API (Helix) written from Twitch's reference page https://dev.twitch.tv/docs/api/reference/ (spec/SOURCE.md, by spec/page-to-openapi.ts), and id.twitch.tv's endpoints written from its authentication pages (id/spec/SOURCE.md)",
    description: "Twitch twin — the UI mirror of twitch.tv (a channel's page with its player and live chat, the chat popout, the log-in, the creator dashboard's stream manager and stream key) that OBS streams to over RTMP and whose pages play the broadcast as HLS; chat over IRC on WebSocket; id.twitch.tv's OAuth (authorize page, token, validate, revoke); and the Helix calls those need (users, channels, streams, stream key, categories, Send Chat Message).",
    // No official Twitch SDK: the demanded clients send plain HTTPS and WebSocket frames
    adoption: { sdks: [], envStems: ['TWITCH'] },
    // api.twitch.tv is the whole API host and www.twitch.tv the whole site, so each is path-scoped to what the pack serves
    hosts: [
      { host: 'api.twitch.tv', pathPattern: '^/helix/|^/_twin/' },
      { host: 'id.twitch.tv', pathPattern: '^/oauth2/|^/_twin/' },
      { host: 'www.twitch.tv', pathPattern: WWW_PATHS },
      { host: 'twitch.tv', pathPattern: WWW_PATHS },
      { host: 'm.twitch.tv', pathPattern: WWW_PATHS },
      { host: 'dashboard.twitch.tv', pathPattern: DASHBOARD_PATHS },
      { host: 'player.twitch.tv', pathPattern: '^/$' },
      { host: 'irc-ws.chat.twitch.tv' },
      { host: 'usher.ttvnw.net', pathPattern: '^/api/channel/hls/' },
    ],
    // the RTMP ingest beside the HTTP host: the World records rtmp://127.0.0.1:<port>/app as the twin's `ingest`, the
    // server OBS is given in place of rtmp://live.twitch.tv/app (with the channel's stream key, from the dashboard)
    sidePorts: [{ name: 'ingest', option: 'ingestPort', flag: '--ingest-port', scheme: 'rtmp', path: '/app', note: "Twitch's RTMP ingest (rtmp://<ingest-server>/app/<stream-key>): OBS publishes the channel's broadcast here" }],
    endpointEnvNone: "Twitch's clients address api.twitch.tv, id.twitch.tv and irc-ws.chat.twitch.tv by their published URLs; no SDK reads a base-URL variable",
    // the developer console's application, made with the account that registers it: its client id and secret, and the
    // channel's login, in the names Twitch apps read them by
    credentialDoor: {
      path: '/_twin/console',
      body: { login: 'worldchannel', password: 'world-password', email: 'worldchannel@example.com', application: { name: 'World App', redirect_uris: ['http://localhost:3000'] } },
      fill: { TWITCH_CLIENT_ID: 'client_id', TWITCH_CLIENT_SECRET: 'client_secret', TWITCH_CHANNEL: 'login' },
    },
  },
};
