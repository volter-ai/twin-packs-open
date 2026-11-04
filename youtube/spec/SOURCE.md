# YouTube Data API v3 — the vendored spec

**Files:**

- `discovery.json` — the YouTube Data API v3 Google API Discovery document, the vendor's machine-readable description of
  the API and the document Google's generated clients (`googleapis`, `@googleapis/youtube`) are built from. Google
  publishes no OpenAPI document for this API.
- `openapi.json` — the OpenAPI contract converted from those bytes with twin-world's
  `scripts/spec-discovery-to-openapi.ts`:
  `bun ../twin-world/scripts/spec-discovery-to-openapi.ts youtube/spec/discovery.json youtube/spec/openapi.json --fetched 2026-10-27`
  (99 operations, 209 schemas; each upload method's simple path `/upload/youtube/v3/...` and resumable path
  `/resumable/upload/youtube/v3/...` its own operation).

**Upstream:** `https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest` (fetched 2026-10-27, HTTP 200), the
Discovery service's entry for the API (https://developers.google.com/discovery/v1/reference/apis). Google publishes a
revision rather than a repository commit.

**Version:** `v3`, `revision` `20261026`; `rootUrl` `https://youtube.googleapis.com/`, `servicePath` empty,
`batchPath` `batch`.

**sha256:**

- `discovery.json` (the vendor's bytes, 524,163 bytes): `eda70829862697e916f4b2a79438185c2c2ce2200aa4f011e14c01d78b90ef5e`
- `openapi.json` (the conversion, 1,642,852 bytes): `2b76814495665602db4b723a7af6332093971f3e03a4ec8cb68435472e080571`

**Grouping:** `grouping.json` groups by tag: every path shares `youtube/v3`, and the converter tags each operation with
its Discovery resource (`videos`, `liveBroadcasts`, ...), so a family is a resource.

**Corrections** (`patches.json`): the resumable session's PUT, and the operations' scopes. The Discovery document names `videos.insert`'s resumable protocol but not the
resumable session's own requests; the resumable upload guide's step 3 uploads the file with a `PUT` to the session URI
the step 1 `POST` answered (`/upload/youtube/v3/videos?uploadType=resumable&upload_id=…`), and step 4.1 asks an
interrupted upload's progress with an empty `PUT` there. The patch adds that `PUT` as `youtube.videos.insert.upload`,
citing https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol ("PUT UPLOAD_URL HTTP/1.1").

**Scopes:** the conversion keeps each Discovery method's OAuth scopes as `x-discovery-scopes`, not as OpenAPI
`security`, so the derived surface would name none. 96 patches restore them: `components/securitySchemes` (`Oauth2`, the
Discovery document's `auth.oauth2` scopes) and, for each of the 95 operations that names scopes, `security:
[{ Oauth2: <its x-discovery-scopes> }]`, each citing its own `x-discovery-scopes` (`spec:` pointer into the vendored
document); the PUT the first patch adds carries videos.insert's. The pack's credential check (`src/semantics/around.ts`)
refuses a token holding none of an operation's scopes. Fixing the converter to emit `security` (as twin-world's
Discovery reader already does) would make these patches unnecessary.

**Documentation read** (each with twin-standard's `read-page`, never by calling the API; the citations are recorded in
`sources.json`):

- https://developers.google.com/youtube/v3/getting-started — quota (10,000 units a day)
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol — the resumable session
- https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps — the YouTube scopes
- https://developers.google.com/youtube/v3/guides/implementation/pagination — page tokens
- https://developers.google.com/youtube/v3/docs/core_errors — Google's error body and its global errors
- https://developers.google.com/youtube/v3/docs/errors — YouTube's errors by method
- https://developers.google.com/youtube/v3/docs/videos, /videos/insert, /videos/list, /videos/update
- https://developers.google.com/youtube/v3/docs/channels, /channels/list
- https://developers.google.com/youtube/v3/live/docs/liveBroadcasts, /liveBroadcasts/insert, /list, /bind, /transition
- https://developers.google.com/youtube/v3/live/docs/liveStreams, /liveStreams/insert, /list
- https://developers.google.com/youtube/v3/live/docs/liveChatMessages, /liveChatMessages/list, /insert, /delete
- https://developers.google.com/youtube/v3/docs/commentThreads, /commentThreads/list, /insert
- https://developers.google.com/youtube/v3/docs/comments, /comments/insert, /comments/setModerationStatus

**Read by:** the YouTube twin builder (Claude), 2026-10-27.
