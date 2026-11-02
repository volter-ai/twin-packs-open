# x customer life: outline

## The customer

**Volter** is a small software company in New York that makes the Model Editor: a 3D model editor built on Blender
5.2, compiled to WebAssembly, that the coding agent a person already uses drives. Its X account is @volterai, the
account its own sites link to (RH2's and Runhuman's footers). Through
the year it runs two self-hosted applications against X, each unchanged from its repository (../journeys/demand.json):

- **Scheduler**, where Ines Ruiz, Volter's growth engineer, schedules the
  account's devlog: posts, pictures, a screen recording, a long post as an X Article. Scheduler signs in to X with
  OAuth 1.0a (twitter-api-v2 1.29, the App's consumer key and secret, a self-serve App) and reads a post's public
  metrics for its analytics. Its "auto-repost" rule checks a post's likes six, eighteen and thirty-six hours after it
  is published, and reposts it once enough people like it.
- **Dub** (dubinc/dub at `7e0101363b2a`), which runs Volter's partner program: 3D artists who recommend the editor earn a
  commission, and a partner proves their X handle through Dub's partner-platform verification (OAuth 2.0 with PKCE,
  `users.read tweet.read`, then `GET /2/users/me`).

The launch itself is not scheduled: on Monday 5 October 2026 at 09:00 New York, Aaron, Volter's founder, posts it by
hand on x.com from his own account, @AaronYEtc, the one the campaign posts from (gtm/channels.yaml, x-aaron; the owner's
ruling of 2026-10-02: posting is done by a person through x.com's UI). He posts in the launch World, whose x.com is
reached at the World's place (its pages, links and media under the World's base). The words are the campaign's X post; the video is the campaign's hero render (`hero-horizontal.mp4`; in the
life, its first three seconds at 192×108, so the life stays small; the session recording he picks by mistake is, in
the life, a 21-minute stand-in of the same recording's frames at 64×36); the link is the Model Editor's page,
https://model-editor.videogame.ai.

The World clock starts 2026-01-01. X's audience (the people who like, repost, bookmark, view, reply and quote) is not
an application: its acts are the World's engagement and posts doors.

## People and programs

| who | holds | how |
|---|---|---|
| Ines Ruiz, growth engineer | @volterai's password (its email is ines@volter.ai), from which her session at x.com comes; the developer console | Scheduler's "Add channel" and its composer; x.com as a visitor |
| Aaron, founder | @AaronYEtc's password (its email is aaron@videogame.ai); he also knows @volterai's | x.com's sign-in, home and composer, the post and profile pages |
| Scheduler | the X App's consumer key and secret (the developer console: a World door), the account's access token and secret | twitter-api-v2, OAuth 1.0a User Context |
| Dub | the partner-verification App's client id and secret (a World door) | its own OAuth 2.0 PKCE flow and fetch |
| Kestrel Moreau, a 3D artist | @kestrel_dev's password (its email is kestrel@moreau.studio) | x.com's sign-in; Dub's partner profile: "Verify X" |
| the audience | @mira_builds, @devon_ships, @tomas_polys | the engagement and posts doors |
| visitors of Volter's sites | no account | the X links on runhuman.com (x.com/volterai) and videogame.ai (twitter.com/videogame_ai) |
| VideoGame AI | @videogame_ai, which has not posted | — |

## The arc

### 1. Setting up (Mon 8 Jun)
The accounts exist: Volter's, Aaron's, VideoGame AI's, Kestrel's and three of the audience's. Ines registers both Apps in X's developer
console: Scheduler's (read and write, with Scheduler's callback) and Dub's (confidential, its partner callback).
The World gives Volter a fixed synthetic numeric account identity, as Twin's public Scheduler World seed supplies an explicit id (`cookbook/scheduler/seed-serve.mjs:58` at `96ca4478bb39`).

### 2. Connecting X to Scheduler (Tue 9 Jun)
Ines adds X as a channel: Scheduler asks for a request token with its callback and sends her to X's authenticate screen.
Nobody is signed in at x.com in her browser, so X sends her to sign in first; she signs in with @volterai's password,
X's session cookie (for .x.com, so api.x.com's too) is set, and she is returned to the screen, which asks her to
authorize the App. She does; X sends her back with the verifier, and Scheduler exchanges it for the
account's access token and secret, then reads the account (`GET /2/users/me` with its fields) and copies its picture,
X's default avatar, into its own storage.

### 3. The devlog's first week (Wed 10 Jun)
Scheduler publishes the devlog (Blender 5.2 compiles to WebAssembly and the editor
opens a .blend). She selects five pictures: the full Stoneguard Bridge scene and four detail crops of the bridge,
river, banks and mage. Scheduler's media picker and server validation allow all five, upload them, and X refuses a post
with more than four media ids. She keeps the full scene and three details; Scheduler uploads the revised selection
afresh and publishes it. The crops in the life are reduced-palette representatives, each 1000 pixels wide as
Scheduler's image converter sends them. They are distinct pictures, not repeated ids.

Scheduler selects media with no count cap, and uploads every selected asset and sends every returned id. X's vendored
`CreatePostsMedia` limits `media_ids` to four.

### 4. The audience answers (Wed 10 Jun)
Within three hours of the devlog post, three people like it, one reposts it, one bookmarks it, and it is seen 1,240 times; Mira replies asking
whether it runs on Linux, and Devon quotes it.

### 5. Auto-repost (Wed 10 Jun)
Six hours after the devlog post, Scheduler's auto-repost rule makes its first check: it reads who liked the post (three,
its threshold) and reposts it from the account. Its auto-plug rule's threshold is met too, and it replies under the
account's own devlog post with the editor's link.

