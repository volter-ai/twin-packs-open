# ambientCG api spec — provenance

- **Why this document:** ambientCG publishes no OpenAPI document. This one is written from its v2 reference page,
  https://docs.ambientcg.com/api/v2/full_json/ (fetched 2026-09-30), and the host's answers read that day: every asset
  field comes back whatever `include` asks; an unknown `type` filters nothing (the page says zero results); a
  `limit` over 250 is honoured (300 read); a download (`/get?file=`) is a 302 to the file on
  acg-download.struffelproductions.com, and a file no asset has is 404 `This download could not be found.`
  (text/plain).
- **Its host:** ambientcg.com.
- **Corrections:** none.
- **Read by:** the twin orchestrator, 2026-09-30.
- **Vendored bytes (sha256):** `openapi.json` `9036e98bdb1137b67b9605940d5b0cf88fa5ea94bd1094e78ee7f4ec7dc8f275`.

## Narrow reference scope and observed discrepancies

The document above describes the fields this editor workflow consumes, not a complete recording of every public catalog field. No OpenAPI document is published upstream; version 2 is the reference version and there is no upstream source commit for these authored bytes. The local read at b86dde8 is the editor demand commit, not a vendor release.

`recordings/2026-10-01-terminal-page.json` retains a partial primary-response observation, with request/date/method and the process deviation recorded. It establishes that a terminal response omits nextPageHttp; ZIP entries contain size and do not establish fileSizeInBytes. It also records normalized lower-case asset ids and a Popular default on the current host. The published reference says Latest; search semantics here follow the reference, while these differences remain explicit. The earlier unknown-type and over-250-limit observations likewise contradict the reference; this scope follows the documented zero-result rule and stated 250 maximum. No nullable terminal-page value is fabricated.

Read and corrected 2026-10-01. `doc-examples.json` contains the default link, website-selection link, and documented parameter rules; no patch changes the vendored bytes.
