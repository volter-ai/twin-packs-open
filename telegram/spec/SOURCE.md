# telegram spec — provenance

- **Why this document:** Telegram publishes no machine-readable description of its Bot API. `openapi.json.gz` is written
  from its reference page, https://core.telegram.org/bots/api, as Telegram serves it (fetched 2026-10-02, HTML,
  860074 bytes, sha256 `9da688c4213864d7911fcf0f501d2d7a8c3bbc351b8b4325e85e509bcc9d969f`; the page's "Recent changes"
  head it **Bot API 10.3**, August 24, 2026).
- **How it was written:** mechanically from the page's HTML by `page-to-openapi.ts`, kept here
  (`gunzip -c spec/bot-api.html.gz > page.html; bun spec/page-to-openapi.ts page.html openapi.json`, then `gzip -n -9`), from the bytes named above, kept here as `bot-api.html.gz`, every
  section of methods and types it documents (Getting updates, Available types, Available methods, Updating messages,
  Stickers, Rich messages, Inline mode, Payments, Telegram Passport, Games): 185 methods and 400 types.
  - A method (an `h4` with a lower-case name and a Parameter/Type/Required/Description table) is
    `POST /bot{token}/<method>` (the page's "https://api.telegram.org/bot<token>/METHOD_NAME"), its operationId the
    method's name, its tag the page's section; its parameters a body taken as JSON, form or multipart, and the same
    parameters again in the query string, none required there (the page's "four ways of passing parameters", the
    first of them the URL query string: node-telegram-bot-api sends a medium's chat_id and caption in the
    query beside its multipart file), `Required: Yes` required in the body; its answer `{ ok: true, result }` with the result the
    method's text says is returned (a linked type, "Array of", True, String or Integer; several, `oneOf`), and any
    other answer the error envelope `{ ok: false, error_code, description, parameters? }` (Making requests).
  - Every type a method's result names (by itself, as an array's items, or as one of several) is declared a resource
    under its own name (`x-resourceId`): it is what the Bot API answers under `result` ("the result of the query can be
    found in the 'result' field", Making requests). The page has no GET read for the spec IR to infer resources from
    (every method is written as a POST), and without them the IR reads no answer through its envelope: with them, each
    such operation answers its type under `answers.key: result`, which perform and refresh read.
  - A type (an `h4` with a capitalized name) is an object of its Field/Type/Description table, a field whose description
    begins "Optional." optional; one described as one of a list of types, a `oneOf` of them. A type cell reads Integer,
    String, Boolean, True, Float, InputFile (binary), "Array of X" and "X or Y"; a string field whose description states
    its values in quotes ("can be", "must be", "one of", "always") takes them as its `enum`.
  - The file download getFile names, `GET /file/bot{token}/{file_path}`, is the operation `downloadFile`.
  - Not carried: that every method is also asked by GET, and that method names are matched without case (the page's
    Making requests); the document declares the POST under the documented name, and the twin's around.ts routes the
    other forms to it.
- **Version:** `10.3` (`info.version`); server `https://api.telegram.org`.
- **SHA-256 of the uncompressed document:** `2517cfd1598ef743219d56788e772d88cc2420538a9d2688d5fd38d429cb023d`
  (`openapi.json.gz` is it gzipped with no name or time, `gzip -n -9`).
- **Corrections:** `patches.json` (RFC 6902, each with its reason and source): `reply_to_message_id` added to the
  bodies and the query parameters of sendMessage, sendPhoto, sendVideo, sendDocument and sendMediaGroup. The page no longer lists it, but the Bot
  API server still reads it when a request carries no `reply_parameters` (tdlib/telegram-bot-api, Client.cpp at
  e3e9dd8), and node-telegram-bot-api 0.66.0 sends it.
- **Grouping:** `grouping.json` (`{ "by": "tag" }`): every path begins `/bot{token}/`, so an operation's family is the
  page's section it is documented in.
- **Other sources read:** the Bot API server's own source, which the page names ("Using a Local Bot API Server"),
  tdlib/telegram-bot-api at e3e9dd8 (Client.cpp, Client.h, ClientManager.cpp, HttpConnection.cpp, Query.cpp), and the
  TDLib it relays errors from, tdlib/td at 42e6a52 (td/telegram/MessageEntity.cpp, MessageContent.cpp,
  MessagesManager.cpp), each read as raw files and cited where the page says nothing (the refusals' words, the token's
  check, getUpdates' limits, the HTML parse mode); https://core.telegram.org/bots/features (BotFather, privacy mode)
  and https://core.telegram.org/bots/faq (the limits), read with `twin-standard read-page`.
- **Cited pages:** `sources.json`, check-sources' record of every page a `// source:` line cites.
- **Read:** 2026-10-02; written again from
  the same bytes with the query parameters, 2026-10-02, and again with
  the answered types' `x-resourceId`, 2026-10-02; derived with
  `bun scripts/derive-pack.ts telegram`, which writes `../src/generated/surface.gen.json`.
