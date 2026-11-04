# instagram customer life: outline

Author: `claude-instagram-p3`.

**Plunger Works** launches its co-op party game **Heck Plungers** on Instagram from its launch tooling (videogame-ai's
games-ecosystem sandbox, ADR 0002: a launch is a trailer posted to TikTok, Instagram and YouTube, then running the
community). The tooling calls the Instagram API with Instagram Login with fetch; Meta publishes no Node SDK for it.
The World clock starts Tue 3 Mar 2026, 10:00 UTC, launch day.

The customer entry (`first-use.json`) is Meta's Get Started guide as the studio's tooling makes it: with the App
Dashboard's long-lived token (INSTAGRAM_ACCESS_TOKEN) it reads the professional account (/me), its media and its
publishing usage, and reads them back after the World resumes.

1. **The App Dashboard and the people.** The World registers the studio's Instagram app on the App Dashboard (the
   credential door): its Instagram App ID and App Secret, its OAuth redirect URI
   (`https://videogame.ai/integrations/instagram/callback`), the studio's own Business account @heckplungers (2,140
   followers, following 87) added to the app, and the long-lived token Generate token gives for it. Asked again, the
   dashboard hands out the same app, account and token; a redirect URI that is no URL is refused. Juno (@junoplays, a
   creator account, 15,800 followers) and Mara (@mara.loops, a personal account) sign up on instagram.com; a taken
   username and an account with no password are refused.
2. **The account.** The tooling reads /me (v26.0) with the dashboard token, in the access_token parameter and as
   `Authorization: Bearer`: its app-scoped id, user_id, username, account_type Business, media_count 0, followers
   2,140; with no fields asked, only its id. It reads the account's media (none) and its publishing usage (0 of 50 in
   86,400 seconds; usage alone by default). No token, an unknown token, an unknown field and another account's media
   are refused.
3. **The trailer.** The tooling makes a Reel container from the trailer on the studio's site
   (`videogame.ai/media/heck-plungers/trailer.mp4`, an MP4 of 30 seconds the application serves), with its caption and
   share_to_feed; Instagram fetches it and the container is FINISHED. Published, the container is PUBLISHED and the
   media reads back as VIDEO on REELS with its caption, permalink, shortcode, timestamp, owner, counts and CDN URL,
   whose file the CDN serves; the account's media list holds it, its usage is 1 and media_count 1. Publishing the same
   container again is refused. A Reel whose video no server in the World holds, a "video" that is no MP4 and a
   thumb_offset past the video's end each make an ERROR container whose status is the subcode (2207052, 2207026,
   2207057), and publishing the failed one is refused. An unknown media type, a caption over 2,200 characters, a Reel
   with no video_url, a carousel (the gap), an image no server holds (2207052) and an image that is no JPEG (2207005)
   are refused as the container is asked for; so are a publish with no creation_id and one naming no container. An
   alternate cut is made and left FINISHED.
4. **The community.** Instagram's audience watches the trailer (the audience door): 1,840 views, 1,210 reached, 233
   likes, 41 saves, 17 shares. Mara asks when the Switch port comes, a troll posts, a spammer posts. The tooling lists
   the comments (newest first, two a page and the next page by its cursor), replies to Mara and reads the thread (a
   reply to its reply lands on Mara's comment), hides the troll, shows and hides it again, cannot reply to the hidden
   comment, deletes the spam (it is gone), lists the comments with their replies expanded, comments itself (its own
   comment stays shown when hidden), turns comments off (neither the audience nor the studio can comment) and on again, reads a comment's
   fields (from, media, username), and is refused an unknown comment field, a media update naming nothing, and
   deleting the media (the Facebook Login API's: the gap).
5. **The insights.** The tooling reads the trailer's lifetime views, reach, likes, comments, saved, shares and total
   interactions, which match the audience's acts (period stays lifetime). A metric the twin does not serve and a
   breakdown answer the gap ("An unknown error has occurred."); an unknown metric and none at all are refused.
6. **A creator connects.** The tooling sends Juno to the authorization window with her state. A redirect URI the app
   never registered, an unknown app, a retired scope, a scope list without instagram_business_basic and a
   response_type other than code are refused on the page. She mistypes her password, Mara (a personal account) cannot
   log in, Juno logs in (the consent page holds no password: her login rides in a single-use sessionid
   cookie), cancels once (access_denied, user_denied, the state); the cancelled login is spent and Allow on it, or with
   no login, asks her to log in again; she logs in again and allows basic and content publishing: back with a code and
   the state. The code is refused with a wrong secret, another grant type and another
   redirect URI, then traded for a short-lived token, her app-scoped user id and the permissions; the same code again
   is refused. Her token reads her own account and publishing usage and her empty media, cannot read the studio's
   trailer, and cannot read comments without that permission. A wrong secret and another grant type are refused on
   the long-lived exchange; then it gives a 60-day token; a long-lived token is not exchanged again; a token younger
   than 24 hours and a short-lived one are not refreshed.
7. **The next day.** 25 hours on, Juno's short-lived token has expired; her long-lived one refreshes for another 60
   days, and both it and the new one work. The studio's alternate cut was never published: its container has EXPIRED
   and cannot be published. The publishing usage of the last 24 hours is 0 again, a `since` older than 24 hours is
   refused, and the media list by since and until finds the trailer on launch day alone. The studio's profile picture
   loads from the CDN.
8. **The creator's clip.** Juno publishes a Reel of her own with her long-lived token; it is in her media list, the
   studio cannot read it, and she cannot read its insights without that permission.

Not walked, and why: the success of an image post (a JPEG's bytes cannot be given in a life's `application` answer,
whose body is text), a container still IN_PROGRESS when published (Instagram's fetch is made as the container is
asked for), and the 50th post of a day.
