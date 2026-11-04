# youtube customer life: outline

Author: `the youtube twin builder`.

**Hollow Lantern Games** launches its game *Emberfall* on YouTube from its own launch tooling, in the games-ecosystem
sandbox (videogame-ai ADR 0002), and **Dub** keeps its partners' channel statistics. The World clock starts Tue 3 Nov
2026, 10:00 UTC; every token the life uses is issued that morning and used within its hour.

1. **The World.** Google's side is the googleoauth twin's: the tooling's OAuth client (`731904826153-hollowlantern…`,
   its callback `https://tools.hollowlantern.games/oauth/google/callback`) and three Google accounts: Ayla Reyes, the
   studio's (`109876543210987654321`), Jun Park, a fan (`113579246801357924680`), and a spam account
   (`102468135790246813579`). Each signs up for YouTube (the channel door): *Hollow Lantern Games* (handle
   `@hollowlanterngames`), *Jun Plays* and *Free Gems Now*. Their ids are captured from the door's answers. Dub's Google
   Cloud project (`dub-partners`) gets an API key from the Cloud console's Credentials page, which is Google's side too
   (googleoauth's credentials door): the key Dub's cron sends. YouTube issues no credential of its own.
2. **Signing in.** The tooling sends Ayla to Google's account chooser with the YouTube scopes
   (`youtube.force-ssl`, `youtube.upload`), offline; she chooses her account, the browser returns with a code, and the
   tooling trades it at the token endpoint for an access token. Jun and the spam account sign in the same way with
   `youtube.force-ssl`. A call with no credential is refused (403 forbidden) and one with a token Google never issued
   (401 authError).
3. **The channel.** The tooling reads Ayla's channel (`channels.list mine=true`, snippet and statistics): its id is the
   door's, no videos yet. With the API key alone `mine` is refused (401 authorizationRequired).
4. **The trailer, resumably.** The tooling starts a resumable upload of the 30-byte synthetic trailer (snippet: title,
   description, tags, category 20; status private), with X-Upload-Content-Length 30 and Content-Type video/mp4; the
   answer's Location carries the session's `upload_id`. A session with no title is refused first (invalidTitle). It
   sends the first 14 bytes (308, Range bytes=0-13), asks the progress with an empty PUT (308, the same Range), then
   sends the rest (201: the video, uploadStatus uploaded). Reading it back by id it is processed, private, its views 0; anyone else reading it by id finds no video (an
   empty list).
5. **A dev diary, in one request.** The tooling uploads a short dev diary as one multipart request (metadata, then the
   file): the video answers uploaded and reads back processed and public (the default privacy).
6. **Editing the trailer.** The tooling retitles the trailer and makes it public (part=snippet,status); an update of the
   snippet without a category is refused (invalidCategoryId).
7. **The audience.** The trailer's audience watches (1,200 views, 140 likes) and a viewer outside the World, *Lumen
   Fan*, comments (the audience door). Jun comments on the trailer (`commentThreads.insert`); Ayla replies to Jun
   (`comments.insert`); the spam account comments a link. Ayla reads the trailer's threads (newest first, with replies);
   Jun asking for the held ones is refused (403 forbidden).
8. **Moderation.** Ayla rejects the spam comment and bans its author (`setModerationStatus rejected banAuthor=true`,
   204); the spam account's next comment is rejected as it arrives and the published threads show neither; publishing
   the rejected comment is refused (processingFailure), and banAuthor with heldForReview too (banWithoutReject).
8b. **Renewal and scopes.** Before the stream the tooling renews Ayla's access token with her refresh token (the
   token endpoint's refresh grant) and reads her channel with it. Jun signs in to the studio's stats page with
   `youtube.readonly` alone: that token reads his channel, and is refused an upload and a chat line, whose methods name
   no scope it holds (403 insufficientPermissions): each operation takes the scopes its Discovery method names.
9. **The launch stream.** The tooling makes the stream its encoder sends (`liveStreams.insert`, RTMP, 1080p, 30fps):
   its ingestion address and stream name. It schedules the launch broadcast for 18:00 UTC (public), its liveChatId with
   it, and binds it to the stream (ready). Asking to go live before the encoder publishes is refused
   (errorStreamInactive), and completing a broadcast that never started (invalidTransition). The encoder's RTMP publish
   (the stream active, the broadcast testing, then live) is the encoder's act, which no journey step speaks: the walk
   sees the stream ready throughout. The upcoming broadcasts list it; the stream reads ready. The broadcast is a video
   too: read by its id through videos.list it is an upcoming live broadcast with its scheduled start.
10. **The chat.** Before the stream the chat is open: Ayla greets it, Jun answers, a viewer outside the World writes (the
    chat door), and the spam account trolls. The tooling's chat bot polls (`liveChatMessages.list`, its
    pollingIntervalMillis and nextPageToken) and reads the four lines with their authors (Ayla the chat's owner); Ayla
    deletes the troll's line (204); Jun deleting Ayla's line is refused (403 forbidden); polling from the page token
    finds nothing new.
11. **Dub's cron.** The studio's channel has 12,345 subscribers (the channel's audience door). Dub's daily cron reads its
    partner channel with the project's API key (`channels.list part=statistics,snippet&id=`, X-Goog-Api-Key): 12,300
    subscribers (three significant figures), 2 videos, 1,200 views, the handle and the avatar: YouTube checks the key
    against Google's record of it, across packs, and takes it only on the list methods that read public data. A key
    Google never issued is refused (400 keyInvalid), and the real key on a method that writes (401 required).

Every demanded operation is reached: channels.list (acts 3, 11), videos.insert.simple (4, 5), videos.insert.upload (4),
videos.list (4, 5), videos.update (6), commentThreads.list and insert (7, 8), comments.insert (7),
comments.setModerationStatus (8), liveStreams.insert and list (9), liveBroadcasts.insert, list, bind and transition (9),
liveChatMessages.list, insert and delete (10), and the doors (1, 7, 10, 11). What the walk cannot speak is the
encoder's RTMP publish, so a broadcast's testing, live and complete moves, the stream's active status and an ended chat
(liveChatEnded, offlineAt) are the ingest's, reached only by a World whose encoder publishes.
