# @volter/twin-openai

A local OpenAI API. It serves the calls the applications make (`journeys/demand.json`):

## Use with an existing app

Use Node 22.6 or newer.

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.147 @volter/twin-openai@3.0.3
./node_modules/.bin/volter world init --name my-app --twins openai --source openai=@volter/twin-openai
```

Run the local executable from this app’s folder; if it is missing, complete the installation here before continuing.

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


- the Responses API (Twenty, Rallly, Postiz and LibreChat, through the AI SDK's OpenAI provider and the openai SDK);
- Chat Completions (Workbench's agent, the on-call cookbook, Postiz, LibreChat), the models list, Files, Images (generations
  and edits), moderations, transcriptions and text to speech;
- LibreChat's Assistants v2: assistants, threads, messages, runs and their steps and tool outputs.

Around it are the dashboard pages (`platform.openai.com`: the log in and a project's API keys). The twin runs no model:
a turn is the World's scenario's, else a deterministic stub labeled `[twin-stub:<model>]`.

A Protocol 3 pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)). Its surface is generated
from OpenAI's published OpenAPI document (`spec/`). The derived core serves plain reads and writes. Handlers are in
`src/semantics/<family>.ts`, the scenario adapter in `src/semantics/scenario.ts`, and pages in `src/screens`.

```bash
world-openai serve [--port N] [--root DIR] [--read-only]
```

## What it models

- **Keys**:
  - A project key is made on the project's API keys page (shown once, held by its SHA-256), or issued to a World's
    applications by the credential door.
  - A request with no key, or one the organization never made, is refused 401 `invalid_api_key`. So is a revoked key,
    or one of an archived project.
- **Responses**:
  - `POST /v1/responses`, streamed (named events, ending with `response.completed`) or not.
  - Function tools the stub calls while no tool output is pending; `previous_response_id` carrying the conversation.
  - Structured output (`text.format` with a JSON schema) the stub answers with a value the schema admits.
- **Chat Completions**: the answer or its `chat.completion.chunk` stream ending with `[DONE]`, and tool calls.
- **Assistants v2**:
  - A run is worked when a read first looks at it.
  - A run with function tools stops at `requires_action` for their outputs, then completes with a stub reply. A run
    in flight can be cancelled. A run still waiting on its outputs at its `expires_at`, ten minutes after it was
    created, expires and refuses them.
  - The thread's messages and the run's steps are kept.
- **Files**: uploaded (multipart), read, downloaded, deleted. Missing locally held bytes are refused; refreshed file metadata does not supply content.
- **Images**: `POST /v1/images/generations` and `POST /v1/images/edits` answer a labeled placeholder image. DALL-E default URLs serve those bytes through the media lane for 60 minutes.
- **Moderations**: `POST /v1/moderations` classifies each input deterministically: text naming a category's own words is
  flagged in it, with its categories and scores; no model runs.
- **Speech**: `POST /v1/audio/speech` answers an audio file in the format asked (mp3 unless named), billed by the
  characters it reads.
- **Transcriptions**: `POST /v1/audio/transcriptions` answers a labeled stub transcript, with the WAV duration from its header; other formats use a synthetic one-second duration.
- **Models**: a static catalog.
- **Realtime**: `wss://api.openai.com/v1/realtime` (Volter Harness's voice): every client event the reference lists: the
  session, the input audio buffer (append, commit, clear; no speech is detected in it), conversation items (create,
  retrieve, truncate, delete) and responses as events; `output_audio_buffer.clear`, WebRTC's and SIP's, is refused on the
  WebSocket. A response is the World's scenario's turn, else the labeled stub, spoken as silence with its transcript.

The subscription surface serves Open Autonomy, RH2, Browser Substrate and Volter Harness. On `auth.openai.com` it supplies browser consent with localhost callback, state and S256 PKCE, device user-code polling, authorization-code exchange, refresh and revocation. On `chatgpt.com/backend-api/codex` it serves Responses over HTTP/SSE and WebSocket, compaction and per-account model discovery. The native TUI’s `/backend-api/wham` usage, token activity, workspace-message and reset-credit views use a synthetic Plus account with no purchased credits. Account limits and expiry are explicit local policy where the private documentation gives no number. HTTP and socket model turns use configured scenarios or labeled deterministic stubs.

## Doors

- `POST /_twin/accounts {email, name, password, role?}`: a person of the World's organization, who logs in to the
  dashboard.
- `POST /_twin/app-credentials`: the Default project and a key for it, as the runtime issues them to a World's
  applications. It also issues the World’s synthetic subscription account and signed tokens; `CODEX_HOME` is filled with a private directory containing Codex’s `auth.json` and file-storage config. The hosted browser/device pages accept the door’s `codex_email` and `codex_password`. No production account or key is used.

## Not yet

Embeddings, fine-tuning, batches, uploads, evals, containers and the Admin API answer the documented gap.
Vector stores supply the empty store and its readbacks that the published file-search examples require; the twin
performs no embedding or retrieval. Stored chat completions and Responses support their published readbacks.
The dashboard is limited to credential issuance; model calls are the product surface.

Undemanded private cloud tasks, remote configuration, account checks and workspace policy settings answer HTTP 404 in the pinned client’s accepted error envelope. Native cloud commands, remote control and experimental voice/plugin flows are outside these products’ configured subscription runtime; independently demanded REST and Realtime calls are described above.
