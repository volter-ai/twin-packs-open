# Instagram Platform: the Instagram API with Instagram Login

- **Why this document:** Meta publishes no OpenAPI document of the Instagram Platform. `openapi.json` is written from
  its documentation pages on developers.facebook.com (each page "Updated" in 2026; read 2026-10-27, the latest API
  version they name is v26.0), one operation per method and path, each naming its page (`externalDocs`):
  - https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
    (the authorization window, the code exchange on api.instagram.com, the long-lived token and its refresh)
  - https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started
    (the first calls: /me and /<IG_ID>/media, the User fields)
  - https://developers.facebook.com/documentation/instagram-platform/overview (hosts, permissions, IDs, /me)
  - https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize
  - https://developers.facebook.com/documentation/instagram-platform/reference/access_token
  - https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token
  - https://developers.facebook.com/documentation/instagram-platform/reference/me
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container
  - https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
  - https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-comment/replies
  - https://developers.facebook.com/documentation/instagram-platform/content-publishing (the publishing steps, the
    container statuses, Reels)
  - https://developers.facebook.com/documentation/instagram-platform/comment-moderation
  - https://developers.facebook.com/documentation/instagram-platform/insights
  - https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes
  - https://developers.facebook.com/docs/graph-api/guides/error-handling (the Graph API error body and its codes)
  - https://developers.facebook.com/docs/graph-api/overview/rate-limiting (the Instagram Platform's call count)
  The authorization window (`www.instagram.com/oauth/authorize`, and `api.instagram.com/oauth/authorize` on the
  reference page) is a screen, not an operation; the CDN that serves a media's file is a content screen.
- **One path per node:** the Graph API addresses every node at its ID, so `GET`, `POST` and `DELETE /{id}` are one
  operation each (`getNode`, `updateNode`, `deleteNode`) over the IG User, IG Container, IG Media and IG Comment
  references; `x-resourceId` marks the three stored types (container, media, comment). Families are by tag
  (`grouping.json`).
- **Its hosts:** graph.instagram.com (every Graph call, its version prefix `/v26.0` optional), api.instagram.com (the
  code exchange), www.instagram.com (the authorization window), scontent.cdninstagram.com (media files).
- **Out of this document:** the Instagram API with Facebook Login and Unified Login (graph.facebook.com), resumable
  uploads (rupload.facebook.com, Facebook Login only), messaging, mentions, hashtag search, stories, live media, the
  IG User's own insights, webhooks.
- **Wording:** every description and summary is the pack's own paraphrase of the pages (they carry no open licence);
  the facts are theirs, no sentence is copied. The code cites the pages themselves, in short quotes.
- **Corrections:** none.
- **Read by:** the instagram pack's builder, 2026-10-27, each page through `twin-standard read-page`.
- **Vendored bytes (sha256):** `openapi.json` `fc7560c0530ab8defb0f4065c0a2909a24647f94b9e1af7c01526a553d044987`.
