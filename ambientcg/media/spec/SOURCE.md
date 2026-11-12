# ambientCG files spec — provenance

- **Why this document:** the file hosts publish no document. Both are one Backblaze B2 bucket (ambientCG-Web) served by
  file name: written from Backblaze's page, https://www.backblaze.com/apidocs/b2-download-file-by-name (fetched
  2026-09-30), and the hosts' answers that day (a thumbnail: `image/png` with `x-bz-file-name`
  `media/thumbnail/256-PNG/Wood096.png`; a missing file: 404 `{"code":"not_found","message":"File with such name does
  not exist.","status":404}`).
- **Hosts:** acg-download.struffelproductions.com, acg-media.struffelproductions.com.
- **Corrections:** none.
- **Read by:** an orchestrator session whose id is not recorded, 2026-09-30.
- **Vendored bytes (sha256):** `openapi.json` `73d00ac671a5ab655491d2176649d91cadfc67e9dedf1273ab8a530d2631a290`.

`doc-examples.json` records the underlying B2 page's public photos-bucket illustration and private authorization illustration. The vendor-examples journey names each nonreplay reason: neither is an ambientCG-Web object, and no private B2 account is selected. File response headers (including file id and initial upload timestamp) are retained alongside resource blobs. No upstream document or source commit is published for the ambientCG media hosts; version 1.0.0 identifies this reference-derived scope. Read 2026-10-01.
