# @volter/twin-linkedin

The LinkedIn twin (Protocol 3): LinkedIn as a company page's people use it, and the versioned REST API an application
posts through. Its surface is written from LinkedIn's Microsoft Learn reference pages at version 202609 (`spec/`,
provenance and every page read in `spec/SOURCE.md`); what it serves and why is its manifest and semantics.


**What it serves.**

- **linkedin.com, signed in** (`src/screens/`): its root (the feed for a member; for a visitor its guest page, whose
  "Sign in with email" opens the sign-in; any other path it does not draw is its page-not-found), the sign-in
  (`/login`, and `/uas/login` where a member's page sends a visitor), joining (`/signup/cold-join`, where a post a
  visitor may not see sends them, and its "Agree & Join"), the Me menu's "Sign out" (`/m/logout/`),
  the feed with its share box ("Start a post", "Video", "Photo") and the post composer (`/feed/?shareActive=true`:
  "Post as" the member or a page they post for, the text, "Add media" from the person's machine, "Who can see your
  post?" with what LinkedIn offers that choice — Anyone or Connections only for the member, Anyone for a page — and
  "Post"; changing "Post as" keeps the draft and its attachment), a post's own page
  (`/feed/update/<urn>/`, its text, image, playable video or link card), and a company page with its Posts tab
  (`/company/<vanity name>/posts/`). The composer's Post makes the post through the same operations as the API: the
  Images or Videos API's upload, then the Posts API's create.
- **The REST API** at `https://api.linkedin.com/rest` (Linkedin-Version and a bearer token): the Posts API (create
  with text, an image, a video, an article's link card or a reshare; get by URN with READER or AUTHOR; find by author;
  delete), the Images API and the Videos API (initializeUpload; the PUT of the image, or of each 4 MB part to its
  signed URL, answered with its ETag; a video's captions and thumbnail; finalizeUpload; get while LinkedIn processes
  the file to AVAILABLE or PROCESSING_FAILED), Organization Access Control (by role assignee, by organization),
  Organization Lookup (a page by id), and `https://api.linkedin.com/v2/userinfo`.
- **The media hosts**: `media.licdn.com` (images, the video covers their owners uploaded) and `dms.licdn.com` (video
  files, with ranges), each by a URL LinkedIn handed out, signed and good for thirty days from then. A video with no
  uploaded cover has none: the twin decodes no video to make LinkedIn's optional system cover, so a player draws the
  video's own first frame.
- **At a World's place** (a served or hosted World's `/<org>/<world>/linkedin/…`, its pages origin), every page is
  written onto the twin's base: its links, forms and redirects stay there, and its images and videos load from
  `<base>/@media.licdn.com/…` and `<base>/@dms.licdn.com/…`; the sign-in's `li_at` cookie names the person there.

**For whom.** The model-editor campaign's dry run (volter-ai/media, `launch/dry-run`): its LinkedIn post is Aaron
Yuan's own (the campaign's `linkedin-aaron`), made by hand on linkedin.com, and the campaign's sender
(`senders/linkedin.mjs`) uploads and posts through the API with `LINKEDIN_ACCESS_TOKEN` as
`urn:li:organization:100000001`.

**The World's launch account** (`src/semantics/seed.ts`): the member Aaron Yuan, `aaron@example.com` (password
`videogame-dry-run`), who administers the page videogame.ai (`urn:li:organization:100000001`,
`linkedin.com/company/videogameai`), and the developer application Volter Media. The credential door issues the
application's token as `LINKEDIN_ACCESS_TOKEN`.

**Doors** (`/_twin/`, standing in for LinkedIn's own pages): `members` (sign-up), `organizations` (Create a Page),
`developer-apps` (the Developer Portal's Create app with its products), `tokens` (its Token Generator),
`developer-apps/{clientId}/limits` (the daily limits its Analytics tab shows), `app-credentials` (the credential door).

**Left out**: partial updates of posts and images, the dark-post finder by ad account, the images finder by ad
account, the vanity-name lookup (each answers LinkedIn's 404); the batch gets; comments, reactions, polls, documents,
multi-image and carousel posts; Campaign Manager's sponsored content; profiles, messaging and jobs on linkedin.com;
LinkedIn's OAuth pages (a token comes from the Token Generator door). A commentary over 3,000 characters is refused
400 `FIELD_LENGTH_TOO_LONG`, as the Posts API's error table names it; the number is the UGC Post API's, as the Posts
API page names none.
