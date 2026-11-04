# The model editor's launch on LinkedIn — the customer life's outline

**The customer.** VideoGame AI, a small AI game studio, launching the Model Editor on Monday 5 October 2026, 09:00 in
New York, as media's campaign reads at `launch/dry-run` f6a2a08: its LinkedIn post is Aaron Yuan's own (the
campaign's `linkedin-aaron`, a personal post by the owner's hand), made on linkedin.com as the hosted dry-run World's
console shows LinkedIn's pages; the campaign's own sender (`node send.mjs linkedin`, media's senders/linkedin.mjs)
posts through the REST API as the company page it is configured with, urn:li:organization:100000001, videogame.ai's
page (linkedin.com/company/videogameai), which Aaron administers.

**The actors, each with the credential it acts with and that credential's grant.**

| Actor | Credential | Grant |
|---|---|---|
| Aaron Yuan, of VideoGame AI (aaron@example.com in the World) | the linkedin.com sign-in (password), then the `li_at` session | everything LinkedIn's own pages do for a member; posts as himself, and as videogame.ai's page as its ADMINISTRATOR |
| The prototype script (July) | a token Aaron generated for Volter Media, the campaign sender's app, on 27 July | w_organization_social, r_organization_social, rw_organization_admin; sixty days |
| The campaign's sender (the dry run and after) | LINKEDIN_ACCESS_TOKEN: the token the World issues for Volter Media and Aaron | every scope the Community Management API grants Volter Media; sixty days |
| Mira, an indie game developer who follows videogame.ai, building a "who posted" tool | a token of her own app, Who Posted (Sign In with LinkedIn); on linkedin.com, the account she joins with and her sign-in | openid, profile, email; her own posts; no page role |
| The analytics collector (another deployment of Volter Media) | the application's token | the same; it shares the application's daily limits |
| A reader outside VideoGame AI | none (signed out) | sees public posts |

Volter Media holds the Community Management API alone, as LinkedIn asks of that product; sign-in is another
application's.

**The arc.**

1. **Monday 5 January 2026 — on LinkedIn.** Aaron signs up on LinkedIn, creates videogame.ai's company page (he is its
   administrator: urn:li:organization:100000001) and, on the Developer Portal, the Volter Media application for the
   campaign sender, with the Community Management API.
2. **Monday 27 July — the prototype.** Aaron generates a token for Volter Media for the prototype sender, which finds
   the page it posts for (organizationAcls by role assignee, at the then-latest version 202607). Its first upload names
   the 4K master export (6.2 GB): initializeUpload refuses it (over 5 GB).
3. **Thursday 1 October — the dry-run World boots.** The sender's old environment still holds the July token, expired
   since 25 September: refused 401. The World issues the sender its LINKEDIN_ACCESS_TOKEN (Aaron's token for Volter
   Media with every scope the Community Management API grants, which invalidates the July token, generated with
   others). Aaron checks by hand that it administers the page the sender is configured with, and that
   urn:li:organization:100000001 is videogame.ai's page.