### 6. Claude Code at work (Mon 15 Jun)
A two-second screen recording of Claude Code driving the editor is uploaded in chunks; X processes it, Scheduler polls its
status until it has succeeded. Ines also selects a bridge still to accompany the recording. Scheduler uploads the still
and submits both ids; X refuses video mixed with other media. She removes the still, and Scheduler uploads and polls
the video afresh before publishing it alone. Scheduler's normal-post validation and media selection allow that mixed
selection at the same cited paths as the gallery; X's media guide says a Post may contain up to four images or one
video.

### 7. Analytics (Mon 6 Jul)
Scheduler asks for the account's own posts of the last thirty days for its account analytics, and X refuses the request
for its empty field lists; Scheduler's panel shows nothing. Ines opens the devlog post's own statistics, which Scheduler reads
alone: its likes, its reposts (the audience's and the account's), its reply, its quote, its bookmark and its views.

### 8. How it is built, as an Article (Tue 14 Jul)
Ines writes how Volter compiled Blender to WebAssembly and selects the bridge under "Cover image". Scheduler converts
it to a 1000-pixel JPEG, uploads it through `v2.uploadMedia`, sends its returned id in `cover_media` on the Article
draft, and publishes the draft. She opens Scheduler's published-post link and the browser loads that cover under the
Article title. The JPEG upload follows the pinned SDK's multipart path.

### 9. A partner verifies her handle (Mon 3 Aug)
Kestrel joins Volter's partner program and verifies her X handle on Dub: Dub sends her to X's authorize screen, which
sends her to sign in first, as nobody is signed in at x.com in her browser; she signs in with her own password and is
returned to the screen, which asks her to let Volter's App read her profile; she authorizes it, Dub exchanges the code (with its PKCE
verifier, HTTP Basic) for an access token and reads her username. Dub builds Basic directly from its configured keys (dubinc/dub at `7e0101363b2a`,
`apps/web/app/(ee)/api/partners/platforms/callback/route.ts:110`); its provider reads those environment keys at
`apps/web/lib/api/partner-profile/partner-platforms-providers.ts:24-25`.

### 10. The launch, posted by hand (Mon 5 Oct, 09:00, 09:30, 11:00 and 14:00 New York)
Aaron opens x.com at the World's place, at its root as the World's console frames it, in a browser signed in to
nothing, and x.com sends him to sign in there. He types @volterai's password, the one he types most, into his own
account and is refused, then types his own and is returned home; the World's console now frames his account at its
profile, where the timeline shows Volter's devlog under the composer. He pastes the launch post and, with "Add
photos or video", picks the whole session recording from the folder instead of the hero cut beside it: x.com uploads it
in chunks (initialize, append, finalize), reads its status until X has processed it, and shows it attached. He clicks
Post, and X refuses it: his account may post a video of 20 minutes at most, which X checks when the post is created. He
removes it, adds the hero video, which X uploads and processes the same way, and clicks Post (POST /2/tweets with the
video's id). X says it was sent; View opens the post on its own page, where the browser's player asks X's video host for
the video from its first byte and plays it, and its
poster frame loads from X's image host, both at the place. He opens his profile from the side navigation and finds the
launch post leading it. Every link, move and media address on these pages is on the World's place.

At 09:30 Ines, writing the launch email, types the post's address from Aaron's message with his handle lowercased;
x.com sends her to the handle as it is cased, and she reads the post as a visitor.

At 11:00 Aaron posts three pictures: he writes a long caption, ending with the source's address, and picks, at once, the campaign's X card (a PNG), the
Stoneguard Bridge screenshot he exported as a JPEG, and the recording's poster frame he re-saved as a lossless WebP to retain its screenshot detail. x.com
uploads each and shows them attached, and shows how far over the 280 characters the caption is, counted as X counts.
He clicks Post anyway; X refuses a post over the limit, and the composer keeps his draft and says so. He shortens it,
posts it, and opens it; each picture loads from X's image host.

At 14:00 visitors arrive from Volter's other sites: one follows runhuman.com's footer link to x.com/volterai and reads
Volter's devlog; another follows videogame.ai's Twitter link,
twitter.com/videogame_ai, which X moves to x.com, where VideoGame AI's account has not posted.

### 11. The page's link and its card (Tue 6 Oct, 09:00 New York)
Aaron opens x.com at the place, still signed in, and is sent home. He clicks Post before his paste of the line has
landed, the composer empty, and X refuses a post with nothing in it; he pastes it and posts the page's link on its own,
with nothing attached. Its page shows the link's card under
the text: X's crawler read the Model Editor's page (its Open Graph title and description) when the launch post first
carried the link, and a post without media shows its link's card. The card shows no image: the page names none.

### 12. A game shared from videogame.ai (Tue 6 Oct, 10:00 New York)
Aaron tries Zero Hour Protocol on videogame.ai and opens Share > X. The game title and address are an editable draft;
he credits @mira_builds, adds #indiegame and posts it, then follows the sent post to copy its address for Mira.
The source is videogame.ai's shipped ShareDialog.tsx:29; the Tweet Button recording supplies the text and url fields.

## What the life does not do
Direct messages, lists, spaces, deletion, the mentions and home timelines through the API, search, likes and bookmarks
through the API, OAuth 2.0 revoke and OAuth 1.0a invalidate_token: no application here calls them. No quote through
the API: quote-posting needs an Enterprise plan, and Volter's Scheduler App is self-serve.

The connection acts include Ines declining Scheduler until Aaron reviews its write permission, then consenting. Dub’s
first verification reveals a preview callback left in its console; Ines registers the deployed address. Kestrel cancels
while checking the terms, then starts again: Dub begins a new attempt with its own state and PKCE pair. At the launch Ines first
copies an incomplete numeric post address before opening Aaron’s correct link. These are customer encounters on the
shipped connection, automation and browser paths, not additional API operations.
