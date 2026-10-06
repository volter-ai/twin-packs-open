# Codex subscription backend and authentication

OpenAI publishes the Codex CLI, not a machine-readable public specification of these private endpoints. The specification is extracted from OpenAI’s own pinned client source, not from another twin. Browser Substrate pins release 0.151.0, tag rust-v0.151.0, commit `78c290807ce710180111df227df3b7a4fe845452`. Open Autonomy installs 0.156.1 (b412ff32c417f855c2b2d1581b77058eed87c84b); Harness’s container defaults to 0.153.4 (3d2ee51ca2d5db578f328aa75e20aa22c0197c9a). Those clients keep the same sign-in and inference paths. The retained 0.151.0 bytes define the common wire and its response types.

`provenance.json` names every retained file under `vendor/`, its raw upstream URL, commit and SHA-256. `extract-client-ops.py` reads these vendor bytes and writes `client-ops.json`; `sources.json` records checked citations. The client’s authentication behavior is evidence in `journeys/decisions.json`, exercised by the customer life; it is not a published request/answer example. `doc-examples.json` is empty because the public authentication page supplies no such examples. Read by the author and `derive-pack`. The table below and `provenance.json` retain every source hash; the extracted specification and provenance record have `.sha256` sidecars. Browser authorization and the device verification URL are hosted screens: the CLI opens their URLs rather than making an HTTP API request; they are retained as source and declared in the manifest, outside the extracted HTTP calls.

Public material: https://developers.openai.com/codex/auth (redirects to https://learn.chatgpt.com/docs/auth). It documents browser/device login, token caching and refresh, but supplies no HTTP examples or endpoint response schemas. `auth.html.gz` retains the page bytes, SHA-256 in `auth.html.gz.sha256`. Local sign-in UI combines account selection and consent; its form field names, deterministic code lifetimes and synthetic Plus account are twin choices, not claims about the private production UI. A World issues only its own tokens. Unsupported private operations answer HTTP 404 in the client’s error envelope; the client accepts unsuccessful status codes and carries their response body (backend-client exec_request). Public material does not specify a private error message, token lifetime or per-minute allowance: the twin uses the architecture’s 30/minute fallback, access lifetime one hour, refresh lifetime thirty days and code lifetime ten minutes.

## Retained upstream bytes

| File | SHA-256 |
|---|---|
| `vendor/tui/src/app/startup.rs` | `5b3dc2f115bc84fde6ced0b382333aa23a0e3782b6f910e56c6b62af758ee43b` |
| `vendor/http-client/src/request.rs` | `31ff5c821eca9606e184fcc829a4faa6ec5bf535ec610cae73cd93abc3361412` |
| `vendor/app-server/src/request_processors/account_processor.rs` | `28a1eccde11818dbcc30ce2d4f81cd9bfbe94ca74cfd8189a07726453d26fdaa` |
| `vendor/backend-client/src/client/rate_limit_resets.rs` | `52b114dff7c1e47bfc30835012565d8530b190c6f7d7069820eba24d77ed9773` |
| `vendor/backend-client/src/client.rs` | `65c44121a72624e66076e301e757c7d6cfbcf87340694552e199d1aa2dfbb7f0` |
| `vendor/backend-client/src/types.rs` | `2ecb27e908fb56a85002ff4632733d5c35a8e011f53b9cce34e7f57047c8da9b` |
| `vendor/codex-api/src/common.rs` | `f525d1593a01b579dd2dcadf96744888b4a7529155dddbf74963ba55cf7f23d5` |
| `vendor/codex-api/src/endpoint/compact.rs` | `2532b11307ac1df7d04df80d257beeaf9ee47b915a2955a6255eec524d7eb33b` |
| `vendor/codex-api/src/endpoint/models.rs` | `31a685084b8d0fb0b6fd2957c320030fad25a643610e3111f687e99603ca09b6` |
| `vendor/codex-api/src/endpoint/responses.rs` | `60d4feb9c17b958ac030c30caaf9016cd8db08dffbcbb30b1dbee8d1e3f9ca1c` |
| `vendor/codex-api/src/endpoint/responses_websocket.rs` | `049b447707bb637bf0696d748bb288af0cc886e92a9928eec2bc62eff0821421` |
| `vendor/codex-backend-openapi-models/src/models/rate_limit_status_details.rs` | `38935bb0f24cbb60bb9def3426fdd44bdec75dee92d8c0396698e851f122c00a` |
| `vendor/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs` | `e9ba3c029a12c41f45b74fcaa89e02fc7829482bd35d1e3cc7ded6fb7ae8950f` |
| `vendor/core/src/client.rs` | `113bde60551abdbf96e3603b4f1754a072886e712ef0d0049f360a64dddec375` |
| `vendor/login/src/auth/manager.rs` | `4d87ff71ed3c85f3247304fa836ab8680f2b42911d90ba37e3b060bd9b192c44` |
| `vendor/login/src/auth/revoke.rs` | `db4490daaeb89bf781d05ceeeb53f2291e4729caea2b62a635d61c98e305223e` |
| `vendor/login/src/auth/storage.rs` | `2e95a8998687e926675d41b5d941c3c3546a652c03d9680e6c7385e59bf459af` |
| `vendor/login/src/device_code_auth.rs` | `78bfe08f18fa89c84b261c5e11269239a06bb60cb0a964fbe8532ccede4ba328` |
| `vendor/login/src/server.rs` | `59ea616627e40ba9682eab03b4c3d57ecbdc66557f188d354fbf6dee0ec1d6ea` |
| `vendor/login/src/token_data.rs` | `cbb2403b8db562c9e285c1fbd8589b6130d5e36b631d1d8ba66525a6d9dd67c8` |
| `vendor/model-provider-info/src/lib.rs` | `4457c4a78a3adb7a926ff3756ee56d4e2c103007e5b6cc23413cec8bc822bd9a` |
| `vendor/models-manager/models.json` | `eb0d7b9a5dcaf103895c5f8a14c16b269df46e039b375a55ba97f6238542d2ed` |
| `vendor/models-manager/src/manager.rs` | `00a120284c6b1c6549fa39ae938a72cb6cfd40f683878fabdcc22f9216799f9c` |
| `vendor/tui/src/app/background_requests.rs` | `324a87d91992b1a00ff737cb12e00e33b9a0a24a8a38661a4e27df1298e3c0ba` |

## Request encoding and account usage callers

The retained `core/src/client.rs:1527-1536` selects Zstd only when request compression is enabled, the credential uses the Codex backend, and the provider is OpenAI. Otherwise it sends uncompressed JSON. `codex-api/src/endpoint/responses.rs:163-180` forwards that choice; `http-client/src/request.rs:42-47,190-213` selects only None or Zstd and emits Content-Encoding: zstd at compression level 3. A pre-compressed JSON turn is retained as raw bytes in the life, using the existing kernel decoder. WebSocket deflate negotiates its own frame transport; it is not an HTTP body Content-Encoding.

Browser Substrate launches the interactive native Codex program (`programs/codex/0.151.0/browser-program.json:20-24`). For ChatGPT authentication, TUI `app/startup.rs:670-683` calls `refresh_rate_limits`; `app/background_requests.rs:80-104,786-798` sends GetAccountRateLimits, and the app-server `account_processor.rs:1131-1160` reads the backend usage. OA and RH2 only call getAuthStatus (`.open-autonomy/codex-auth.ts:74`) and proxy the codex path (`valve.ts:102-125`, OA shifted one line); neither is attributed the separate usage request. Harness usage attribution is also removed: the cited sign-in action alone does not prove a usage read.
