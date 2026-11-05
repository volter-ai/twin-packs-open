# X spec — provenance

- **File:** `openapi.json.gz`, X's own OpenAPI document, the vendor's bytes unchanged and gzipped (`gzip -9 -n`):
  OpenAPI 3.0.0, `info.title` "X API v2", `info.version` `2.168`, 159 paths and 195 operations under
  `https://api.x.com` (its one `servers` entry). One vendor, one document: the API and its authorization server are
  this one pack.
- **Upstream:** https://api.x.com/2/openapi.json (the document's own `getOpenApiSpec` operation), fetched 2026-09-28
  with one unauthenticated GET and no X account or credential. Version 2.167 of the same document was recorded on
  2026-08-21.
- **SHA-256 of the vendor's bytes** (uncompressed): `dd1471ce6666371120b300f5f5ab694085f14c4901be97c5f53fa0e6bf681c9a`.
- **License:** the document names the X Developer Agreement and Policy
  (https://developer.x.com/en/developer-terms/agreement-and-policy.html); it is vendored unmodified and corrected only
  by `patches.json`.
- **Corrections:** `patches.json` (RFC 6902, each with its reason and evidence, checked by
  `twin-standard check-sources x` into `sources.json`), applied before the IR, in two parts:
  - the 48 field corrections retained in `patches.json`, because they correct the one document to the
    wire both packs answer: the fields parameter's wire name `tweet.fields` beside the document's `post.fields`, the
    full Post field list, and the User's `most_recent_tweet_id` and `pinned_tweet_id` in `user.fields`, its
    `expansions` and its schema, which reach GET /2/users/me;
  - this pack's 6: X's OAuth endpoints, which the v2 document does not list. `POST /2/oauth2/token` (the document
    names it only as its `OAuth2UserToken` scheme's `tokenUrl`) and `POST /2/oauth2/revoke`, from the OAuth 2.0
    Authorization Code Flow with PKCE page (https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token);
    the OAuth 1.0a `POST /oauth/request_token`, `POST /oauth/access_token` and `POST /1.1/oauth/invalidate_token`
    (and its `.json` form, which the page's own example request posts to), from the OAuth API reference
    (https://docs.x.com/fundamentals/authentication/api-reference). Each is patched in with the method, path and form
    parameters its page documents and no response schema: X documents none for them as JSON. They carry no
    operationId (X's pages give none), so the IR names them by method and path (`post_2_oauth2_token`,
    `post_oauth_request_token`, …).
- **Read by:** `twin-standard derive x`, which writes `../src/generated/`.
- **Not in this document, and not operations:** the hosted pages an application sends its user through, which this
  pack serves as screens (`../src/screens/`): x.com's OAuth 2.0 authorize screen at `/i/oauth2/authorize` (the page
  the Authorization Code Flow documents, https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code;
  the document's own `authorizationUrl` names `https://api.x.com/2/oauth2/authorize`, which X's pages and both
  official SDKs do not use, a discrepancy the manifest keeps as `x.authorize.openapi_authorize_host`) and
  api.x.com's OAuth 1.0a `GET oauth/authorize` and `GET oauth/authenticate`.
- **Not modelled, outside the count:** the app-only bearer flow (`POST /oauth2/token`, `POST /oauth2/invalidate_token`,
  which the API reference documents) and the v1.1 API.

## Published documentation examples

doc-examples.json records the request bodies and URLs from:
- https://docs.x.com/fundamentals/authentication/api-reference (request-token, access-token, redirect and PIN flows).
- https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token (public and confidential code/refresh grants, bulk lookup).
- https://docs.x.com/x-api/posts/manage-tweets/introduction (basic post, reply, quote, uploaded photo, poll, paid partnership and label lookup).
- https://docs.x.com/x-api/articles/introduction (My first Article draft and publication).
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked (initialize, append, finalize, STATUS, attached video and duration refusal).

The rules X's pages state are examples too, each replayed as the answer it causes (read on 2026-10-17):
- https://docs.x.com/x-api/fundamentals/response-codes-and-errors (an unknown credential's 401, a query parameter an endpoint does not take, an unknown user's 404, its published partial errors, a token body labelled JSON that does not parse, a protected account's post).
- https://docs.x.com/x-api/fundamentals/pagination (the initial request, the next page and a previous_token back) and https://docs.x.com/x-api/posts/timelines/integrate (exclude retweets and replies).
- The API reference pages, which render the spec: https://docs.x.com/x-api/users/get-posts (max_results, start_time, end_time, exclude and pagination_token), https://docs.x.com/x-api/posts/get-post-by-id (the Post fields list), https://docs.x.com/x-api/posts/create-post (the body's fields, reply, media and their ids), https://docs.x.com/x-api/media/initialize-media-upload, https://docs.x.com/x-api/media/append-media-upload, https://docs.x.com/x-api/articles/create-draft-article and https://docs.x.com/x-api/articles/publish-article.
- https://docs.x.com/x-api/posts/manage-tweets/introduction (media uploaded before it is attached; a self-serve App's reply nobody summoned), https://docs.x.com/x-api/media/introduction (WEBP among the image formats, a file that is none of them, the 0.5-second minimum video) and the chunked guide's order (all chunks before one finalize).
- https://docs.x.com/fundamentals/authentication/api-reference (Sign in with X's redirect for an App already approved; x_auth_access_type=read) and https://oauth.net/core/1.0/, the flow its POST oauth/access_token fulfills (a request token exchanged once).

Read on 2026-10-01 by cx-x-author. Page sample resource ids and issued tokens stand for captured World values; example outputs are type samples, not pinned generated ids. The served options and the documented duration refusal are replayed with their real preconditions. Reference schemas with field-level examples alone do not constitute per-operation request/response examples. The replay is ../journeys/vendor-examples.json.

## Web Intent evidence

recordings/2026-10-03-tweet-button.html is the unmodified HTTP 200 HTML from X's own Tweet Button, fetched 2026-10-03 with
curl -fsSL "https://platform.twitter.com/widgets/tweet_button.html?text=Zero%20Hour%20Protocol&url=https%3A%2F%2Fvideogame.ai%2Fgame%2Fzero-hour-protocol".
SHA-256: 7fb2baf64a6b331ec50ad67d81a7bdfa9dcfc9988320b337aa6a44fd674aae86. Its code names https://x.com/intent/tweet, text:s.text and url:s.url.
The former developer Web Intent guide now redirects to the general overview.
recordings/2026-10-03-how-to-post.json records the official X Help Center's rendered posting instruction read with web search (its shell fetch refused 403).
The Web Intent's internal submit wire and DOM are undocumented; this screen's same-path form and post-page redirect are explicit substitutes, as on the OAuth screens.

## Packaged public example scalars

`spec/doc-examples.json` retains the pinned source above with only the string-scalar replacements listed below. Original inputs are retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/x/spec/doc-examples.json`. Original uncompressed SHA-256: `5fdeb3d80119161f4f16bd5b3193cfb1f6ab4a9b4d46ab4d9e003a985393dcc6`; packaged uncompressed SHA-256: `ce5c144ad7b528a226f8f511d2078e6c3bca0cca05ee9c2a64a1ae86e4dfe7ff`. Every byte outside the listed JSON string values is unchanged. These public samples are inert; runtime credentials are issued through the existing doors.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/1/input/refresh_token` | `<example-refresh-token>` | Public refresh-token sample replaced with one shared inert placeholder; its existing declaration retains capture substitution. |
| `/3/input/refresh_token` | `<example-refresh-token>` | Public refresh-token sample replaced with one shared inert placeholder; its existing declaration retains capture substitution. |
| `/5/request/url` | `https://api.x.com/oauth/access_token?oauth_token=example-oauth-token&oauth_verifier=example-oauth-verifier` | Inert request token and verifier retain the published OAuth URL and query fields. |
| `/1/placeholders/names/0` | `<example-refresh-token>` | Existing named-placeholder metadata follows the replaced request value. |
| `/3/placeholders/names/0` | `<example-refresh-token>` | Existing named-placeholder metadata follows the replaced request value. |
