# @volter/twin-reddit

A Protocol 3 twin of Reddit: its OAuth API on oauth.reddit.com, the same API called by reddit.com's own pages, and
those pages. Built for Volter's launch of its model editor, posted to r/volter by a person on reddit.com and by the
campaign's sender (`volter-ai/media`'s `senders/reddit.mjs`), and for the videogame.ai site's Share › Reddit.

## What it serves

- **The token endpoint** (`POST https://www.reddit.com/api/v1/access_token`): a script app's password grant for one of
  its developers, the scopes asked (or `*`), a token living a day. Other grants answer the gap.
- **The API** (bearer token on oauth.reddit.com, or the session cookie and modhash on www.reddit.com): `GET /api/v1/me`;
  the media lease `POST /api/media/asset.json`; `POST /api/submit` (link, self, image, video, videogif); `POST
  /api/comment`; `POST /api/vote`; `POST /api/del`; `POST /api/subscribe`; `POST /api/site_admin`; `GET
  /user/{username}/{where}`; `GET [/r/{subreddit}]/comments/{article}`; `GET /r/{subreddit}/hot`, `/new` and `/about`.
  On oauth.reddit.com a call carries a bearer token and a session cookie counts for nothing; reddit.com's pages make
  their writes on their own origin with the session cookie and modhash, and a write there without a signed-in person
  answers `USER_REQUIRED`. On www.reddit.com a read is the API's in its `.json` form only where no page draws the path:
  `/comments/{article}.json` answers JSON, while `.json` reads under `/r/` and `/user/` are taken by the page drawn there
  and answer its not-found page (the kernel routes a page on its own host before the API; see Left out). An answer to a
  bearer token carries the client's rate window (`x-ratelimit-used`, `-remaining`, `-reset`: 1,000 calls a ten-minute
  window); a token's missing scope is 403 `insufficient_scope`, an unknown or expired one 401 `invalid_token`; JSON is
  encoded the legacy way unless `raw_json=1`.
- **The upload buckets** (`reddit-uploaded-media` and `reddit-uploaded-video` on s3-accelerate.amazonaws.com): the
  lease's S3 form, held to its signed policy (expiry, conditions, the 20 MiB image range, no field the policy does not name), answered with S3's
  `PostResponse`; the bytes kept as the pack's blobs.
- **The media hosts**: `v.redd.it` (a video's renditions, the uploaded file; its page address opens its post),
  `i.redd.it`, `preview.redd.it`, `external-preview.redd.it`, `b.thumbs.redditmedia.com`.
- **reddit.com's pages** (www.reddit.com; reddit.com moves there): the front page `/` (signed in, the posts of the
  communities the person joined or moderates; signed out, every public community's: the page the logo opens and a
  World's console opens for Reddit); `/login` (Email or username, Password, Log In; to the same-site path it came from,
  kept under the twin's base, else the front page); `/r/all` (every public community's posts, Hot and New);
  `/r/{subreddit}` with Hot and New, Create Post and Join (a community the World does not have, its Create Post too,
  sends the reader to `/subreddits/search?q={name}`, which lists the communities by that name or none); Create Post
  (`/submit`, `/r/{subreddit}/submit`: Text, Images & Video, Link, Title, a Markdown Body on every tab, Post; the
  tab showing decides the post's kind, only its controls are shown, and choosing a file, with Upload or by dropping it on
  the box, shows Images & Video), whose
  upload leases and posts the file and, where the browser can draw one, the video's first frame as its thumbnail (a
  video it cannot draw is posted without one), then goes where the submit's answer sends the person (a link or text
  post's page; for an image or a video, the person's posts at `/user/{name}/submitted/`); a person's posts
  (`/user/{name}/submitted/`, where a post on the person's profile also leads: `/r/u_{name}` moves there); a post's comments page (its video playing, Upvote, Downvote, Share, the comment box,
  Reply, and on one's own comment More options › Delete, confirmed; a deleted comment leaves the thread, or stays as
  [deleted] where replies hang under it, and leaves the post's comment count). Share copies the post's link, or, where the
  clipboard is refused (a frame that does not allow it), shows it in a read-only field, selected, as Reddit's share
  panel does. Each control calls the API above from the page. At a World's place the pages, their calls and their media
  are on the twin's base, with two exceptions: a link post's card and the links in a body go to their real hosts.

## The World's doors

`POST /_twin/accounts` (an account, as Reddit's sign-up makes it), `/_twin/apps` (an app on reddit.com/prefs/apps, its
secret shown once), `/_twin/subreddits` (a community, for a seed), `/_twin/app-credentials` (the credential door: the
World application's token for an account, filling `REDDIT_ACCESS_TOKEN`).

The seed makes u/volter (email `social@volter.ai`, password `volter-world-reddit`) and r/volter, which it moderates, and
u/FamouslyDefault (email `aaron@world.test`, password `stoneguard-bridge-1005`), the account the Model Editor launch
posts from, by hand or through the credential door's token.

## Left out

Reddit's other endpoints (dev/api lists 260 operations) answer the gap. Not modelled: transcoding (a video is served as
uploaded; its DASH and HLS playlists are not there), the media websocket a submit names, a moderator's or Reddit's
removals, flair, awards, saving and hiding, a profile's comments and other tabs (its Posts alone are drawn), r/all
through the API (the page draws it; `GET /r/all/hot` is sent to the community search, as for any community the World
does not have), signing out, the other OAuth grants and
the authorize page, and reading a live account's posts back into a World (a listing's things are not read by the
refresh). Provenance and where the documentation stops: `spec/SOURCE.md`.

Waiting on the kernel's routing (twin-world): at a World's place a page whose path the API also names (`/r/{name}/hot/`,
`/new/`, `/r/all/hot/`, `/submit`) is drawn only for a request a browser marks as a navigation (`Sec-Fetch-Dest:
document` or `iframe`); without the mark it is the API's, which answers reddit.com's not-found page. And on
www.reddit.com a `.json` read under a path a page draws (`/r/{name}/new.json`, `/user/{name}/submitted.json`) is the
page's, not the API's. Reddit answers both as www.reddit.com does, a page unless the path names the `.json` form; the
kernel has no rule a pack can declare for a host that serves its pages and its API on one path by extension.

The vendor examples (`journeys/vendor-examples.json`) are nine replays of rules Reddit's pages state, each named
`rule: …` with its source. The OAuth2 wiki's three published token answers (the code grant's, the refresh's and the
application-only grant's) are for grants the twin does not serve and are recorded as not replayed.
