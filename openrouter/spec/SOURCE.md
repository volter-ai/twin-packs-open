# OpenRouter's API

- **Why this document:** OpenRouter's own OpenAPI document, as it serves it at `https://openrouter.ai/openapi.json`
  (fetched 2026-09-30, vendored gzipped and unchanged), the document its SDK (`@openrouter/sdk`, Speakeasy) is generated
  from. Version 1.0.0; 108 paths, 142 operations; server `https://openrouter.ai/api/v1`.
- **SHA-256 of the vendor's bytes** (uncompressed): `a1c912c1a574e55163172f5e77a3adecd87238f65ad9929a7e99a7ff067c4208`.
- **Its pages** (2026-09-30 and 2026-10-01): the API reference overview (the response and finish reasons), streaming (the
  SSE comments and the final usage chunk), errors and debugging, limits (credit and rate limits, `GET /api/v1/key`), OAuth
  PKCE (the `/auth` page and the key exchange) and the Claude Code integration (the Anthropic Messages surface at
  `https://openrouter.ai/api`); and the model pages of the twin's catalogue (`openai/gpt-4o`, `z-ai/glm-5.2`,
  `anthropic/claude-opus-4.8`: each one's price, context, completion limit, input modalities and release date).
  Every page cited is recorded in `sources.json`.
- **Corrections:** none.
- **Additional sources read 2026-10-01:** the Responses overview (stateless-only storage rules);
  the linked API overview, OAuth, streaming, limits, error and Claude Code pages, whose request examples and rules are
  transcribed in `doc-examples.json`; GPT-4, Claude Sonnet 4, GPT-5.2 and o4 Mini model pages (their prices, windows and release dates).
  The current pages' historical latest-model aliases have no dated binding; the examples journey records them explicitly.
- **Read by:** `bun scripts/derive-pack.ts openrouter`.
