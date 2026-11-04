# @volter/twin-hackernews

The Hacker News twin (Protocol 3), one lane per surface, over one store:

- `site/` — news.ycombinator.com as a person uses it. Hacker News has no posting API and asks that posting never be
  automated, so its forms are this lane's operations (login and create account, submit, comment and reply, upvote,
  logout),
  written from its pages (`site/spec/SOURCE.md`), and its pages are workspace screens: login, submit, the front page
  (`/` and `/news`), newest, show, shownew, item, reply and user, ranked by points and age on the World's clock.
- `api/` — the public read API at hacker-news.firebaseio.com/v0: item, user, maxitem, the top, new, best, Ask HN
  and Show HN lists, and updates (jobstories answers the gap), written to OpenAPI from Hacker News's README (`api/spec/SOURCE.md`). What a person
  posts on the site is at `/v0/item/<id>.json` and in `newstories` at once.

**At a World's place** (a served or hosted World's `/<org>/<world>/hackernews/…`), every link, form action and redirect
of the site's pages stays on the twin's base, and the `user` sign-in cookie names the person there, so a person posts
through the pages where the World shows them; the read API's `/v0/…` answers there too. Links that deliberately leave the base: a story's
url, a link typed in a comment, and the show page's links to Hacker News's own Show HN rules and tips, static public
pages no World holds and the twin does not republish (they open the real page in a tab of its own).

**Needs** `@volter/world-core` 3.0.19 or later (screens that yield to the API, `yieldsToApi`) and `@volter/world-ui`
1.0.19 or later (a sign-in form's own field ids).

**For whom:** a World where a person posts a launch as Hacker News sees it (Volter's dry-run launch of its Model Editor
as a Show HN), and anything that reads the posts back through the API.

**Doors:** `POST /_twin/app-credentials` (the descriptor's `credentialDoor`): the World's own account, `yuerany` (the launch's
channel `hn-aaron`), and its password, filled as `HN_USERNAME` and `HN_PASSWORD`; a person signs in with them on the login page.

**Left out:** item deletion and editing, flags, vouches, hide and favorite, downvotes and unvoting, polls and jobs (no
form a person uses makes one; jobstories answers the gap), the user's profile settings, password reset, Ask HN's and the other listing
pages beyond those named, and the Firebase API's query parameters and streaming beyond `print=pretty`. No World's write is
performed against Hacker News (`vendorBacked: none`).
