# twitch spec — provenance

- **Why this document:** Twitch publishes no machine-readable description of the Twitch API (Helix). `openapi.json.gz`
  is written from its reference page, https://dev.twitch.tv/docs/api/reference/, as Twitch serves it (fetched
  2026-10-07 with `twin-standard read-page <url> --raw`, HTML, 1413409 bytes, sha256
  `f0a122a8a2afc0d4856048e749d60410484780d25703df6e70d550d9828b77aa`; the page's `article:published_time` is
  2026-10-01, the document's `info.version`). The bytes are kept here as `reference.html.gz` (gzip -n -9).
- **How it was written:** mechanically from the page's HTML by `page-to-openapi.ts`, kept here
  (`gunzip -c spec/reference.html.gz > page.html; bun spec/page-to-openapi.ts page.html openapi.json`, then
  `gzip -n -9`): every endpoint section the page documents under `https://api.twitch.tv/helix`, 149 operations in 30
  resources.
  - An endpoint is the section whose URL block reads `<METHOD> https://api.twitch.tv/helix/<path>`: the operation
    `<METHOD> /<path>` under the server `https://api.twitch.tv/helix`, its operationId the section's anchor in camel case
    (`send-chat-message` is `sendChatMessage`), its tag the resource the page's first table files it under.
  - Its Request Query Parameters (Parameter, Type, Required?, Description) are query parameters; its Request Body
    (Field, Type, Required?, Description) a JSON body; its Response Body (Field, Type, Description) the 2xx answer. A
    field indented under another (the page indents with non-breaking spaces) is a property of it. A list's `data`
    objects are a schema of their own, `<Operation>ResponseData`, so the derived core reads each as a resource.
  - Types: String, Integer, Int64 (format int64), Boolean, Float, Object, `X[]`, `map[string]X` and the named object
    types (MediaSettings, Guest, Session[]) as objects; a cell naming no type is left untyped. Values a description
    states in prose ("Possible values are: ...") are not carried as enums.
  - Its Response Codes are the answers; a refusal's body is the error object the page's examples answer with
    (`"error": "Bad Request", "status": 400, "message": "user is already banned"`, Ban User's Example Response 3).
  - Its Authorization block is kept as `x-twitch-authorization` (the page's words), the scopes it names in bold as
    `x-twitch-scopes`, and the token types it accepts as `x-twitch-tokens`.
  - Not carried: the page's example requests and answers (copied for the served operations into `doc-examples.json`).
- **SHA-256 of the uncompressed document:** `7c9db84ca10217defb2333e9b7b87b7d6db5b3376c3c8b55df99da39a528ed78`.
- **Corrections:** none.
- **Recordings:** `recordings/2026-10-08-irc-anonymous.json` (sha256
  `8dbff5adc07ba668c62cf86fbb6ad3cfd3c2c0d654a7e430787c5735c2675618`): one anonymous, read-only chat session on
  `wss://irc-ws.chat.twitch.tv:443`, made 2026-10-08T02:58:27Z by Bun 1.4.2's global WebSocket on Windows, sending
  exactly what the stream rig's chat reader sends (`CAP REQ :twitch.tv/tags`, `PASS SCHMOOPIIE`,
  `NICK justinfan48213`, `JOIN #aaronvolter`), then a client `PING :tmi.twitch.tv` and a `PART`. Twitch's chat pages
  document a login only with a user access token (`PASS oauth:<token>`); the anonymous `justinfan` login the rig and
  Twitch's own logged-out player use, and the `PONG` form, are what the recording shows, and only that.
- **Other sources read** (with `twin-standard read-page`, each cited where a rule rests on it): the API guide
  (https://dev.twitch.tv/docs/api/guide/: rate limits, pagination, query parameters), Get Started
  (https://dev.twitch.tv/docs/api/get-started/), the chat pages (https://dev.twitch.tv/docs/chat/irc/,
  https://dev.twitch.tv/docs/chat/), the authentication pages (https://dev.twitch.tv/docs/authentication/ and its
  getting-tokens-oauth, validate-tokens, revoke-tokens, refresh-tokens and scopes pages) and the broadcast guide
  (https://dev.twitch.tv/docs/video-broadcast/).
- **Cited pages:** `sources.json`, check-sources' record of every page a `// source:` line cites.
- **Read:** 2026-10-07, by the twitch twin's builder; derived with `bun $T/scripts/derive-pack.ts ./twitch`, which
  writes `../src/generated/surface.gen.json`.
