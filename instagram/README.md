# @volter/twin-instagram

A twin of the Instagram API with Instagram Login (Instagram Platform, v26.0), for an app that connects Instagram
professional accounts, publishes Reels and images and runs their community: a game studio's launch tooling posting a
trailer and answering its comments, in videogame-ai's games-ecosystem sandbox.

## Use it in a World

Choose this package's exact release in the [catalog](https://world.volter.ai/twins/instagram).
Its Setup tab supplies release-specific installation and World initialization commands.
Review the selected vendor, retain its package/version and lockfile, and run the app through
the World. [First local World](https://world-docs.volter.ai/docs/getting-started) explains the shared workflow.

## SDK workflow

Meta publishes no Node SDK for this API; apps call it with `fetch`. The entry (`journeys/first-use.json`) is Meta's
[Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)
guide: with the long-lived token the App Dashboard generates for the studio's own account it calls
`GET https://graph.instagram.com/v26.0/me?fields=id,user_id,username,account_type,media_count,followers_count`,
`GET /<IG_ID>/media` and `GET /<IG_ID>/content_publishing_limit?fields=quota_usage,config`, asserts the account's
`user_id` is `INSTAGRAM_USER_ID`, a professional `account_type`, and the quota (50 posts in 86,400 seconds), and reads
them back after the World resumes.

The World's credential door (`POST /_twin/app-credentials`, the App Dashboard) fills `INSTAGRAM_APP_ID`,
`INSTAGRAM_APP_SECRET` (the Instagram App ID and App Secret), `INSTAGRAM_ACCESS_TOKEN` (the long-lived token Generate
token gives) and `INSTAGRAM_USER_ID`; the names are this entry's choice of the dashboard's. Another person connects
through Business Login: `https://www.instagram.com/oauth/authorize` (the window, also at api.instagram.com), the code
traded at `https://api.instagram.com/oauth/access_token`, then `GET /access_token?grant_type=ig_exchange_token` and
`GET /refresh_access_token?grant_type=ig_refresh_token`.

## Data and behavior

Every account, code, token, container, media and comment is the World's, made through these operations and the doors
below; tokens and codes are drawn from the World's secret and kept by their SHA-256. A container's media is fetched
from its `image_url` or `video_url` through the World (an application's own host, another twin's): a URL the World
holds nothing at fails as Instagram fails a URL it cannot reach. The fetched file is kept and served at the media's
`media_url` on scontent.cdninstagram.com. The twin decodes no media: a JPEG's size comes from its frame header, a
Reel's duration from its MP4 `mvhd` box; a reel without a cover, and every profile picture, is a labeled placeholder
picture. Insights are the counts the audience door moved. A container FINISHED and unpublished for 24 hours reads
EXPIRED, on the World's clock.

Doors (`/_twin/`, only for what no API does):

- `POST /_twin/app-credentials { redirect_uris?, username?, ... }`: the App Dashboard: the app, its OAuth redirect URIs,
  the studio's own professional account, and its generated long-lived token (the credential door).
- `POST /_twin/accounts { username, password, account_type?, ... }`: an Instagram account, as instagram.com's sign-up
  makes it (Business, Media_Creator or Personal).
- `POST /_twin/media/{id}/audience { views?, reach?, likes?, saved?, shares?, comment? }`: people at work on a media in
  the Instagram app: counts added, and a comment by someone the API does not serve.

Do not use real Meta credentials for local substitution.

## Scope and limits

Served: the code exchange, the long-lived token and its refresh, `/me`, `/{ig-user-id}/media` (list, and a Reel or
image container), `/{ig-user-id}/media_publish`, `/{ig-user-id}/content_publishing_limit`, `GET`/`POST`/`DELETE
/{id}` (IG User, IG Container, IG Media, IG Comment), `/{ig-media-id}/insights`, `/{ig-media-id}/comments` (list and
create), `/{ig-comment-id}/replies` (list and create), the authorization window and the CDN.

Left out (the gap, answered as the Graph API's unknown error): carousels, stories, VIDEO and resumable uploads
(rupload.facebook.com), tags, collaborators, locations, trial reels, partnership labels and caption add-ons; the
insights metrics follows, profile activity and visits, the reels' watch times and skip rate, story metrics, reposts
and Facebook views, and breakdowns; copyright checks; deleting media (the Instagram API with Facebook Login's); and
the Facebook Login and Unified Login APIs, messaging, mentions, hashtag search, the account's own insights and
webhooks.

## Package facts

Protocol 3; vendor specification in spec/, provenance in spec/SOURCE.md. Apache-2.0; Node >= 22.3; peer
`@volter/world-core`. Issues: https://github.com/volter-ai/twin-packs-p3/issues.
Contributor mechanics belong to the [pack procedure](https://world-docs.volter.ai/docs/contributing/architecture#creating-a-pack).
