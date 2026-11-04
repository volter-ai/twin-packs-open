# Reddit spec — provenance

- **Why a written document:** Reddit publishes no OpenAPI document. Its API reference is the page
  https://www.reddit.com/dev/api ("automatically-generated documentation for the reddit API"), read on 2026-10-02 (its
  bytes as fetched: sha256 `87183e602ab2aa70f4f94d21013d1be987a756fdc64596c2cb5e561e7f0bc66c`, 302,690 bytes).
- **`openapi.json`** is that page converted, endpoint by endpoint, with nothing added: each `div.endpoint` of the page is
  one operation (its `h3`'s method and path, the path's placeholders as path parameters, its OAuth scope badge as the
  operation's `security`, its description, and its parameters table as query parameters for a GET or DELETE and as an
  `application/x-www-form-urlencoded` body otherwise; a row naming two parameters, `after / before`, `sr / sr_name`, is
  two). An endpoint whose path carries the optional `[/r/subreddit]` prefix is two operations, one with `/r/{subreddit}`
  in front (OpenAPI has no optional segment). An operation's id is its method and path with every non-word character
  `_` (`POST_api_submit`, `GET_r_subreddit_comments_article`); the page's own anchor is kept as `x-reddit-anchor` and its
  path variants (`→ /user/username/submitted`) as `x-reddit-variants`. The page documents no answer bodies, so every
  operation's 200 says so. 260 operations, 242 paths. Vendored bytes (sha256):
  `1a4baa9ca85b99937c255b0cb69d2b8d962d73fc83950c2ca7905da250b64d24`.
- **Corrections (`patches.json`, 36 patches, each with its reason and its source, checked by derive-pack):**
  - the token endpoint (`POST /api/v1/access_token` on www.reddit.com, HTTP Basic client authentication), which dev/api
    does not list: from Reddit's OAuth2 wiki;
  - the media lease (`POST /api/media/asset.json`), which dev/api does not list and Reddit documents nowhere: it is
    documented only by its answers, the requests and answers PRAW's integration tests recorded against reddit.com
    (2020-12-03 for a video and its poster, 2025-05-07 for an image). **Where the documentation stops:** the lease's
    fields, its S3 form action and bucket, its policy (its conditions, the image range of 1 byte to 20 MiB, the video
    ceiling of 2 GiB, the fifteen-minute expiry), the asset's `processing_state`, and the S3 `PostResponse` an upload
    answers are what those recordings show; Reddit states none of it, and no recording shows the asset's states after
    `incomplete` or Reddit's answer to a media type it does not take;
  - every answer the twin serves (a Link, a Comment, an Account, a Subreddit, a Listing, submit's, comment's and
    site_admin's `{json: {errors, data}}`, a field refusal, an HTTP error): the field sets Reddit answered in those
    recordings (the newest recorded for each), and the thing and listing structure of Reddit's JSON wiki.
- **Pages and answers read** (every one cited by a patch, a handler or the manifest is in `sources.json`):
  - https://www.reddit.com/dev/api — the API reference, converted above;
  - https://github.com/reddit-archive/reddit/wiki/OAuth2 — the token endpoint, its grants, errors and answer, the scopes;
  - https://github.com/reddit-archive/reddit/wiki/JSON — things, listings, Link fields;
  - https://github.com/reddit-archive/reddit/wiki/API — the rules, the rate limit and its headers;
  - Reddit's own server source at the archive's last commit (raw.githubusercontent.com/reddit-archive/reddit/master):
    `r2/r2/controllers/api.py` (POST_submit, POST_comment, POST_del), `r2/r2/controllers/oauth2.py` (POST_access_token),
    `r2/r2/controllers/reddit_base.py` (the bearer token's 401 and 403), `r2/r2/lib/errors.py` (each error's words),
    `r2/r2/lib/validator/validator.py`, `r2/r2/lib/utils/utils.py` (a permalink's slug), `r2/r2/lib/db/_sorts.pyx` (the
    hot rank), `r2/r2/models/link.py` (a self post's length);
  - PRAW v8.0.3's recorded answers (raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/):
    `TestSubreddit.test_submit_image__selftext.json` (2025-05-07), `TestSubreddit.test_submit_video.json` (2020-12-03),
    `TestSubreddit.test_submit__url.json`, `TestSubreddit.test_submit__verify_invalid.json`, `TestSubreddit.test_create.json`,
    `TestSubreddit.test_create__exists.json`, `TestSubreddit.test_create__invalid_parameter.json`,
    `TestSubreddit.test_create__missing_parameter.json`, `TestSubreddit.test_subscribe.json`,
    `TestSubredditFlair.test_update_quotes.json` (GET /api/v1/me, 2020-04-07),
    `TestSubredditCollectionsModeration.test_create__none_layout.json` (a Subreddit, 2021-12-28),
    `TestSubmissionModeration.test_notes.json` (a Comment, 2022-05-01), `TestSubmission.test_reply.json`,
    `TestSubmission.test_upvote.json`, `TestSubmission.test_delete.json`, `TestRedditorListings.test_submissions__new.json`,
    `TestRedditorListings.test_downvoted__other_user.json`, `TestSubredditListings.test_new.json`,
    `TestAuthImplicit.test_implicit__with_invalid_token.json`, `TestInbox.test_message__unauthorized.json`,
    `TestRedditor.test_trophies__user_not_exist.json`; PRAW's own source (`praw/models/media.py`,
    `praw/models/reddit/subreddit/subreddit.py`) and its test of an image over the limit
    (`tests/integration/models/reddit/test_subreddit.py`, S3's `EntityTooLarge` answer); the token's day of life
    (`expires_in` 86400) from the newest password grant recorded (2026-04-13);
  - https://docs.aws.amazon.com/AmazonS3/latest/API/API_Error.html — S3's error codes for the upload bucket.
- **Not read:** Reddit's Data API Wiki on support.reddithelp.com answers 403 to a fetch, so its current limits are read
  from the answers' `x-ratelimit-*` headers instead (1,000 requests a ten-minute window, recorded 2025-05-07).
- **Read by:** the reddit pack's author session, 2026-10-02.
