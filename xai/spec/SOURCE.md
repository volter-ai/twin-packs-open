# xAI API sources

`openapi.json` is xAI's unmodified OpenAPI 3.1 document, version 1.0.0, fetched 2026-09-30 from https://api.x.ai/api-docs/openapi.json. The vendor serves this document without a repository commit identifier.

SHA-256: `6564a1dec83b648701973dee3b336491916b728fbe6bc8a66f022562c08062f0`.

Read 2026-10-01. No spec corrections.

Reference pages read (2026-10-01):
- https://docs.x.ai/developers/models.md — current model identifiers, encrypted reasoning.
- https://docs.x.ai/developers/debugging.md — status classes and Console credentials.
- https://docs.x.ai/developers/rest-api-reference/inference/chat-completions.md — chat wire and published requests/answers.
- https://docs.x.ai/developers/rest-api-reference/inference/responses.md — Responses wire and published requests/answers.
- https://docs.x.ai/developers/model-capabilities/text/reasoning.md — reasoning configuration and encrypted output.

The model catalogue is the snapshot these pages document; no historical release dates are inferred. Journeys use that snapshot's date. The spec's `latest` sample identifier is accepted for replay, without inferring its underlying model.

The reasoning guide's native xAI SDK snippets do not identify a REST transport. Its OpenAI, AI SDK and curl snippets supply three distinct Responses requests; equivalent wrappers are recorded together in spec/doc-examples.json. The guide prints projectile reasoning below the ball curl request, so that prose is not asserted as the ball answer.
