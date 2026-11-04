# Bitly contract provenance

`openapi.json` contains the unchanged vendor bytes downloaded on 2026-10-07 from
https://dev.bitly.com/v4/v4.json, linked by https://dev.bitly.com/api-reference/.
The document declares OpenAPI 3.0.0 and Bitly API 4.0.0. This URL has no immutable upstream commit.
SHA-256: `00dde1896336ba6085efc5a1a18021c7253f5b02900e6ab31c6ef129afd8d690`.

Reader: Bitly contributor (Codex).

`patches.json` adds the OAuth operation omitted from the v4 document using
https://dev.bitly.com/docs/getting-started/authentication/. The patch retains the operation's
unversioned server and both documented response encodings. The vendor file is never rewritten.

Other pages read: https://dev.bitly.com/docs/getting-started/rate-limits/ for budget windows,
https://dev.bitly.com/api-reference/ for published request/response examples. Checked citations
are recorded by the standard in `sources.json`. There are no captured real-vendor exchanges.
The signup fixture, deterministic opaque ids and conservative account limits are explicit local choices.
