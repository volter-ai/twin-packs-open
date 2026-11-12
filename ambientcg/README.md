# @volter/twin-ambientcg

The ambientCG twin (Protocol 3), serving what Volter Editor's asset library calls
([journeys/demand.json](./journeys/demand.json), [journeys/decisions.json](./journeys/decisions.json)). Two lanes over
one store:

- **`api`** (ambientcg.com, the v2 API written from docs.ambientcg.com): `/api/v2/full_json` (assets filtered by type
  and keywords, sorted Latest, Popular, Alphabet or Downloads, paged by limit and offset, with `numberOfResults` and
  the page links) and `/get?file=` (a 302 to the zip on the download host; the host's 404 text for a file no asset has).
- **`media`** (acg-download and acg-media.struffelproductions.com, the ambientCG-Web Backblaze B2 bucket): a file's
  bytes by its name, zips and thumbnails, with `X-Bz-File-Name` and `X-Bz-Content-Sha1`; B2's `not_found` otherwise.

The API only reads. The World's catalog is published through `POST /_twin/assets` ({ assetId, dataType, displayName,
tags?, releaseDate?, popularityScore?, downloadCount?, downloads: [{ attribute, base64 }], thumbnail? }).

The public catalog has no customer mutations, credentials or events. `asset` refresh reads `fullJson.foundAssets`; file bytes remain in the World's blob store. This API-focused pack models the editor's calls, with no browsing screens: the artist's workflow runs in Volter Editor. The ambientCG website's human browsing UI, private B2 buckets, upload/authentication APIs, range and conditional downloads, and undocumented search combinations are outside this scope.
