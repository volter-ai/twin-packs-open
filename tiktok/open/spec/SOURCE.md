# TikTok for Developers: Login Kit, Content Posting API, Display API

- **Why this document:** TikTok publishes no OpenAPI document of these APIs. This one is written from their API
  reference pages on developers.tiktok.com (last updated 2026-08-24, fetched 2026-09-30), one operation per endpoint,
  each naming its page (`externalDocs`):
  - https://developers.tiktok.com/doc/oauth-user-access-token-management (token, refresh, revoke)
  - https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
  - https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info
  - https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
  - https://developers.tiktok.com/doc/content-posting-api-reference-photo-post
  - https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
  - https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide (the upload host's PUT, cancel)
  - https://developers.tiktok.com/doc/tiktok-api-v2-video-list, …-video-query, …-video-object
  The authorize page (https://developers.tiktok.com/doc/login-kit-web) is a screen, not an operation.
- **Its hosts:** open.tiktokapis.com; the upload URL's host, open-upload.tiktokapis.com (the transfer guide's
  whole-upload example; its chunked example names upload.us.tiktokapis.com); www.tiktok.com (the authorize page).
- **Corrections:** none.
- **Read by:** the twin orchestrator, 2026-09-30.
- **Vendored bytes (sha256):** `openapi.json` `d187855935cd1c2877e40154e3d0b3c58393de19c9d7693c58686c5f360dbeac`.
