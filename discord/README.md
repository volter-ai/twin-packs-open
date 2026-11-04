# @volter/twin-discord

The Discord twin (Protocol 3), serving what the demand's applications call as they ship
([journeys/demand.json](./journeys/demand.json), [journeys/decisions.json](./journeys/decisions.json)): Open
Autonomy's Discord channel (its setup and Hermes, the agent its kit runs, on discord.py), Volter Harness's Discord
platform (the Chat SDK's adapter, on discord.js), Cal.com's Discord webhooks and the Gateway a
World finds with `GET /gateway/bot`. Twenty and LibreChat use Discord only when a setting turns it on; they are listed
in the demand's `optional` and what only they call is the gap. The spec is Discord's own OpenAPI document for API v10 (`spec/SOURCE.md`); `/api` and
`/api/v9` are served as `/api/v10`, with v10 response shapes (the manifest's `basePathAlias`).

- **OAuth2:** the authorize page (a person logs in, picks a server for a bot install, authorizes or cancels; a bot-only
  install link ends on the page), the token URL (codes and refresh tokens spent once, a bot install's answer carrying
  its guild; Basic or form credentials), the current authorization, and a bot's own user and application (with its
  owner), as a library reads them when it logs in.
- **Slash commands:** an application's global chat-input commands listed (localization dictionaries only with
  `with_localizations`), created (a name already used overwrites that command, 200), edited and deleted, each change a
  new version, checked as Discord's application-commands page states (names, descriptions, 25 options and choices,
  required options first, 100 commands, a name another command has): what Hermes's command sync does on every start.
- **Interactions:** command, component and autocomplete delivery on the Gateway; token-authenticated callbacks,
  immediate messages, private deferred replies, component updates and autocomplete. The callback optionally returns
  its response object (`with_response`). The original response is edited or deleted through its token, and a followup
  sent with it. The initial reply must arrive in three seconds; the token expires after fifteen minutes. A private
  (ephemeral) response stays out of channel history and Gateway message broadcasts. A public deferred response is a
  message the interaction created, LOADING until edited ([receiving and
  responding](https://docs.discord.com/developers/interactions/receiving-and-responding): "ID of the message that was
  created by the interaction", "Whether the message is in a loading state"; [message
  flags](https://docs.discord.com/developers/resources/message): "this message is an Interaction Response and the bot
  is “thinking”"). Where the documentation stops: neither page says the loading message is in the channel's history
  and its Gateway broadcasts; the twin keeps it there, as it keeps any public message.
- **Servers:** channels, roles and members under Discord's documented permission computation (roles, @everyone and
  channel overwrites); a bot joins with its managed role holding the permissions it asked. A member search and the
  bot's nickname.
- **Channels and messages:** a channel read; JSON or multipart with `payload_json` and `files[n]`, replies, mentions
  under `allowed_mentions`, an edit by its author, a thread on a message (its id the message's), a channel's messages
  read back newest first with their reactions; a bot's reactions added and taken back; a typing indicator (answered,
  not kept).
- **Webhooks and invites:** a channel's incoming webhook executed by its URL (`wait`, `thread_id`); invites, a similar
  open one reused unless `unique`. A server's webhooks and invites, the bot's application and its servers are read
  back (what a vendor-backed refresh reads).
- **The Gateway** (the kernel's sockets): HELLO, heartbeats, IDENTIFY with intents (privileged ones only when the
  portal turned them on), READY and GUILD_CREATE, then MESSAGE_CREATE and MESSAGE_UPDATE, THREAD_CREATE,
  MESSAGE_REACTION_ADD and MESSAGE_REACTION_REMOVE as the World's writes happen, and GUILD_CREATE when the bot joins a
  server. `GET /gateway/bot` answers the twin's own socket, and a library that dials Discord's Gateway host
  (gateway.discord.gg, as discord.py does) reaches the same socket there. RESUME is answered INVALID_SESSION. Typing
  Start is not sent.

The Developer Portal and the Discord client are the World's doors (`POST /_twin/app-credentials`, `/_twin/people`,
`/_twin/guilds`, `/_twin/invites/{code}/accept`, `/_twin/channels/{channel}/messages`,
`/_twin/channels/{channel}/messages/{message}/reactions`, `/_twin/channels/{channel}/interactions`). The credential door answers
DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID
and DISCORD_PUBLIC_KEY.

Left out, answered as Discord answers a route it does not have: every operation of the spec the manifest lists in
`unmodeled`, the client credentials grant, the implicit grant and the `webhook.incoming` authorization; guild
commands, the bulk overwrite of an application's commands, the user, message and entry point command types, and the
daily limit of 200 command creates; reading the original response, and reading, editing or deleting a followup, by an interaction's or webhook's token; HTTP-delivered interaction signatures, modal submission, Activities and user-installed interaction flows; of Hermes's Discord connector, what it does beyond logging in, syncing its slash
commands and answering a message (the bulk sync policy, its thread rename, its Discord
tools' server, member, pin and role actions, voice, forums and DMs; journeys/demand.json's `measured`). The CDN
(cdn.discordapp.com) is not served: an attachment's URL names its file. Discord maintains no official SDK, so the pack
has no client cases (the descriptor's `clientCasesNone`). The published examples are Discord's pages' own
(`spec/doc-examples.json`), replayed in [journeys/vendor-examples.json](./journeys/vendor-examples.json).
