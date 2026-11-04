# @volter/twin-cohere

Protocol 3 Cohere API twin derived from the vendored OpenAPI document. It serves
`POST /v2/rerank` on `api.cohere.com` and `api.cohere.ai` for LibreChat's shipped web-search feature with the end user's own in-app key. [Demand](./journeys/demand.json) records the user flow; the [customer life](./journeys/customer-life.outline.md) uses the
request body sent by its pinned `@librechat/agents@4.0.1` adapter. Other API
operations answer the vendor-shaped gap.

The twin runs no model. It ranks Unicode-word overlap with the query, keeps
original document indices and stable ties, and labels that stand-in in
`meta.warnings`. `top_n` limits results; document and query budgets truncate
Unicode words, an explicitly labeled approximation of Cohere tokens. Valid
`priority` values are accepted and bounded; this immediate compute path has
no inference queue or load. Semantic quality, model tokenization, latency and
load-dependent scheduling are not simulated. The documented model catalogue
and release dates gate requests on the World clock.

Bearer credentials are checked through the kernel's held-key mechanism.
`POST /_twin/app-credentials` stands for dashboard key creation and returns
the same World application key on resume, filling `COHERE_API_KEY`.
The adapter's `COHERE_API_URL` points at `/v2/rerank`. Keys are held by SHA-256;
no vendor resource is stored by reranking, so there is no vendor-backed refresh
or deploy. The live-call rate budget uses the documented trial tier, 10/minute.

Cohere's core job here is an API call; the console provides incidental credential
and billing setup, so this pack has no screens. Reference, overview and release
requests, plus applicable stated rules, are in
[doc-examples.json](./spec/doc-examples.json) and replayed by the examples journey.
The generated [score](./journeys/score.json) and
[coverage](./journeys/coverage.json) report the current walks; the final independent
judging and conformance belong to the repository procedure.
