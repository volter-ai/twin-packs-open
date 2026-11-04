# @volter/twin-ai-gateway

Vercel AI Gateway (Protocol 3), for LibreChat's configured Vercel custom endpoint and applications using the published AI SDK gateway protocol. [Demand](./journeys/demand.json) records the current application commits and exclusions. [SOURCE](./spec/SOURCE.md) records the reference-derived spec and catalogue capture.

It serves the recorded model catalogue at `/v1/models`, OpenAI-compatible Chat Completions at `/v1/chat/completions`, and AI SDK LanguageModelV4 generate results and SSE parts at `/v4/ai/language-model`. Both inference wires support text, tool calls and results, JSON schemas, and streamed replies through the shared kernel wire.

The World runs no model. Its scenario in `handlers/ai-gateway.json` scripts text, tools or faults; otherwise answers are labeled deterministic stubs. Catalogue data is a fixed vendor recording. Keys and issued ids are private World bookkeeping. No served call creates vendor-stored resources or emits webhooks.

`POST /_twin/app-credentials` issues a synthetic bearer key and fills `AI_GATEWAY_API_KEY`. The door stands in for dashboard key creation. Authentication failures use the gateway error envelope. Model retrieval, embeddings, AI SDK config and credits remain explicit gaps. No numeric per-minute allowance is established by the vendored reference; the live-call budget uses the platform fallback of 30 per minute.
