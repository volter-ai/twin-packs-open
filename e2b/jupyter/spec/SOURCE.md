# Code interpreter spec provenance

`openapi.json` is authored from the official SDK `@e2b/code-interpreter` 2.7.1, as pinned by Twenty's yarn.lock (https://registry.npmjs.org/@e2b/code-interpreter/-/code-interpreter-2.7.1.tgz), and https://github.com/e2b-dev/code-interpreter/blob/11d8a0fc64d284dec0403df31b09fd58a916516f/template/server/main.py and its `stream.py`, fetched 2026-10-01. No standalone published OpenAPI spec was found. The SDK sends `POST /execute` to port 49999 with code, context_id, language, env_vars; the server streams one JSON event per line and end_of_execution. Only that demanded operation is modeled; context management is outside this scope. No corrections.

SHA-256 of `openapi.json`: `22765b46076aba0bc40551f422181be1cc05553e9cf706eaf1d80c091bc5a34f`.

`doc-examples.json` records the SDK examples translated through the exact HTTP requests in Twenty's pinned client. Pages read on 2026-10-01: https://docs.e2b.dev/quickstart. These pages publish code, not JSON response samples; values determined by setup are asserted by the replay.
