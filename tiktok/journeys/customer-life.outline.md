# tiktok customer life: outline

Author: `codex-demand-rule`.

**Tidewater Yoga** posts to TikTok from **Scheduler**, a social scheduling app. The World
clock starts Tue 20 Jan 2026, 09:00.

1. **The developer site and the person.** The World registers Scheduler's TikTok app on the developer site: its client key
   and secret (the credential door answers TIKTOK_CLIENT_ID and TIKTOK_CLIENT_SECRET), its redirect URI
   (`https://scheduler.tidewater.yoga/integrations/social/tiktok`) and its URL property (the studio's media domain).
   Maya (@tidewateryoga, 1,240 followers, following 180, 9,800 likes, videos up to 10 minutes) has a TikTok account.
2. **Connecting.** Scheduler sends Maya to the authorize page with its six scopes; she signs in and authorizes; the
   browser returns to the redirect URI with a code, the granted scopes and the state. A redirect URI the app never
   registered is refused on the page. Scheduler trades the code (form, grant_type authorization_code): an access token,
   a refresh token, open_id and the scopes; the same code again is refused (invalid_grant). It reads the account
   (open_id, avatar_url, display_name, union_id, username).
3. **A video, posted directly.** Scheduler asks the creator's longest video (600 seconds) and initializes a Direct Post of
   a 2,304-byte synthetic MP4 as one chunk (FILE_UPLOAD, PUBLIC_TO_EVERYONE); a privacy level not among the creator's options is
   refused. It PUTs the bytes to the upload URL: 201. The status is PUBLISH_COMPLETE with its public post id and the
   bytes uploaded. A second PUT to the finished upload is refused (416).
4. **A video to the inbox.** A second video goes to Maya's inbox (inbox/video/init): after its upload the status is
   SEND_TO_USER_INBOX, and it is no public video. Maya also reviews a 65 MiB class recording: Scheduler's upload plan sends five 10 MiB parts (206) and a 15 MiB final part (201), then
   reads SEND_TO_USER_INBOX and the complete uploaded byte count. Compact synthetic media fills keep the life small.
5. **Photos.** Scheduler posts two photos by URL from a domain the app never verified: 403 url_ownership_unverified.
   From the studio's verified domain, whose server the World does not run: the post's status is FAILED,
   photo_pull_failed (the twin pulls through the World and reaches nothing else).
6. **Analytics.** TikTok's audience watches (the door): 1,200 views, 150 likes, 12 comments, 8 shares. Scheduler reads
   the account's stats (followers 1,240, video count 1), lists its videos (the public one, newest first, cursor and
   has_more) and queries their counts.
7. **The next day.** The access token is refreshed (grant_type refresh_token): a new pair, and the old refresh token no
   longer works. A request with no token answers 401 access_token_invalid.
8. **What TikTok refuses, and its edges.** The developer site takes only https redirect URIs; TikTok takes no invalid,
   empty-passworded or taken username. Jonah (a teacher, a private account) is refused on an unknown client key, a
   response type other than code, a scope the app lacks and a wrong password; he cancels once (access_denied), then
   authorizes only his basic profile and posting. His code is refused with a wrong client secret or another redirect
   URI, and a grant type TikTok lacks is refused; traded, his token cannot read stats or videos (scope_not_authorized)
   or Maya's post, and his creator settings offer a private account's privacy levels. Maya's refreshed token meets the
   rest: an unknown user field; a caption over 2200 characters; a video from a URL (the twin's gap, said so); no
   source; every chunk-plan rule; an upload URL naming no task, a chunk without its range or with the wrong bytes, and
   an upload URL an hour old; photo posts with the wrong media type, post mode or source, no photos, a cover index past
   them, a title over 90 or a description over 4000 characters, or a privacy level not offered; photos sent to the
   inbox (their pull fails as before); a publish_id TikTok never gave; a video field that does not exist, a page over
   20, videos before the first one's time, a query naming none; a video's cover from the CDN.
9. **TikTok Business.** The ads portal gives Scheduler's business app its App ID and secret, and refuses a redirect URL
   without its trailing slash, with a port, a query, http, a relative one, or eleven; Scheduler's is registered. Maya
   connects her account through the same authorize page; the code is refused with a wrong secret (40131), another
   grant type, a code TikTok never gave (40110) or another redirect URL, then traded. An open-platform token is not the
   business API's (40105), none is 40104, another account's business_id 40001; fields that are not a JSON array or
   name what the profile lacks are 40002. Scheduler names the account and reads its analytics, and its posts' counts (the
   public video of chapter 3, 1,200 views); a page over 20, fields without item_id, and posts before the first are
   refused or empty. TikTok knows a location near the studio and two tracks; Scheduler finds the location and lists the
   tracks, all and by genre. A video published by URL, with a track, loses its media body after the studio's server
   supplies headers: FAILED, video_pull_failed. Her next video downloads successfully from the application's media
   response and becomes PUBLISH_COMPLETE; Scheduler reads its id, caption and zero initial counts back from the public
   Business video list. Photos saved as a draft fail because the World
   has no response for those image URLs; every missing field is
   40002. Jonah connects his business account; Maya's task is not his (40001). The token is refreshed once; the spent
   refresh token is 40107; a day later Jonah's unrefreshed token has expired (40102).
