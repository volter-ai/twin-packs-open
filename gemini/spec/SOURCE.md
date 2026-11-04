# Gemini API specification

`discovery.json` is Google's retained Generative Language API v1beta Discovery document, revision
20260928, fetched 2026-09-30 from
`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`.
The vendor publishes a revision rather than a repository commit.
SHA256 of the vendor bytes: `d020a61801608e4832097d69de75281096b5bffbad7f36c2e342830c0180d5a0`.

`openapi.json` is the contract converted from those bytes with twin-world's
`scripts/spec-discovery-to-openapi.ts`:
`bun ../twin-world/scripts/spec-discovery-to-openapi.ts gemini/spec/discovery.json gemini/spec/openapi.json --fetched 2026-09-30`.
SHA256: `cd900d7327ecaab1bdc31b0b650ae77856ff0dacf92467cfc9bcc683d18efb7f`. Flat paths distinguish models, tunedModels and dynamic methods.
The original Discovery schemas and metadata are retained. Corrections: none.

Read by the contributor against the Gemini API reference and the applications' pinned clients.
Reference examples and stated rules are in `doc-examples.json`; checked citations are in
`sources.json`. Both retain their source URLs.

The reference pages were read with twin-standard's read-page tool, never by calling the API:
- https://ai.google.dev/api/generate-content: REST and SDK requests, JSON/SSE responses, safety,
  generation configuration, function calls and system instructions.
- https://ai.google.dev/gemini-api/docs/models and /deprecations: model aliases and release/shutdown dates.
- https://ai.google.dev/gemini-api/docs/api-key: AI Studio credential setup and API key headers.
- https://ai.google.dev/gemini-api/docs/tokens: the four-character token estimate.
- https://cloud.google.com/apis/design/errors: canonical Google error envelopes and HTTP classes.
- https://ai.google.dev/gemini-api/docs/image-generation: the model's image dimension table.

SDK examples are recorded as their equivalent API JSON, retaining distinct prompts, schemas,
roles and options; identical language variants share a replay. SDK history includes the actual
preceding answer, captured in the journey. Placeholder file variables are filled with synthetic
JPEG bytes. Uploaded file and cache examples record their setup operations as the gap.

The reference's chat and JSON shell samples contain trailing commas. Their own JSON contract
and valid SDK counterparts contradict that syntax; the samples stay invalid and replay a parse
refusal. Other guide pages (text-generation, thinking, function-calling, structured-output,
google-search, image-generation) currently show Interactions API calls, a separate flow outside
this retained models contract; their Interactions requests supply no generateContent example.
The image dimension table is used as a vendor fact, not rewritten into an Interactions replay.
