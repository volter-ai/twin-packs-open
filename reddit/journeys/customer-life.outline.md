# Reddit: the Model Editor's launch in r/volter

The customer is Volter, a small software company with one Reddit account, u/volter, its community r/volter, and the
launch of the Model Editor under VideoGame AI (the campaign at `volter-ai/media` `launch/dry-run` f6a2a08) on Monday
5 October 2026 at 09:00 New York (13:00 UTC). The story runs from Thursday 1 October to Tuesday
6 October 2026.

## The people and programs, and what each acts with

| Actor | Acts with | Grant |
|---|---|---|
| Maya Okafor, Volter's community lead | u/volter's username and password on reddit.com's pages, opened in Volter's launch World (its pages at the World's place for the Reddit twin): the `reddit_session` cookie and the page's modhash | everything u/volter may do on reddit.com |
| Ines Ruiz, Volter's growth engineer | the script app `volter-media` (its client id and secret) and u/volter's password, traded at the token endpoint | a bearer token with the scopes she asks for |
| the campaign sender (`senders/reddit.mjs`), Ines's program | Ines's bearer token on oauth.reddit.com | that token's scopes |
| Volter's community-stats job, Ines's other program | the same script app's client id, and a token it mints | identity, read and history |
| Kestrel (u/kestrel_dev), a 3D artist who follows Volter | her own username and password on www.reddit.com | what any member may do |
| Pixel (u/pixelwright), a game maker who reads videogame.ai | his username and password on www.reddit.com | what any member may do |

Bearer tokens last 86,400 seconds (the token answer's `expires_in`); the rate window is 1,000 requests per client per
ten-minute window (the `x-ratelimit-*` headers Reddit answers).

## Act 1: Thursday 1 October, Volter sets up (Ines)

1. u/volter already exists (made on Reddit's sign-up page, which no API reaches); so do u/kestrel_dev and
   u/pixelwright.
2. Ines registers the script app `volter-media` on reddit.com's app preferences page (no API reaches it) and is shown
   its client id and secret.
3. She trades u/volter's password for a token, copying the scope list from Volter's stats script: `identity read
   history`. She checks the token names u/volter (GET /api/v1/me).
4. She creates r/volter with POST /api/site_admin and is refused 403 `insufficient_scope`: making a community needs
   `modconfig`, which the copied list lacks.
5. She trades the password again for `identity read history submit edit modconfig`, and creates r/volter (public, any
   post type, titled "Volter", with its public description).
6. Maya asks for the launch date in the description. site_admin wants every value sent again, so Ines reads r/volter's
   settings (GET /r/volter/about) for its fullname, and sends them back with the new description.

## Act 2: Friday 2 October, the dry run of the sender (Ines and her programs)

7. Ines mints the dry run's token: `identity read history submit edit` (find the post, post it, delete it).
8. Before she runs the sender, Ines tries the poster's lease by hand with the dry run's token, naming the designer's
   export as it is (`card-story.svg`, `image/svg+xml`), and Reddit refuses the media type: Reddit takes images (PNG,
   JPEG, GIF) and videos (MP4, MOV). The designer exports a PNG.
9. The sender's first run, as the program makes it: it leases the hero video (`hero-horizontal.mp4`, a real MP4 of a
   few seconds) and uploads it to the lease's S3 action, then leases the designer's first PNG, the print master (a
   2,700 × 2,700 uncompressed export, about 21 MB), as `image/png`, and its S3 upload is refused `EntityTooLarge`: the
   lease's policy allows 20 MiB. The run stops there; the designer exports the web size.
10. Ines runs the sender again, whole: it leases and uploads the hero video again, leases and uploads the web poster (`card-story.png`), and submits a `video` post to r/volter
    titled "[dry run] Model Editor by VideoGame AI, …"; Reddit answers no id, so the sender reads `name` from GET /api/v1/me and
    finds the post in u/volter's submitted listing.
11. The dry run must not stay in r/volter before launch: Ines deletes it (POST /api/del) and reads the submitted
    listing to see it gone.

## Act 3: Monday 5 October, the launch, posted by hand in the launch World (Maya)

12. 08:50 New York: the community's description still says the editor launches Monday (beat 6), so Ines sets it to say
    the Model Editor is out today, sending POST /api/site_admin with Thursday's token (the one that holds `modconfig`),
    and is refused 401 `invalid_token`: it expired a day after Thursday. She trades the password again for `modconfig`
    and sends r/volter's settings again (its fullname, read in beat 6, and every value, with the new description),
    which Reddit accepts; the community's page shows it to Kestrel at 09:40.
13. 09:00: Maya opens r/volter's Create Post in the launch World's pages (the World's place for the Reddit twin);
    reddit.com asks her to log in, she logs in as volter and is returned to it.
14. She chooses Images & Video and picks the hero video. The page leases the upload, sends the video to its S3 host
    (through the World's place for that host), takes the video's first frame as its thumbnail, leases and sends that,
    and on Post submits the `video` post titled as the campaign's Reddit section says ("Model Editor by VideoGame AI,
    open source: Blender 5.2 compiled to WebAssembly, driven by your coding agent"), pasted from the campaign with a
    double space and a trailing space, which Reddit cleans. Reddit's answer names no post for a video, only u/volter's
    submitted page, and the page goes there: the new post leads it under its cleaned title. She opens its comments
    page, where the video plays from v.redd.it.
15. 09:05: Maya presses Create Post again, chooses Link, and posts "Model Editor by VideoGame AI" linking
    https://model-editor.videogame.ai, with a line of body; its comments page opens, its link card naming the page and
    its body under it.
16. 09:10: She posts the team's questions thread on the Text tab ("We built the Model Editor: ask us anything"), its
    two paragraphs saying the source is on GitHub and what the editor does not do; the page sends the body as the
    Markdown she typed.

## Act 4: Monday, the community answers

17. 09:40: a friend sends Kestrel the video's v.redd.it link, which opens the post. She logs in, opens r/volter (Hot),
    presses Join, opens the video post, upvotes it and comments "Does it run on Linux yet?".
18. On the link post she asks where the source is, then opens the questions thread, whose body links the repository.
    Back on the link post she deletes her question from its More options menu (Delete, confirmed); the page reloads,
    her question gone from the thread (it had no reply) and the post's count back to no comment.
19. 10:15: Maya opens the launch post's comments page, sees Kestrel's question and replies: "macOS on Apple Silicon
    only."
20. 10:30: Kestrel sees the reply and thanks Maya under it.
21. 11:30: Pixel, browsing r/all on reddit.com signed out, sees Volter's launch posts. Reading videogame.ai's page for
    Neon Odyssey (a game made with VideoGame AI), he looks for a VideoGame AI community on reddit.com and finds none.
    He presses Share › Reddit on the game's page: the browser opens reddit.com/submit with the page's url and the game's title; reddit.com sends it to www.reddit.com, which sends
    him to log in first and back to the Create Post page with the link and title filled. He chooses r/volter, where the
    launch is, and posts.
22. 11:45: Maya opens r/volter's New, finds Pixel's share and upvotes it.

## Act 5: Tuesday 6 October, the day after

23. 09:00 New York: Maya opens Reddit's front page in the launch World, her home feed of r/volter's posts, then r/volter's New (Pixel's share, the questions thread, her link post, the video post) and
    its Hot, where Pixel's share, as upvoted as the video and newer, leads.
24. 10:00: Kestrel shows her first scene: on Create Post's Images & Video she uploads a screenshot of a stone bridge she
    built in the editor (a JPEG) and posts it; Create Post goes where Reddit's answer sends her, her posts, and she opens
    the scene's page, which shows the image, loaded from i.redd.it.
25. 12:00: Ines's community-stats job builds the launch report with its own token (`identity read history`): r/volter's
    New and Hot, the launch post's comments oldest first (when Volter first answered), u/volter's comments, and the posts
    u/volter upvoted (the community's posts the team boosted).

## Act 6: Wednesday 7 October, a second moderator (Kestrel, Ines)

26. Overnight u/cheap_keys_4u signs up, registers a script app and posts a key reseller's offer to r/volter.
27. 07:00 New York: Kestrel, who offered on Tuesday to help moderate, registers her own script app for moderation and
    mints a token (`modself modposts read`). She tries to remove the offer at once and is refused: she does not
    moderate r/volter yet. She tries to accept an invitation she has not been sent: there is none.
28. 07:30: Ines mints u/volter's token for inviting a moderator (`modothers`) and invites Kestrel, typing the
    permissions as `+a`: Reddit refuses the string. She invites her again with every permission (`+all`).
29. 07:35: Kestrel accepts. Ines's script sends the invitation once more by mistake: Kestrel already moderates.
30. 07:40: Kestrel removes the offer. r/volter's New no longer shows it, her stone bridge newest again, and the offer,
    read by its id, says a moderator removed it.

## Refusals and why each happens

- 403 `insufficient_scope` (act 1): a scope list copied from another script.
- the media type refused (act 2): Ines's lease of the SVG poster.
- `EntityTooLarge` (act 2): the print master, over the lease's 20 MiB.
- 401 `invalid_token` (act 3): Thursday's token, after its day.
- a community that does not exist (act 4): Pixel's search for a VideoGame AI community.
- 403 (act 6): a removal by Kestrel before she moderates r/volter.
- `NO_INVITE_FOUND` (act 6): Kestrel accepting before she is invited.
- `INVALID_PERMISSIONS` (act 6): Ines's mistyped permissions string.
- `ALREADY_MODERATOR` (act 6): the invitation sent again after Kestrel accepted.

## Scheduler connection gap

Its authorization screen, consent, code/refresh grants and community-picker operations are demand but unimplemented.
The existing life does not connect or publish through Scheduler and claims no completed act for that flow.
