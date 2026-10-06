# @volter/twin-anthropic

A local Claude API. It serves Messages (`api.anthropic.com/v1/messages`, streamed and not), token counting and the
model list, the calls Dub, Twenty, LibreChat and Claude Code make ([journeys/demand.json](./journeys/demand.json)). Around it are the Console's pages
(`platform.claude.com`) where the API keys are made. The twin runs no model: a turn is the World's scenario's, else a
labeled deterministic stub.

## Use with an existing app

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.67 @volter/twin-anthropic@1.0.3
npx volter world init --name my-app --twins anthropic --source anthropic=@volter/twin-anthropic
```

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
npx volter world up
npx volter world run -- npm test
npx volter world log
npx volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


A Protocol 3 pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)). Its surface is generated
from the OpenAPI document Anthropic's TypeScript SDK is generated from (`spec/`). Handlers are in
`src/semantics/messages.ts` and `src/semantics/models.ts`, the key front in `src/semantics/around.ts`, the scenario adapter in
`src/semantics/scenario.ts`, and pages in `src/screens`.

```bash
world-anthropic serve [--port N] [--root DIR] [--read-only]
```

## What it models

- **Keys**:
  - `Authorization: Bearer` or the legacy `x-api-key`. A missing, mistyped, disabled, deleted or expired key is `401
    authentication_error`.
  - `anthropic-version` is required.
  - Every answer carries a request id.
- **Messages**:
  - the request checked as the API checks it (the model in the workspace catalog and released on the World clock, `max_tokens`, the thinking budget's rules,
    manual thinking refused on Claude 4.7 and later, `tool_choice` naming an offered tool);
  - the answer (`msg_…`, content blocks, `stop_reason`, `usage`) or its server-sent events: `message_start`, each
    block's start, deltas (`text_delta`, `thinking_delta` and `signature_delta`, `input_json_delta`) and stop,
    `message_delta` and `message_stop`;
  - each also as its `?beta=true` operation.
- **The turn**: the scenario's `respond` (`text`, `toolUses`, `serverTools`, `thinking`, `stopReason`), or a stub that:
  - calls the chosen (else the first) tool while no tool result is pending;
  - answers a value the structured output's schema admits (`output_config.format`, or the beta's `output_format`);
  - otherwise echoes the last message, labeled.
- **Tokens**: text at four characters a token, an image at `⌈width/28⌉ × ⌈height/28⌉` visual tokens (read from a PNG's
  or JPEG's header, at most the model's limit). Token counting (`?beta=true`, as Claude Code sends it) answers the same count with no message made.
- **The prompt cache**, per workspace:
  - a prefix per `cache_control` breakpoint, in the order tools, system, messages;
  - written with its lifetime (5 minutes, or 1 hour) and read while live, each read refreshing it;
  - a prefix under the model's minimum is not cached.
  - `usage` reports `cache_creation_input_tokens`, `cache_read_input_tokens` and `cache_creation`.
- **Models**: `GET /v1/models`, the models an organization can use, newest first, paged by `after_id`/`before_id`,
  each released by the World clock, with its limits, thinking and effort as its documentation page states them.
- **The Console**: sign-in by an emailed code; the API keys page (create with an expiration, shown once; disable,
  re-enable, delete).

A scenario's `toolUses` is an array of `{ name, input }` calls; `thinking` is a string. For synthetic web search,
`serverTools` is an array of `{ name: "web_search", input: { query: "..." }, results: [...] }`. Each result has
`type: "web_search_result"`, `url`, `title`, `encrypted_content` and optional `page_age`. These scripts describe
local fixture output and must match a tool the request offers; tool choice and parallel-use restrictions still apply.

## Doors

- `POST /_twin/users/{email} {organization}`: a person's sign-up, admin of a new organization and its Default workspace.
- `GET /_twin/mailbox/{email}`: the mail the Console sent them.
- `POST /_twin/api-keys {email, organization?, name?}`: issue a workspace key without driving the incidental Console.
- `POST /_twin/app-credentials {}`: issue or resume the World application's key.

## Not yet

Message Batches, Files, Skills, Managed Agents, the Admin API, the non-beta token count and the other beta surfaces:
no application calls them. Web search can be scripted as synthetic server_tool_use/web_search_tool_result blocks using respond.serverTools; no hosted search runs. Unconfigured hosted tools, code execution and trusted-access Mythos models answer the documented error class.

The Console pages model only credential setup and revocation already required by the customer life. The served API is stateless; Console setup stays local and this pack has no vendor-backed deploy or refresh. The product's core work is its API; this pack adds no chat or generation dashboard. Text token counts and signatures are deterministic local approximations, not a tokenizer or valid model-generated reasoning.