4. **Friday 2 October, 12:00 New York — the dry run.**
   - Through a mix-up of paths the sender sends the campaign's card (a PNG) as the video: its upload and finalize
     succeed, and LinkedIn's processing fails it (not an MP4); the sender stops at PROCESSING_FAILED, as it is written
     to.
   - The path fixed, it sends the full-quality export of the horizontal render (an MP4, 54.5 seconds, 16:9, 4.7 MB):
     two 4 MB parts, each PUT and its ETag kept, finalize with the ETags in order, PROCESSING, then AVAILABLE a few
     seconds later. It posts it distributed to no feed (feedDistribution NONE) for a check. Aaron signs in on
     linkedin.com in the World's console (mistyping the password once), sees the post is on no feed, and opens its link
     from the sender's log: the render plays. The sender deletes it; its cleanup deletes it again at exit (LinkedIn's
     deletes are idempotent); Mira, to whom Aaron had pasted the link while it was up, opens it signed out: it is gone,
     and LinkedIn sends her to join, which she does there (Join LinkedIn: email, password, name, Agree & Join; her first
     password, five characters, is refused for the join page's six); her browser goes on to the post, and LinkedIn tells
     her, a member now, it cannot be displayed.
5. **Friday 2 October, 14:00 New York — the teaser.** Mira makes Who Posted with Sign In with LinkedIn and its token.
   Her tool's first question, videogame.ai's posts, is refused: a sign-in token holds no r_organization_social and she
   has no role on the page, so the tool will name only who signed in. The sender uploads the teaser card, which keeps
   the name back (something being built in the open, Monday 5 October) (initializeUpload, the PUT with its token,
   PROCESSING, then AVAILABLE), and the teaser goes up on the page as an image post with its alt text.
6. **Monday 5 October, 09:00 New York — the launch.** The dry-run World boots again, issues the sender the same token
   and performs the campaign's send for LinkedIn: the horizontal render uploaded in one part, finalized, AVAILABLE
   with no cover (none was uploaded), and the campaign's LinkedIn copy posted on the page with it, titled as send.mjs
   titles it. By hand, as the campaign's channel has it, Aaron, still signed in, opens linkedin.com in the World's
   console (his feed: the share box, the page's launch post, the teaser), chooses Video in the share box, posts as
   himself (the composer offers him Anyone or Connections only; he leaves Anyone), pastes the campaign's LinkedIn
   copy, attaches the horizontal render from his laptop and presses Post. The feed says the post was successful and
   that the video is being processed, and reloads itself while it is. While it processes he starts his next post at
   once, and the composer, open, is not reloaded away: Photo, a still from the launch video, its words typed and the
   still attached as saved from a chat, a WebP; then Post as: videogame.ai, and the composer, now the page's (for
   Anyone alone), keeps his words and the file; he posts it, and linkedin.com, which takes a WebP from a person's
   share box, posts it, and its page shows it; a few seconds later his post's own page plays the video from the
   World's base, its first frame its picture, and the company page's Posts tab lists the still and the page's launch
   post above the teaser. A reader outside VideoGame AI, not signed in, opens Aaron's post from a link on
   linkedin.com, and the video plays.
7. **Monday 5 October, 13:00 New York — the docs card and Mira's post.** The sender posts the follow-up on the page as
   an article post: its link card points at https://model-editor.videogame.ai, with the campaign's card, uploaded for
   it, as its thumbnail, and a reader opening it sees the card. Mira's tool asks whose token it holds (userinfo);
   Mira, at another computer, opens linkedin.com signed out, follows its guest page's Sign in with email to the sign-
   in page, signs in, posts a few words of her own as herself (the composer offers her no page), and signs out from
   the Me menu.
8. **Tuesday 6 October — the captioned cut.** For the feed, the sender uploads a ten-second cut of the launch video
   (its own file) with its cover (a frame of the cut) and a captions file saying in words what the silent screen
   shows, waits for it, and posts it on the page; a reader opening it sees the cover the sender chose.
9. **Tuesday 6 October, 12:00 New York — the limit.** The analytics collector, another deployment of Volter Media, has
   used the day's posts quota the application's Analytics tab shows; the sender's look over the page's posts is
   refused 429. After midnight UTC it reads them, newest first: the captioned cut, the docs card, the still, the
   page's launch post and the teaser.

**Upload retries.** During the sender's wrong-file trial, it loses the finalize response and retries finalize,
then retries the part before polling: both are refused because the video has left WAITING_UPLOAD. The teaser
uploader similarly retries its PUT after losing the response: the image is already PROCESSING. The upload
pages describe the states but give no refusal for these retries; the decision table rules their undocumented answers.

**Windows and quotas.** Tokens live sixty days; upload URLs and media URLs thirty; a version is answered from its
month until the 15th of the month a year after; videos are 75 KB to 500 MB and three seconds to thirty minutes; a
commentary is at most 3,000 characters; daily limits reset at midnight UTC. Every act above falls inside them, except
those the story shows refused for exactly that reason.

## Scheduler connection gap

Credentials authorize those features;
OAuth consent and code/refresh exchange, legacy /v2/me and the page picker are demanded but unimplemented.
The existing life walks LinkedIn’s own pages and the campaign API, not a completed Scheduler connection.
