// Telegram's manifest: the vendor facts its spec (../spec, written from the Bot API page) does not carry. Served is what
// the demand's applications call as they ship and what the life reaches (../journeys/demand.json,
// ../journeys/decisions.json): a bot reading itself, removing its webhook and polling for updates (a long poll), showing
// it is typing, sending text, a photo, a video, a document and an album, deleting a message, reading a chat, a chat
// member and a file, and the file's download. Every other method of the page answers the vendor's unknown method. Every
// request names its bot by the token in its path (`/bot<token>/<method>`), checked by ./semantics/around.ts before the
// method is routed, as the Bot API server checks it. People, chats and bots are made in the Telegram app and BotFather,
// which no Bot API method does: the World's doors stand in for them (./semantics/doors.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'telegram',
  service: 'telegram',
  // the four ways the Bot API takes parameters: query, form, JSON and multipart, each read as its content type says
  // source: https://core.telegram.org/bots/api#making-requests "We support four ways of passing parameters in Bot API requests"
  body: {},
  // ids are integers the vendor assigns (a user's, a chat's, a message's per chat); each resource below says its form
  ids: { template: '{prefix}{n}' },
  // source: https://core.telegram.org/bots/api#message "Date the message was sent in Unix time"
  time: 'unix',
  // source: https://core.telegram.org/bots/api#making-requests "In case of an unsuccessful request, 'ok' equals False and the error is explained in the 'description'."
  error: { ok: false, error_code: '{status}', description: '{message}' },
  // the Bot API has no read-only mode; a World started read-only refuses a write with the class of refusal the server
  // gives an act it does not allow (Where the documentation stops: the words are the twin's)
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "error_code = 403;"
  readOnly: { status: 403, message: 'Forbidden: this World was started read-only' },
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/HttpConnection.cpp "return send_http_error(404,"
  notFound: { status: 404, message: 'Not Found' },
  // a method the twin does not serve answers as an unknown method does
  // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Not Found: method not found"
  gap: { status: 404, message: 'Not Found: method not found' },
  // the Bot API pages nothing; getUpdates' limit is the one bounded read
  // source: https://core.telegram.org/bots/api#getupdates "Values between 1-100 are accepted. Defaults to 100."
  list: { style: 'envelope', envelope: { ok: true, result: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: { ok: true, result: true },
  // every method this pack serves is a handler (an RPC wire: no create, read, update or delete of a path), and no
  // declared resource has an operation the core would serve, so nothing is listed unmodeled
  unmodeled: [],
  // getUpdates, getMe, getChat, getChatMember and getFile only read, though asked by POST
  reads: ['getMe', 'getChat', 'getChatMember', 'getFile'],
  // a file's path holds its folder: profile_photos/file_1.jpg
  // source: https://core.telegram.org/bots/api#file "Optional. File path. Use https://api.telegram.org/file/bot<token>/<file_path> to get the file."
  spanning: ['file_path'],
  resources: {
    // a Telegram account, a person's or a bot's, stored as the Bot API answers a User; its id is an integer the vendor
    // assigns, kept as the subject's id and as its own `id`
    // source: https://core.telegram.org/bots/api#user "Unique identifier for this user or bot."
    user: { idPrefix: '58104400', ids: '{prefix}{n}', refresh: { none: 'the Bot API reads no user by id and lists none: getMe answers the bot itself, and a person is seen only in the messages and updates that name them' } },
    // a chat as getChat answers it (ChatFullInfo); a private chat's id is its person's, a group's and a channel's are
    // the vendor's negative ids (minted by the doors that make them)
    // source: https://core.telegram.org/bots/api#chat "Unique identifier for this chat."
    // source: https://raw.githubusercontent.com/tdlib/telegram-bot-api/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp "Bad Request: chat not found"
    chat: { idPrefix: '', ...states.chat, refresh: { get: 'getChat', known: true, query: { chat_id: '{id}' }, gone: { status: 400, says: 'chat not found' } } },
    // one subject per member of a chat, `<chat>:<user>`, stored as getChatMember answers it
    chat_member: { idPrefix: '', ...states.chat_member, refresh: { none: 'the Bot API lists only administrators (getChatAdministrators), and getChatMember reads one member by a user id the World learns only from updates' } },
    // a message, `<chat>:<message_id>`; its message_id counts per chat
    // source: https://core.telegram.org/bots/api#message "Unique message identifier inside this chat;"
    message: { idPrefix: '', refresh: { none: 'the Bot API reads no message back: a bot sees one only as an update or as the answer to its own send' } },
    // an update waiting for its bot, `<bot>:<update_id>`, stored as getUpdates answers it; confirmed, it is gone
    // source: https://core.telegram.org/bots/api#getupdates "An update is considered confirmed as soon as getUpdates is called with an offset higher than its update_id."
    update: { idPrefix: '', refresh: { none: 'reading the queue (getUpdates) confirms what it reads: a refresh would take updates from the application the World serves' } },
    // a stored file (a photo, a video, a document, a chat photo), its bytes the pack's blobs, by its file_unique_id
    // source: https://core.telegram.org/bots/api#file "Unique identifier for this file, which is supposed to be the same over time and for different bots."
    file: { idPrefix: 'AgAD', ids: '{prefix}{letters:12}', refresh: { none: 'getFile reads a file by a file_id the World learns only from messages, and its answer is the download path, not the file' } },
    // a bot's own keeping: its token's SHA-256 and its owner, its updates' counter and the allowed_updates it last asked for
    _bot: { idPrefix: '' },
    // the ids the vendor assigns to a basic group and to a channel or supergroup, and a file's download path
    _group: { idPrefix: '-49870000', ids: '{prefix}{n}' },
    _channel: { idPrefix: '-10019876540', ids: '{prefix}{n}' },
    _file_path: { idPrefix: 'file_', ids: '{prefix}{n}' },
    _media_group: { idPrefix: '137292810', ids: '{prefix}{n}' },
  },
  doors: [
    { id: 'people', method: 'POST', path: '/_twin/people', note: '{ first_name, last_name?, username?, language_code? }: a Telegram account, as a person signs up in the app' },
    { id: 'bots', method: 'POST', path: '/_twin/bots', note: "{ owner?, name?, username? }: BotFather's /newbot, for the person `owner` (a user id): the bot and its token; the same username answers the same bot" },
    { id: 'botToken', method: 'POST', path: '/_twin/bots/{username}/token', note: "{ owner }: BotFather's /token: a new token, the old one revoked" },
    { id: 'chats', method: 'POST', path: '/_twin/chats', note: '{ creator, type: group | supergroup | channel, title, username?, description?, photo? (base64 bytes), members?: [{ user, status?: member | administrator, rights? }] }: a person makes a chat in the app' },
    { id: 'members', method: 'POST', path: '/_twin/chats/{chat_id}/members', note: '{ by, user, status: member | administrator | kicked, rights? }: a person adds, promotes or removes a member in the app' },
    { id: 'messages', method: 'POST', path: '/_twin/messages', note: "{ from, chat (a chat id, a chat's @username, or a bot's @username for a private chat with it), text, reply_to_message_id? }: a person writes in the app" },
  ],
  // the API's limits (https://core.telegram.org/bots/faq): a bot broadcasts about 30 messages a second; the kernel's
  // bound is 20 a second, so the World spends at most that
  // source: https://core.telegram.org/bots/faq "bots are not able to broadcast more than about 30 messages per second"
  rateBudget: {
    allowance: { perMinute: 1800, source: 'https://core.telegram.org/bots/faq' },
    reason: "Telegram's FAQ: about 30 messages a second for bulk notifications, one a second in a single chat, 20 a minute in a group (https://core.telegram.org/bots/faq). The World stays at the kernel's bound of 20 a second over a one-minute window (1000).",
    windowMs: 60_000, ceiling: 1000, defaultWeight: 1, maxRetryAfterSeconds: 300,
  },
  discovery: {
    twinOf: "Telegram's Bot API as bots use it: a bot reading itself, polling for its updates (a long poll), typing, sending text (plain, HTML, MarkdownV2 or Markdown), photos, videos, documents and albums, deleting messages, reading chats, members and files, and downloading a file",
    stores: 'people and bots (tokens by their SHA-256), chats with their members, messages, the updates waiting for each bot, and files (their bytes as blobs)',
    identity: 'the bot token in the path: https://api.telegram.org/bot<token>/<method> (the bots door, standing in for BotFather, issues it)',
  },
  descriptor: {
    protocol: '3',
    transport: 'web-api',
    archetype: 'crud',
    bin: 'world-telegram',
    resources: ['user', 'chat', 'chat_member', 'message', 'update', 'file'],
    specSource: 'the Telegram Bot API page (https://core.telegram.org/bots/api, Bot API 10.3), written as OpenAPI in spec/ (provenance in spec/SOURCE.md)',
    description: "Telegram Bot API twin — a bot's updates by long polling, its messages (text, HTML, MarkdownV2, photos, videos, documents, albums), chats, members and files, as Volter Harness's Chat SDK channel calls them.",
    adoption: { sdks: ['@chat-adapter/telegram', 'node-telegram-bot-api', 'telegraf'], envStems: ['TELEGRAM'] },
    // the libraries above name Telegram in an application; none is Telegram's own
    // source: https://core.telegram.org/bots/samples "these projects are not maintained by Telegram"
    clientCasesNone: 'Telegram publishes no client library of its own (its samples page lists libraries others maintain): the demand applications call the Bot API through the Chat SDK adapter (Volter Harness)',
    hosts: [{ host: 'api.telegram.org' }],
    // the Chat SDK's adapter reads TELEGRAM_API_BASE_URL as its API's base URL (@chat-adapter/telegram 4.39.0, dist/index.js:1039)
    endpointEnv: { name: 'TELEGRAM_API_BASE_URL', note: "the Chat SDK's Telegram adapter reads it as its API base (@chat-adapter/telegram 4.39.0, dist/index.js:1039); node-telegram-bot-api takes a baseApiUrl option only, and reaches the twin by its host" },
    credentialDoor: { account: { field: 'account', tenancy: 'Telegram person', source: 'https://core.telegram.org/bots/features#botfather' }, deployment: { field: 'deployment', object: 'Bot', source: 'https://core.telegram.org/bots/features#botfather' },  path: '/_twin/bots', body: {}, fill: { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_TOKEN: 'token', TELEGRAM_BOT_USERNAME: 'username', TELEGRAM_BOT_NAME: 'username' } },
    // the bot token rides in the path, after /bot (the API's) or /file/bot (a file's download)
    // source: https://core.telegram.org/bots/api#making-requests "https://api.telegram.org/bot<token>/METHOD_NAME"
    auth: { in: 'path', pattern: '/(?:file/)?bot([^/]+)/' },
  },
};
