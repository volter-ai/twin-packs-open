# LinkedIn spec — provenance

- **Why this document:** LinkedIn publishes no OpenAPI document for its Marketing (Community Management) API. Its
  reference is Microsoft Learn's pages, versioned by month. `openapi.json` is written from those pages at the Marketing
  September 2026 version (`?view=li-lms-2026-09`, Linkedin-Version `202609`, the latest the versioning page names),
  by hand, one operation per request the pages document, with the pages' own words as each operation's and field's
  description, so a `spec:` citation quotes the page through the spec.
- **File:** `openapi.json`, OpenAPI 3.0.3, `info.version` `202609`, 22 operations: its server is
  `https://api.linkedin.com/rest`; `/userinfo` names its own server (`https://api.linkedin.com/v2`), and the upload URLs
  theirs (`https://www.linkedin.com`: `/dms-uploads/…` and `/dms-mpf-uploads/…`).
- **Pages read** (each fetched 2026-10-02; the twin's citations are checked against them by `check-sources`, recorded
  in `sources.json`):
  - Posts API — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09
    (create, the reshare, targeted and dark posts, get by URN with viewContext, find by author and by account, partial
    update, delete, mentions and hashtags, the error table)
  - Post API schema — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema?view=li-lms-2026-09
    (every field of a post, its content types, lifecycleState and its info, visibility, distribution)
  - Images API — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09
    (initializeUpload, get, batch get, partial update, find by associated account, permissions, formats and pixels)
  - Vector Asset API's "Upload the Image" — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/vector-asset-api?view=li-lms-2026-09
    (the image upload's PUT with the OAuth token, answered 201), which the Images API page sends its reader to
  - Videos API — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09
    (initializeUpload and its options, the part PUT and its ETag, captions and thumbnail uploads, finalizeUpload, get,
    file specifications)
  - little Text Format — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format?view=li-lms-2026-09
  - Organization Access Control by Role — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09
  - Organization Lookup API — https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09
  - Versioning — https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-09
  - Updated Marketing API Error Responses — https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09
    (VERSION_MISSING and NONEXISTENT_VERSION's answers)
  - Error Handling — https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling (the error
    body, the 401 kinds, the 429's words)
  - Rate Limiting — https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
  - Authorization Code Flow — https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
    (an access token's sixty days and length, its scope list, invalidation by a different scope)
  - Developer Portal Tools — https://learn.microsoft.com/en-us/linkedin/shared/authentication/developer-portal-tools
    (the Token Generator, which the World's token door stands in for)
  - Sign In with LinkedIn using OpenID Connect — https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2
    (GET /v2/userinfo and its fields)
  - Increasing Access — https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09
    (fetched 2026-10-03; the OAuth permissions each Marketing API product grants on approval)
  - UGC Post API — https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api (fetched
    2026-10-03): the Posts API's predecessor, read only for the number its successor's FIELD_LENGTH_TOO_LONG leaves out
    ("The maximum length of the text of a UGC Post is 3000 characters.")
- **Pages read for linkedin.com's own pages and the World's account** (not the spec's; cited by the screens and the seed,
  fetched 2026-10-03 with GET):
  - LinkedIn Help, Sign in and out of your account — https://www.linkedin.com/help/linkedin/answer/a1335211 (the Me
    menu's Sign out)
  - LinkedIn Help, Media file types supported on LinkedIn — https://www.linkedin.com/help/linkedin/answer/a564109 (the
    images a person can post from linkedin.com, WEBP among them)
  - videogame.ai's public company page — https://www.linkedin.com/company/videogameai/ (its name, vanity name, website,
    tagline and about, as the World's page holds them, and Aaron Yuan's name, which it lists)
  - linkedin.com read signed out: its root (the guest page, "LinkedIn: Log In or Sign Up", its "Sign in with email"),
    /feed/, a page's /posts/ and /m/logout/ (302 to /uas/login with the page's whole address), a post that is gone (307
    to /signup/cold-join), that join page ("Sign Up | LinkedIn": Email, Password, First name, Last name, "Agree &
    Join", "Already on LinkedIn? Sign in", and its refusals' words, among them "Password must be 6 characters or
    more.") and a path it does not have (404)
  - The HTML Standard, form submission — https://html.spec.whatwg.org/multipage/form-control-infrastructure.html (a
    browser sends a textarea's line breaks as CRLF)
- **Documented and not written as operations:** the batch gets (`GET /posts?ids=List(…)`, `/images?ids=List(…)`,
  `/organizations?ids=List(…)`, `/organizationsLookup?ids=List(…)`) and the query tunneling of a get as a POST: the spec
  reader routes an operation by a query parameter's value (`?q=author`), never by a parameter merely being present,
  so a batch get would be routed as another operation's; they answer LinkedIn's 404, the gap. The Poll, MultiImage,
  Documents, Carousel and Celebration APIs, the Social Metadata API, comments and reactions are other pages, not read.
- **Corrections:** none.
- **Read by:** the linkedin pack's builder (Claude), 2026-10-02 and 2026-10-03.
- **Vendored bytes (sha256):** `openapi.json` `46333e97b32b9d243ced0c5dfd337edf9f8ad571687f90cdac0e2a193a011dc8`.
