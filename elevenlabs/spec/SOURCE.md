# ElevenLabs' API

- **Why this document:** ElevenLabs' own OpenAPI document, as its API serves it at `https://api.elevenlabs.io/openapi.json`
  (the source of its Fern SDKs), fetched 2026-09-30 and vendored gzipped with the example-value substitution listed below. Server `https://api.elevenlabs.io`.
- **Corrections:** only the captured-example string substitutions below; operations and schemas are unchanged.
- **Original captured compressed bytes (sha256):** `openapi.json.gz` `14163f190ceeb1ba37fa9e523d8cf2b81735158c7306b9637c1f2d4d610614de`.
- **Packaged redacted uncompressed bytes (sha256):** `openapi.json.gz` `c308d7fe3371019f5f1883466463ee8524e070aa13a814f1e6a16cc4b3e49b55`.

- **Read:** 2026-10-01. The life's multipart sample is synthetic spoken audio generated with macOS Samantha (`say`) and encoded as MP3 with ffmpeg; it says Maya's studio welcome, rather than naming a file with no bytes.

- **The text-to-speech stream-input WebSocket** is in no OpenAPI document: ElevenLabs publishes it as AsyncAPI, on its
  reference page https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input
  (the handshake, its query, the messages each way and their schemas), whose Markdown form is vendored unchanged and
  gzipped: `text-to-speech-stream-input.md.gz`, the page's bytes (sha256)
  `edfb0d454e16a08d73521454afa002388704b6dd090e4f563367cd4fb5364f2e`, fetched and read 2026-10-09. It is cited from
  `src/semantics/sockets.ts` (the socket `streamInput`) and is not derived: the kernel derives no AsyncAPI.

- **Published examples:** `doc-examples.json`, read 2026-10-01 from the reference pages listed in each record. Responses are schema-rendered samples; language snippets repeat the same endpoint example. Create agent's empty example omits the spec-required conversation_config; the replay supplies it. The file placeholder on IVC is sent as multipart bytes.
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- https://elevenlabs.io/docs/api-reference/text-to-speech/stream
- https://elevenlabs.io/docs/api-reference/voices/ivc/create
- https://elevenlabs.io/docs/api-reference/voices/search
- https://elevenlabs.io/docs/eleven-agents/api-reference/agents/create
- https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url
- https://elevenlabs.io/docs/eleven-agents/api-reference/agents/list
- https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/list
- https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get

- https://elevenlabs.io/docs/eleven-agents/api-reference/workspace/secrets/create
- https://elevenlabs.io/docs/eleven-agents/api-reference/workspace/secrets/get
- https://elevenlabs.io/docs/eleven-agents/api-reference/workspace/secrets/list
- https://elevenlabs.io/docs/eleven-agents/api-reference/workspace/secrets/list
- https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get

## Credential-like example values

The pinned keys sweep flags the three captured reference strings listed below. Each is replaced with an explicit inert string of the same JSON type. Every other byte of `doc-examples.json` and the uncompressed OpenAPI document, including operations, schemas, field names and upstream locators, stays unchanged. The original captured bytes remain outside the package beside the release custody record for comparison.

These samples are reference data. Workspace-secret responses use IDs minted by `src/semantics/convai.ts`; the single-use-token operation remains unmodeled, as declared in `src/manifest.ts`. No runtime response takes these values from the spec.

| File | JSON path (RFC 6901) | Inert replacement | Reason |
| --- | --- | --- | --- |
| `doc-examples.json` | `/12/output/secrets/0/secret_id` | `<example-secret-id>` | Captured workspace-secret identifier flagged as a generic API key; runtime responses mint their own IDs. |
| `doc-examples.json` | `/13/output/secrets/0/secret_id` | `<example-secret-id>` | Captured workspace-secret identifier flagged as a generic API key; runtime responses mint their own IDs. |
| `openapi.json.gz` (uncompressed) | `/components/schemas/SingleUseTokenResponseModel/example/token` | `<example-single-use-token>` | Captured single-use-token sample; this reference value is not a runtime credential. |
