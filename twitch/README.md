# @volter/twin-twitch

A local Twitch for rehearsing a stream: OBS streams RTMP into the twin and twitch.tv's own pages play it back as HLS,
with the channel's live chat beside it. Built first for an AI VTuber's stream rig (OBS, an anonymous chat reader, and a
program of simulated viewers that chat through the API), which rehearses against it instead of live Twitch.

## Use it in a World

Choose this package's exact release in the [catalog](https://world.volter.ai/twins/twitch).
Its Setup tab supplies release-specific installation and World initialization commands.
Review the selected vendor, retain its package/version and lockfile, and run the app through
the World. [First local World](https://world-docs.volter.ai/docs/getting-started) explains the shared workflow.

The World records the twin's RTMP ingest as `rtmp://127.0.0.1:<port>/app` (the twin's `ingest` side, `volter-world url
<world> twitch.ingest`). Point OBS's custom server there, in place of `rtmp://live.twitch.tv/app`, with the channel's
stream key from the creator dashboard (Settings, Stream: Primary Stream key).

## SDK workflow

Twitch publishes no SDK; its clients send plain HTTPS and WebSocket frames. `journeys/first-use.json` is Twitch's
[Get Started](https://dev.twitch.tv/docs/api/get-started/): an app access token from the client credentials grant
(`POST https://id.twitch.tv/oauth2/token`), validated (`GET /oauth2/validate`: no login, no user), then the channel read
through Get Users (`/helix/users?login=`), Get Channel Information and Get Streams, each with `Authorization: Bearer
<token>` and `Client-Id`. It asserts the channel's numeric id and login, no email for an app token, and the channel
offline; its readback reads the same user and channel again with the saved token.

Environment: `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and `TWITCH_CHANNEL`, filled by the World's credential door
(`POST /_twin/console`: an account signed up and an app registered in the developer console, the same at every boot).

## Data and behavior

Stored state is synthetic and Twitch-shaped: accounts (Get Users' shape) and their channels, a live broadcast's stream
(present only while the encoder publishes), chat messages, applications, and every credential by its SHA-256 (a stream
key is drawn from the World's secret and never stored). A broadcast's recording is the kernel's live media: its
segments are the World's blobs, so a branch carries what was broadcast. Viewers on a live stream are the World's
`audience` door. Inspect the result on the pages: `www.twitch.tv/<login>`, its chat popout, and
`dashboard.twitch.tv/u/<login>/stream-manager`.

The twin serves:
- **Pages** (twitch.tv's own, in its dark skin): the log-in; a channel's page with world-ui's `LivePlayer` playing the
  broadcast, the title, category, LIVE badge, viewers and uptime, and the chat, both kept current on an open page by
  world-ui's `LiveRegion`; the chat popout; the stream manager (stream preview, live status and viewers, Edit Stream
  Info's title and category, My Chat); the stream key settings (Show, Copy); twitch.tv's root and host moves.
- **id.twitch.tv** (the `id` lane): the authorize page (log in, Authorize, Cancel and the documented redirects), the
  token endpoint (client credentials, authorization code, refresh token), validate and revoke.
- **Helix** (`api.twitch.tv/helix`): Get Users, Get Channel Information, Modify Channel Information, Get Streams, Get
  Stream Key, Search Categories (the categories the reference's examples name) and Send Chat Message. Every other
  reference operation answers Twitch's 404.
- **Chat**: IRC on WebSocket at `irc-ws.chat.twitch.tv`: the tags capability, the anonymous `justinfan` login, JOIN
  (JOIN, 353, 366), PART, PING, and every message sent to a joined channel as a PRIVMSG, tagged.
- **Video**: the RTMP ingest (`rtmp://.../app/<stream key>`, `?bandwidthtest=true` recorded and shown to no one) and
  the broadcast as HLS on `usher.ttvnw.net`.

Stop and resume keep everything recorded; reset discards it.

## Scope and limits

- No journey step speaks RTMP yet, so the customer life walks every act but the encoder's publish; the ingest path
  (`semantics/live.ts`, the audience door, a page's live view) is recorded unreachable for a walk.
- Not served: EventSub, follows, raids, subscriptions, moderation and every other Helix operation (the gap); IRC login
  with a user token, sending chat over IRC, and the `twitch.tv/commands` and `twitch.tv/membership` capabilities (NAK);
  Twitch's own server PING; the implicit and device code grants; a playback access token, other renditions, ads and
  past broadcasts; an already-authorized app's skipped consent (the page asks again).
- Users' pictures and box art are Twitch's image-host URLs the twin does not serve; its pages draw avatars.
- Generated surface counts are not an SDK claim. The catalog's Evidence tab records actual measured journeys and their
  exact tool versions.

## Package facts

Protocol 3. The Twitch API (Helix) written from Twitch's reference page in `spec/` (provenance in `spec/SOURCE.md`, by
`spec/page-to-openapi.ts`); id.twitch.tv's endpoints in `id/spec/` (`id/spec/SOURCE.md`). Apache-2.0, Node >= 22.3, on
`@volter/world-core` and `@volter/world-ui` with live media. Contributor mechanics belong to the
[pack procedure](https://world-docs.volter.ai/docs/contributing/architecture#creating-a-pack).
