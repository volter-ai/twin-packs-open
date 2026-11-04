# @volter/twin-merge

The Merge Gateway twin (Protocol 3), serving what Open Autonomy's model rail calls (and through it RH2's, Volter
Harness's and Substrate's workers) and what Volter Editor's Pi calls in Substrate
([journeys/demand.json](./journeys/demand.json), [journeys/decisions.json](./journeys/decisions.json)) at
api-gateway.merge.dev:

- `POST /v1/chat/completions` (OpenAI's chat completions, streamed and not) on the kernel's `openaiWire`, its usage
  carrying `cost` and the answer `service_tier`;
- `POST /v1/responses` in Gateway's native Responses shape (an output message with `finish_reason`, usage with
  `cost`; streamed as `response.stream` snapshots and a `response.done`, with no `[DONE]`);
- `POST /v1/messages` (Anthropic's Messages, streamed and not) on the kernel's `anthropicWire`, its usage with no cost;
- `GET /v1/models`, the catalogue filtered by provider and vendor, paged by `cursor`/`next_cursor`, each model with its
  `access_required`.

With `include_routing_metadata` (or its header), `routing` names the model and vendor that served and carries
`cost_usd` and Merge's 5% `merge_fee_usd`. Every call is priced from the twin's catalogue (Open Autonomy's default
model at the per-token prices it measured against Gateway, spec/SOURCE.md) and drawn from the organization's credit;
a used-up credit is 402 `budget_exceeded` before any turn. The catalogue also holds Claude Haiku 4.5 at Anthropic's
list prices; a gated provider (Anthropic, for an organization made on or after 2026-09-04 21:00 UTC) is refused 403
`vendor_access_required` until support grants it. Every other operation is `unmodeled`.

**The twin runs no model.** A turn is the World's scenario's when it scripts one (`handlers/merge.json`, one
vocabulary for the three surfaces), else the wires' labeled deterministic stub.

The World's doors: `POST /_twin/organizations` ({ name?, credit_usd?, access? }: a Pro organization and its key, `mg_…`,
made at the World's clock) and `POST /_twin/access` ({ organization_id, provider }: support's grant of a gated provider).
The credential door answers MODEL_GATEWAY_API_KEY and MERGE_GATEWAY_API_KEY.

Gateway's core job is routing API calls, so this pack has no screens. Its dashboard-only organization and access acts
are World doors. It serves native Responses without an OpenAI wire-format or Codex originator header; stored Responses,
routing policies, Management API resources, media and the other operations in `unmodeled` answer the gap.

A native Responses request uses an array of input messages:

```js
const response = await fetch("https://api-gateway.merge.dev/v1/responses", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.MERGE_GATEWAY_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "zai/glm-5.3-flash", input: [{ role: "user", content: "hello" }] }),
});
console.log(await response.json());
```

A World scenario can script a tool call in `handlers/merge.json`:

```json
{
  "handlers": [{
    "id": "weather-tool",
    "on": { "hasTool": "weather", "lastMessageIsToolResult": false },
    "respond": { "toolCalls": [{ "name": "weather", "arguments": { "city": "Boston" } }] }
  }]
}
```
