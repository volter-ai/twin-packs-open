# @volter/twin-xai

Protocol 3 xAI inference for Twenty workspace agents and the Volter World Grok chat redirect. The measured callers are in [journeys/demand.json](./journeys/demand.json).

Serves `POST /v1/chat/completions` and `POST /v1/responses`, JSON and SSE, function calls/results and structured output. The kernel OpenAI wire renders scripted scenarios or labelled deterministic stubs. No model or live web/X search runs. The Responses output includes the current model's encrypted reasoning placeholder where documented.

`POST /_twin/app-credentials` issues or recovers the World's application key (`XAI_API_KEY`). `POST /_twin/api-keys {name}` stands in for creating an additional Console key. Keys are drawn from World secrets and stored as hashes; requests use Bearer authorization.

The catalogue is the vendor documentation snapshot, with the spec's `latest` sample identifier accepted without resolving it to a particular model. Stored response retrieval, previous-response continuation, deferred completion and the remaining spec operations are outside measured scope and use the declared gap. See [spec/SOURCE.md](./spec/SOURCE.md) for provenance and [STANDING.md](../STANDING.md) for generated standing.
