# `@volter/twin-x` — X (Twitter): the API v2 and its authorization server

A [derived pack](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md#protocol-3-the-derived-pack) over X's own OpenAPI document
(X API v2 version 2.168, `spec/openapi.json.gz`, provenance and corrections in [spec/SOURCE.md](./spec/SOURCE.md)):
the wire is generated (`src/generated/`), every operation the twin serves is a semantics handler (`src/semantics/`),
and every other operation of the spec answers X's 404 problem, the gap (`src/manifest.ts` `unmodeled`).

An account's **scheduled voice** and its **sign-in**, as the applications that call X use them
([journeys/demand.json](./journeys/demand.json): Dub verifies a partner's handle): post (with images or a video), reply, quote, repost, publish an Article,
look a post or an account back up with its public metrics, read the account's own posts and who liked a post —
offline, against local state, with X's own `tweet.fields` projection, bearer/scope gate and problem envelopes; and the
authorization server that issues the credentials they take: the x.com authorize screen, OAuth 2.0 + PKCE (token,
refresh), OAuth 1.0a three-legged (request_token, the authorize/authenticate screen, access_token) and
`GET /2/users/me`.
One vendor, one document, one store: a credential the authorization server issues is honoured by the API it guards.

A World bound to the real X (a vendor-backed root, [architecture, "The real-system adapters"](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md))
signs its calls with an OAuth 1.0a user context, or trades an OAuth 2.0 refresh token on X's refresh-token grant for the
access token every call carries (`src/manifest.ts` `descriptor.auth`). Stored posts are read back through the account's
own timeline and the account through `GET /2/users/me`; every other resource states why X reads it back nowhere. X's
published examples (posts with a poll, a paid-partnership label, an Enterprise App's quote, Articles, chunked media,
both OAuth grants) are replayed in [journeys/vendor-examples.json](./journeys/vendor-examples.json).

```bash
bunx @volter/twin-x serve --root /tmp/world
# then point any X v2 client at it: X_TWIN_URL=http://127.0.0.1:<port> node --require @volter/world-core/inject app.js
```

## Coverage

| Area | What the twin serves |
|---|---|
| `POST /2/tweets` | Create an **original post** — with `reply.in_reply_to_tweet_id` a **reply**, with `quote_tweet_id` a **quote** (an Enterprise App's; a self-serve App's quote is refused, and its reply is taken only where the original post's author summoned it), with `poll` a poll and `paid_partnership` its label. One route, three discriminating body fields. Text over the account's limit (280, or its X Premium long-post entitlement) is refused before anything is written. `media.media_ids` attaches up to four images or one video this account uploaded; an unknown, foreign, expired or still-processing id is X's `Your media IDs are invalid.` |
| `POST /2/media/upload/initialize` · `…/{id}/append` · `…/{id}/finalize` · `GET /2/media/upload?command=STATUS` | **Media upload**, needing `media.write`, in chunks as twitter-api-v2's `uploadMedia` sends it: an image (`tweet_image`, `dm_image`), typed and sized from its own bytes; a video (`tweet_video`, `amplify_video`, MP4) in chunks, whose `processing_info` goes pending → in_progress → succeeded one STATUS read at a time (a file that is not an MP4 fails as `InvalidMedia`). Bytes live on the kernel's blob seam, content-addressed; an upload is a subject no read serves — only the post that attaches it is public. GIF, DM video and subtitle categories are refused by name. |
| media bytes | Served at X's own path shapes under the twin's base (a World's mount included): `/media/<name>.<ext>` for an image, `/ext_tw_video/<id>/pu/vid/avc1/<w>x<h>/<name>.mp4` for a video with HTTP Range, `/ext_tw_video_thumb/…` for a video's preview — a stand-in poster, since the twin decodes no frames. |
| `POST /2/users/:id/retweets` | A **repost** by the authenticated account (its own id in the path; another's is refused). Reposting twice counts once. |
| `POST /2/articles/draft` · `POST /2/articles/:id/publish` | An **Article**: a draft (its title, its DraftJS body, an uploaded cover), then published once, which makes the post that carries it (`post_id`). |
| `GET /2/tweets/:id/liking_users` | Who liked a post, oldest like first, paged (`max_results` 1..100, `pagination_token`); a post no one liked answers `result_count: 0`. |
| `GET /2/tweets/:id` · `GET /2/tweets?ids=` | Post lookup, single and bulk. The bulk form is **partial**, as X's is: the ids that exist in `data`, the ones that do not in `errors` — never a fabricated row. |
| `GET /2/users/:id/tweets` | The account's own posted timeline. |
| `GET /2/users/by/username/:username` | User lookup (handles are case-insensitive). An unknown user is X's partial-error 200 with a `resource_type: "user"` row, never a fabricated account. |
| `GET /2/users/me` | The person the credential names, with the same projection, counted against X's own window for the endpoint (75 per 15 minutes per user). |
| `exclude` | `exclude=replies,retweets` on the account's own timeline: replies leave; a repost is not a post of the account's here, so excluding them leaves every post. |
| `public_metrics` | A post's `retweet_count`, `reply_count`, `like_count`, `quote_count`, `bookmark_count` and `impression_count` (the wire's names), each counted from the state that makes it: the World's reposts, replies and quotes, and the audience's likes, bookmarks and views (the engagement door). |
| projection | `tweet.fields` (or `post.fields`, the name X's document and its own `@xdevplatform/xdk` give the same parameter), `user.fields`, `media.fields` and `expansions` (`attachments.media_keys` included) + the `includes` sidecar. The default is X's three fields (`id`, `text`, `edit_history_tweet_ids`) and nothing else — a documented field the twin holds no state for is refused by name rather than quietly omitted. `user.fields=profile_image_url` is the photo seeded for the account, or X's default avatar URL for one without, which the twin serves on `abs.twimg.com` (below). |
| paging + windows | `pagination_token` / `meta.next_token`, `max_results` (5..100 on the timeline), and `since_id` / `until_id` / `start_time` / `end_time` with X's own id-beats-time precedence. |
| auth | An OAuth 2.0 access token the token endpoint issued (or `/_twin/tokens` recorded) and its scope set, held to every scope the operation's spec names (its `security`), or an **OAuth 1.0a User Context** signature (HMAC-SHA1, the kernel's RFC 5849 library) over an access token the three legs issued — a Read-only App's token reads and gets X's `oauth1-permissions` 403 on a write; X's `about:blank` 401 / `Forbidden` 403 problems. |
| errors | `resource-not-found`, `invalid-request` (a query parameter the operation's spec does not have included), the 429 + legacy code 88 pair, `405` under `--read-only`. |
| the gap | Every other operation of X's spec (DMs, lists, spaces, likes and bookmarks by the API, deletion, mentions and home timelines, search, streams, counts, …) is X's 404 problem from this twin, never a fabricated success and never forwarded to X: no application here calls them. |
| no state system | The gap: a World's posts are not sent to X, and a real account's timelines are not observed. |
| `/_twin/*` | The World's doors (`src/semantics/doors.ts`): seed an account (its profile — `description`, `location`, `url`, `profile_image_url`, `protected`, `verified` — and its long-post entitlement), a bearer (kept by its SHA-256), an outsider's post (a reply or a quote too), the audience's likes, reposts, bookmarks and views of a post (`/_twin/engagement`), or an armed rate refusal. |

The spec is the denominator of the wire: 201 operations with the patched OAuth legs, 17 served by handlers, the rest the
gap (the fetch's `owners()`). What is not modelled includes polls, hide-reply, `entities`, a user's `public_metrics`,
the `user.fields` with no state behind them, search, likes and bookmarks through the API, stream rules, the
filtered and sampled **streaming** connections, GIFs, alt text, a video's real poster frame and X's transcoded
variants — not omitted. One CORE todo remains and says why in its own title: `x.rate_limit.published_figures`
needs X's published per-endpoint posting limits, and this pack makes no X call to fetch them.

## The authorization server: deliberately NON-OIDC, because the vendor is

X's OAuth 2.0 issues **opaque bearer tokens**: no `id_token`, no JWKS, no discovery document.
Identity is fetched from `GET /2/users/me` with the access token. That non-OIDC shape is why
 an integration built against an OIDC
provider (id_token claims, `openid email profile` scopes) breaks against X in exactly the ways this
twin reproduces: the scope model is X's own catalog (the OpenAPI's 26 scopes plus the announcement-added
`users.email`, which gates `confirmed_email` — a recorded intra-vendor discrepancy), the refresh
token only arrives with `offline.access`, PKCE is **required**, and the only identity read is the
API call.

It is a **browser-facing protocol pack** (the `googleoauth` class): the authorize screen is served
as HTML at the vendor's real path (`/i/oauth2/authorize`), server-rendered from the twin's own
state with `@volter/world-ui`'s consent and flow page (`src/screens/`). The decision is two plain `<form>` submits
("Authorize app" / "Cancel"), so **no JavaScript is required to complete an OAuth round trip** against this twin. A World registers the Apps (`POST /_twin/clients`, `/_twin/oauth1_apps`), the accounts
(`/_twin/accounts`, each with the password its person signs in to x.com with, ./src/screens/login.tsx, before an
authorize screen consents); an access token can also be recorded for an
account without the authorize leg (`/_twin/tokens`), the same token the token endpoint issues.

## x.com's public pages

An app that posts links the person to the post where it was published (as
`https://twitter.com/<handle>/status/<id>`). Inside a World that link opens here: this pack claims
`x.com` and `twitter.com` for exactly two anchored path shapes and serves them from its store
(`src/screens/post.ts`), with no sign-in, as X shows a public page to anyone:

- `/<handle>/status/<id>` — the post's page: the author's name, `@handle` and verified mark, the
  text with its mentions and links, its images or video, a quoted post, and the full time (drawn in
  UTC — the page has no viewer's zone). Under another handle, or the author's in another case, it is
  a 307 to the author's own URL, as x.com answers; a deleted post or an id no post has is a 404 with
  X's "this page doesn't exist" words; a protected account's post shows X's protected notice.
- `/<handle>` — the profile (name, handle, bio, location, website, joined date) over its posts, newest
  first, each linking to its page; replies stay off it (X's Posts tab). The handle is
  case-insensitive; a handle no account has is a 404 ("This account doesn't exist").
- An account without a photo is drawn with X's default avatar — the grey silhouette at the default
  `profile_image_url` the API answers for it, redrawn inline. A photo an account set is not drawn yet
  (todo `x.web.profile_photo`): it keeps a lettered placeholder.
- `abs.twimg.com/sticky/default_profile_images/default_profile_{normal,bigger,200x200,400x400}.png` —
  that default avatar as an app fetches it: `image/png` at X's
  sizes (48, 73, 200 and 400 px square), a two-colour PNG of X's #657786 silhouette on #ccd6dd drawn
  by the twin, identical bytes every time. Only those four paths on the host are claimed; X's `_mini`
  and bare `default_profile.png` are not (todo `x.web.default_profile_other_variants`).
- A trailing slash is a 307 to the path without it. `twitter.com` answers with a 301 to `x.com`,
  `www.x.com` and `www.twitter.com` with a 301 to `twitter.com`, `mobile.twitter.com` with a 302 to
  `twitter.com` and `mobile.x.com` with a 302 to `x.com`.

A person signed in at x.com sees the controls x.com draws, by its own names (`data-testid` and
accessible name), so a browser agent such as Volter Browsers' frontline finds them as it does on X:
under each post Reply (`reply`), Repost (`retweet`), Like (`like`) and Bookmark (`bookmark`), on
another account's profile Follow (`<id>-follow`, "Follow @<handle>"), and Back (`app-bar-back`).
Reply opens the reply composer on the post's page (`?compose=reply`), whose Reply (`tweetButton`)
posts a reply as `createPosts` does. Repost, Like, Bookmark and Follow each make the API's operation
as the person; this pack serves none of them, so the page shows the gap's answer (X's 404 problem)
and nothing changes. A visitor nobody signed in who presses one is sent to sign in first.

Those status codes are x.com's own, observed logged out on 2026-09-28 (`curl -A 'Mozilla/5.0'`; the
requests are in `src/screens/post.ts`). X's top-level routes (`home`, `grok`, `premium`, …) are never read
as a handle.

Images and video on those pages load from `pbs.twimg.com` and `video.twimg.com` — X's own media
hosts — which this pack also claims, for exactly the paths it serves from its blob store (the `media` screen). `x.com`
also carries the OAuth 2.0 consent screen at `/i/oauth2/authorize` and the World's `/_twin/` doors; the handle rule
never admits `i` or `_twin`, so a page is never mistaken for either. Replies under a post and x.com's logged-out chrome are manifest
todos (`x.web.*`).

## No mirror

The pack serves no signed-in x.com over the twin's state: the manifest declares no screen for one. The x.com post and profile pages remain (`src/screens/post.ts`).

**"Drafts in an outbox" is deliberately not here.** A draft sitting until someone approves it is an
obligation on the posting *action* — org config — and building an outbox into a vendor pack would
put behavior policy one layer further from where it belongs than putting it in platform code.

## Evidence boundary

The retained vendor contract and corrections are in [spec/SOURCE.md](./spec/SOURCE.md), `spec/patches.json` and `spec/sources.json`. The pack makes no direct X API calls during simulated execution. Refusal wording that the vendor documentation does not establish remains declared in the manifest's limitations.
