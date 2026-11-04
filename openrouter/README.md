# @volter/twin-openrouter

The OpenRouter twin (Protocol 3), derived from OpenRouter's own OpenAPI document (`spec/`), serving what the
applications call ([journeys/demand.json](./journeys/demand.json)):

- `POST /api/v1/chat/completions`: a `gen-` id, the provider, the model, one choice with its normalized and native
  finish reasons (`length` when `max_tokens` cuts it) and its message (text, reasoning when asked, or tool calls), and
  the usage with its cost. Streamed, it is OpenRouter's SSE: a `: OPENROUTER PROCESSING` keep-alive, the deltas, a final
  chunk carrying the usage, then `data: [DONE]`. A JSON response format answers a value its schema admits.
- `POST /api/v1/auth/keys`: OAuth PKCE's exchange of a code for a key, checked against the challenge (S256 or plain);
  a code works once and for ten minutes.
- `POST /api/v1/messages` (Anthropic's Messages, streamed or whole; a refusal in Anthropic's error body) and
  `POST /api/v1/responses` (the Responses API, streamed or whole): the coding agents Volter Editor points at OpenRouter.
- `GET /api/v1/key`: the current key (its masked label, creator, no limit, usage 0).
- `GET /api/v1/models`: the twin's dated catalogue at the per-token prices their pages state, no key needed,
  paged by offset and limit.
- `openrouter.ai/auth` (a screen): a person approves an application, and is sent back to its `callback_url` with a code
  (or shown the code, with no callback).

Every other operation is `unmodeled`.

**The twin runs no model.** A turn (chat completions, Responses or Messages) is the World's scenario's when it scripts one (`handlers/openrouter.json`: `on`
modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult, toolResultFor, hasTool; `respond` text,
toolCalls, reasoning, finishReason; operationEquals can scope a rule), else a labeled deterministic stub. Only the dated catalogue is served; unknown and not-yet-released models are refused. A generation's cost is 0. Responses requests are stateless: `store: true` and a non-null `previous_response_id` are refused.

## Credentials

`Authorization: Bearer sk-or-v1-…`, kept by its SHA-256. The World's application is issued its key when the World boots:
`POST /_twin/app-credentials` (the descriptor's credential door) answers `OPENROUTER_API_KEY`. `/models` needs no key, and `/messages` answers a missing or unknown key in
Anthropic's body (401 `authentication_error`).

## Doors

- `POST /_twin/app-credentials`: the application's key.
- `POST /_twin/users {email, name?}`: a person who signs in at openrouter.ai.
- `POST /_twin/keys {email, name}`: a key of theirs, shown once.

All successful inference replies carry X-Generation-Id. Scenario generation faults can simulate typed provider failures after admission, including partial chat output and terminal SSE errors; no model runs. Catalogue filters use the dated snapshot; filters needing live routing, policy or benchmark facts are explicitly refused.

Scenario status faults also cover key, catalogue and PKCE exchange outages; those operations refuse scripted success. Guardrail configuration, live provider routing, tokenization and upstream debug payloads are outside this pack.
