# @volter/twin-telegram

The Telegram Bot API twin (Protocol 3). Its surface is the Bot API page written as OpenAPI (`spec/`, provenance in
`spec/SOURCE.md`); what it serves and why is its manifest, its decision table (`journeys/decisions.json`) and its
semantics.

## What it serves, and for whom

The calls the demand's applications make (`journeys/demand.json`): Volter Harness's Telegram channel (the Chat SDK's
`@chat-adapter/telegram`, polling).

- A bot reads itself (`getMe`), removes its webhook (`deleteWebhook`) and polls for its updates (`getUpdates`: offset,
  limit, allowed_updates, and a timeout that holds the request until an update arrives, a long poll).
- It shows it is typing (`sendChatAction`), sends text (`sendMessage`: plain, HTML, MarkdownV2 or the legacy Markdown,
  parsed as the Bot API server parses them; a reply), a photo, a video, a document (`sendPhoto`, `sendVideo`,
  `sendDocument`: uploaded, or a file_id sent again; Volter Harness's board sends a done card's files this way, the
  notice a MarkdownV2 caption) and an album (`sendMediaGroup`), and deletes a message (`deleteMessage`, by the page's
  rules).
- It reads a chat (`getChat`), a member (`getChatMember`) and a file (`getFile`), and downloads the file
  (`GET /file/bot<token>/<file_path>`).
- A chat's access is checked as the Bot API server checks it (a private chat only once the person started the bot; a
  group, a supergroup or a channel only while the bot is in it; a channel post only by an administrator that may post).
- What a bot is sent follows privacy mode: in a group where it is a plain member, the service messages, commands meant
  for it, a general command after its own last post and replies to it (not a plain mention); everything when it is an
  administrator; every post in a channel it is in.

Every request names its bot by the token in its path; a token BotFather did not issue, or one it has replaced, is
refused before the method is routed. Every other method of the page answers `404 Not Found: method not found`.

## Doors

What people do in the Telegram app and in BotFather, which no Bot API method does (`/_twin/`):

- `POST /_twin/people`: a Telegram account.
- `POST /_twin/bots`: BotFather's /newbot, the bot and its token (the World's credential door: `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_BOT_NAME`); `POST /_twin/bots/{username}/token`: /token, a new
  token that revokes the one before.
- `POST /_twin/chats`: a group, supergroup or channel made (with a photo, members, administrators).
- `POST /_twin/chats/{chat_id}/members`: a member added, promoted or removed.
- `POST /_twin/messages`: a person writing in a chat, or to a bot in private.

The World points the Chat SDK adapter at the twin with `TELEGRAM_API_BASE_URL`; node-telegram-bot-api reaches it by its
host, `api.telegram.org`.

## Left out

- Webhooks (`setWebhook`, `getWebhookInfo`): no application of the demand sets one, so getUpdates never meets one.
- Editing messages, reactions, inline keyboards and callback queries, stickers, payments, inline mode, games, business
  and passport methods, forum topics, and every other method of the page.
- A medium sent by an HTTP URL, which Telegram downloads: a World lets the twin reach nothing outside it, so it answers
  as Telegram does for a URL it could not get.
- A photo's other sizes (the twin keeps the one it was given), thumbnails, and a video's frames beyond its header.
- The 3-second hold the server puts on a repeated short poll, and a second poller's conflict.
