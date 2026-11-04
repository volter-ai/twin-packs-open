# @volter/twin-youtube

A local YouTube Data API v3 for a game studio's launch tooling and for Dub's partner statistics: a channel, its videos
uploaded by Google's resumable protocol or one multipart request, read back and edited, live broadcasts bound to a
stream an encoder publishes to over RTMP, their live chat, and the community's comment threads, replies and
moderation. Requests use synthetic Google accounts and the World's own credentials; no real Google account is needed.

## Use it in a World

Choose this package's exact release in the [catalog](https://world.volter.ai/twins/youtube).
Its Setup tab supplies release-specific installation and World initialization commands.
Review the selected vendor, retain its package/version and lockfile, and run the app through
the World. [First local World](https://world-docs.volter.ai/docs/getting-started) explains the shared workflow.

YouTube reads Google OAuth's tokens: run the `googleoauth` twin beside this one (its account chooser at
`accounts.google.com/o/oauth2/v2/auth` and its token endpoint at `oauth2.googleapis.com/token`), which issues every
access token this twin accepts (the descriptor's `credentialIssuer`).

## SDK workflow

`journeys/first-use.json` signs a person in with Google and uploads a video, with no SDK, as YouTube's server-side web
app guide has an application do it: Google's authorize page (the googleoauth twin's account chooser) with the YouTube
scopes and offline access, the person's choice of account, the code traded at `oauth2.googleapis.com/token` for an
access token and a refresh token, `channels.list mine=true`, a resumable upload (201, uploaded), and a read-back with
the access token the refresh token renews (processed). Readback reads the video with the project's API key.

Environment: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YOUTUBE_API_KEY` are googleoauth's credential door's, as
Google Cloud's Credentials page issues them (the application's OAuth client with its loopback redirect
`http://localhost:3000/oauth2callback`, the World's person, sub `100000000000000000001`, and the project's API key,
which Dub's partner-statistics cron sends as `X-Goog-Api-Key`). `YOUTUBE_CHANNEL_ID` is this twin's credential door's,
that person's channel. YouTube issues no credential: it reads Google's tokens and keys across packs, and takes a key
only on the list methods that read public data (`channels.list`, `videos.list`, `commentThreads.list`). Every other person
signs in the same way; their Google account is googleoauth's account door's and their channel this twin's
(`POST /_twin/channels { sub, title, handle? }`), as YouTube asks of an account before it uploads or streams. Each
operation takes the scopes its Discovery method names (403 insufficientPermissions otherwise).

## Data and behavior

Stored: channels, videos (their bytes as the pack's blobs), resumable upload sessions, live broadcasts and their
chats, live streams, chat messages, comment threads and comments. A video is answered `uploaded` at the upload's end
and is then processed (an empty file fails); the twin decodes no media, so a video's duration is `P0D`. A broadcast's
transition answers `testStarting` or `liveStarting` and then settles on `testing` or `live`; both need the bound
stream active, which only an encoder's RTMP publish to the stream name makes (the kernel's live ingest, the side port
`ingest`, `rtmp://127.0.0.1:<port>/live2`). Completing a broadcast ends its chat.

The audience is the World's doors: views and likes on a video and a comment from someone outside the World
(`POST /_twin/videos/{id}/audience`), a chat line from outside (`POST /_twin/live-chats/{liveChatId}/audience`) and a
channel's subscribers (`POST /_twin/channels/{id}/audience`).

## Scope and limits

Served (handlers): `channels.list`; `videos.insert` on the upload path (`uploadType=resumable` and `multipart`) and its
resumable session's `PUT`; `videos.list` (by id) and `videos.update`; `liveStreams.insert` and `list`;
`liveBroadcasts.insert`, `list`, `bind` and `transition`; `liveChatMessages.list`, `insert` and `delete`;
`commentThreads.list` and `insert`; `comments.insert` and `setModerationStatus`. Every other operation of the
Discovery document, and the variants no demand asks (`uploadType=media`, `chart`, `myRating`, `forHandle`, poll
messages, DASH and HLS ingestion, `onBehalfOfContentOwner`), answer Google's 404. Not served: thumbnails, playlists,
subscriptions, search, captions, the HLS playback of a broadcast. The OAuth endpoints are the googleoauth twin's.

The catalog's Evidence tab records actual measured journeys and their exact tool versions.

## Package facts

Protocol 3; the vendor's Discovery document and its OpenAPI conversion are in spec/, provenance in spec/SOURCE.md.
Apache-2.0, Node 22.3 or later, `@volter/world-core` as its peer; issues at https://github.com/volter-ai/twin-packs-p3.
Contributor mechanics belong to the [pack procedure](https://world-docs.volter.ai/docs/contributing/architecture#creating-a-pack).
