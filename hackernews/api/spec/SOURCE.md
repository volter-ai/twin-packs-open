# Hacker News API (hacker-news.firebaseio.com/v0)

- **What Hacker News publishes:** one document, the README of its API repository,
  https://github.com/HackerNews/API, at commit `8a0528f538bca407c2ceeeefc9bee48bdb99c1c8` (2025-01-01), fetched
  2026-10-02 from https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md and
  vendored as published: `api-readme.md`. Its version is the API's own, `v0`.
- **The OpenAPI document:** `openapi.json`, written from `api-readme.md` by the pack's author, as the procedure's step 2
  prescribes for a vendor that publishes no machine-readable document (written from its reference pages, the page
  staying the citation for every fact): the server and version ("URI and Versioning"), the ten paths the README names
  (item, user, maxitem, topstories, newstories, beststories, askstories, showstories, jobstories, updates), the item and
  user schemas from its field tables (a bold field required, each type from its description's words or the README's
  example values, the item's `type` its enumerated values), each list's bound ("Up to 500", "Up to 200"), the
  `print=pretty` query its example URLs carry, and each example the README shows as JSON after its URL. A new README is
  read against it and the document edited where they differ.
- **Where the README stops,** the pack says so where it rules (`../src/semantics/`): what an empty location answers (Firebase
  reads it as JSON null), how a write is refused, how far back the changes reach, what best means. The Firebase REST
  reference read for those: https://firebase.google.com/docs/reference/rest/database (read 2026-10-02).
- **Grouping:** by the README's sections (`grouping.json`, `{ "by": "tag" }`): Items, Users, Live Data.
- **Corrections:** none.
- **Read by:** the hackernews pack's author session, 2026-10-02.
- **Vendored bytes (sha256):** `api-readme.md` `d05432c450dbf604b62611ec012cdf18ca15e31005a3c2ab071d6bb8de82e61b`; `openapi.json` `712f06f978096cc85715a9c095361368944042c56b501079414fcaabb7038b2b`.
