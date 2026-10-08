# anthropic spec — provenance

- **File:** `openapi.json.gz`, the vendor's own gzip, byte for byte: `scripts/mock-spec.json.gz` of Anthropic's
  TypeScript SDK (https://github.com/anthropics/anthropic-sdk-typescript) at commit
  `1926adb4d292090975e6b5d19ebafe2274d2469e` on `main`, fetched 2026-09-25. It is the OpenAPI document the SDK is
  generated from (the SDK's `scripts/mock` serves it); Anthropic publishes no other machine-readable spec. Since
  2026-09-03 the SDK's `.stats.yml` no longer names a spec URL and bundles this file instead.
- **Spec version:** OpenAPI 3.1.0; `info` carries a title (`Anthropic API`) and no version, so the version is this
  commit. Server `https://api.anthropic.com`; 244 operations (every path of the public API, the Admin API under
  `/v1/organizations`, and the beta surfaces, which the spec repeats as `?beta=true` operations), plus `webhooks`.
- **SHA-256:** of the vendor's gzip `38837d9c8ca013a6838e7d9ee377319da6cfcd1fbe0a4c4cab1b10fa3b82a88f`; of the
  uncompressed document `257523f5aeb5defbe416b60a9ebb8bea9c17c94e195b77817c6cd5b7474e7528`.
- **Corrections:** none yet; any go in `patches.json` (RFC 6902, each with its reason and evidence), applied before
  the IR.
- **Read by:** `bun scripts/derive-pack.ts anthropic`, which writes `../src/generated/`.

- **Documentation examples:** `doc-examples.json` records the Create a Message, beta Create a Message,
  beta Count Tokens and List Models reference pages, the complete client examples of the streaming and tool-use
  overview guides, and the documented thinking/tool-choice rules. Read 2026-10-01 at the
  URLs each record names. The reference renderer writes optional sample fields; `rendered` identifies them.
  The beta pages display a non-beta curl path; the replay uses the beta namespace's `?beta=true` route, as the
  vendored SDK's beta Messages client sends it. The literal system date in the rendered request is input text,
  not the replay date. Server web-search examples replay with synthetic scripted calls/results. The two rendered create requests contain sampling settings the same vendor spec rejects; replay preserves their inputs and expects its documented 400.
  The spec itself publishes no operation response examples.

Screen references, read 2026-10-08: [the vendor's authentication guide](https://platform.claude.com/docs/en/manage-claude/authentication) supplies the key actions, expiration choices and workspace contract. [Sean Lloyd's firsthand Console walkthrough](https://www.sean-lloyd.com/post/how-to-get-your-claude-api-key), published 2026-03-22, supplies the pictured navigation and key-page layout. The screenshot is visual evidence only; the screen reads the World's organization and keys. No vendor sign-in or upstream UI capture is required, and no reference image is shipped.
