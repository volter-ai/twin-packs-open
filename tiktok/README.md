# @volter/twin-tiktok

The TikTok twin (Protocol 3), serving what the customer life walks ([journeys/demand.json](./journeys/demand.json),
[journeys/decisions.json](./journeys/decisions.json)). TikTok publishes no OpenAPI document of these APIs; the open
lane's spec is written from developers.tiktok.com's reference pages (`open/spec/SOURCE.md`).

- **The open lane** (open.tiktokapis.com, open-upload.tiktokapis.com, www.tiktok.com/v2/auth/authorize/):
  - the authorize page, where a TikTok person logs in and consents; the redirect carries `code`, `scopes`, `state`;
  - the token (a code once, a refresh token once; `act.`/`rft.` tokens drawn from the World's secret, kept by SHA-256);
  - user info (fields gated by scope; `video_count` counted from the person's public videos) and creator info;
  - posting: a video directly or to the creator's inbox by chunked upload (the chunk plan checked, the bytes kept as
    blobs), photos pulled from URLs the app verified (through the World: a URL it does not serve fails the pull),
    and the post's status, moved only by `src/semantics/states.ts`;
  - the videos a direct post makes (the Video Object; duration and size read from the MP4's boxes, the cover a
    labeled placeholder), listed newest first by cursor and queried by id.
- **The business lane** (business-api.tiktok.com, `business/spec/SOURCE.md`).
  Every answer is HTTP 200 with TikTok's `code` (0, or 40001/40002/40102/40104/40105/40107/40110/40131):
  - the business app's token (the same authorize page, a code once, a refresh token once, 24-hour access tokens);
  - the account's profile and analytics (`fields` a JSON array) and its public posts' counts, paged by cursor;
  - publishing a video or photos by URL: TikTok pulls them through the World, so a URL nothing in the World serves
    fails the pull (FAILED, `video_pull_failed`/`photo_pull_failed`); the status moves only by `src/semantics/states.ts`;
  - the locations a post may tag and the Commercial Music Library's tracks, searched and listed by genre.

The developer site's app, its redirect URIs and URL properties, TikTok's people and a video's audience are the World's
doors (`POST /_twin/app-credentials`, `/_twin/apps` with `redirect_uris` and `business_redirect_uris`, `/_twin/people`,
`/_twin/videos/{id}/stats`, `/_twin/locations`, `/_twin/tracks`). The credential door answers TIKTOK_CLIENT_ID,
TIKTOK_CLIENT_SECRET, TIKTOK_BUSINESS_CLIENT_ID and TIKTOK_BUSINESS_CLIENT_SECRET.
