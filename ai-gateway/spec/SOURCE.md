# Vercel AI Gateway

- **Why this document:** Vercel publishes no OpenAPI document of its AI Gateway. This document is written from its
  pages and its SDK, one operation per endpoint, each naming its source (`externalDocs`):
  - https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions (the OpenAI-compatible API at
    `https://ai-gateway.vercel.sh/v1`: models, a model, chat completions, embeddings, and the error body), fetched
    2026-09-30;
  - https://unpkg.com/@ai-sdk/gateway@4.0.80/dist/index.js (the AI SDK protocol at `https://ai-gateway.vercel.sh/v4/ai`:
    `/language-model`, `/embedding-model`, `/config`, and `/v1/credits`, as the published `@ai-sdk/gateway` 4.0.80 calls
    them) with https://unpkg.com/@ai-sdk/provider@4.0.14/dist/index.d.ts (the LanguageModelV4 call and its result).
- **Recorded:** `recordings/2026-09-30-models.json.gz`, Vercel's `GET https://ai-gateway.vercel.sh/v1/models` on
  2026-09-30; `../src/engine/catalogue.ts` is its `data`, each model's fields as the list answers them, which the
  twin answers as its catalogue.
- **Corrections:** `patches.json` adds fields present in the catalogue recording but absent from the reference-derived schema. `recordings/models-fields.json` contains unchanged decoded models demonstrating each field, with provenance.
- **Read by:** the twin orchestrator, 2026-09-30.
- **Vendored bytes (sha256):** `openapi.json` `6c13f1b5685d1f8dfda7bdbc8827257ebe4a367fe9b0d506e1e734a3b4b605a3`.

- **Published examples read 2026-10-01:** the OpenAI-compatible reference above, and its `/chat-completions`, `/streaming`, `/tool-calling`, `/structured-outputs`, `/images`, `/reasoning`, and `/advanced` pages. Only request-language variants with identical wire bodies are one example; distinct image/PDF SDK bodies and message/options fragments are replayed separately; the legacy JSON body remains a separate example. `doc-examples.json` records their sources.

- **Native evaluation protocol:** https://unpkg.com/@ai-sdk/gateway@4.0.87/dist/index.js and https://unpkg.com/@ai-sdk/provider@4.0.18/dist/index.d.ts, the versions installed by Dub at its scanned commit. GatewayEvaluationModel serializes state/questions/providerOptions to /evaluation-model with ai-model-id and parses named boolean, choice and score answers. No model quality is reproduced; answers are a World scenario or a labeled stub.

**Retained SDK source bytes:**

- `gateway-4.0.87-index.js.gz`: https://unpkg.com/@ai-sdk/gateway@4.0.87/dist/index.js; immutable published package version `4.0.87`; SHA-256 of uncompressed retained bytes `42eb5c57cacd7150789ad6ca959c4330c50bac159853babae9c92c3cb3126602`. Dub locks this dependency at application commit `7e0101363b2ab30afc537c1893f159d1dcba513a`.
- `provider-4.0.18-index.d.ts.gz`: https://unpkg.com/@ai-sdk/provider@4.0.18/dist/index.d.ts; immutable published package version `4.0.18`; SHA-256 of uncompressed retained bytes `6bb19f719869b722f36c7375393c3364fcc9811ae1014c814ae0288d1244c35d`. Dub locks this dependency at application commit `7e0101363b2ab30afc537c1893f159d1dcba513a`.
