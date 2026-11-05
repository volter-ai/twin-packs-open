# Relay contract provenance

The relay publishes no OpenAPI document. `openapi.json` describes its HTTP status
operation and carries the verbatim upstream reference sources under `x-reference`.
These sources were read with GitHub's contents API at
`c14b6e36722b20cbb3ee7245c7f555b5c12b376e`, on 2026-10-01.

Upstream: https://github.com/volter-ai/volter-tunnel/tree/c14b6e36722b20cbb3ee7245c7f555b5c12b376e

- `packages/core/src/protocol.ts`: control-channel frames.
- `server-cf/src/worker.ts`: control and visitor routing, reserved hosts and status.
- `server-cf/src/tunnel-do.ts`: registration, refusals, forwarding, buffering and streaming.
- `server-cf/src/credits.ts`: account-slug validation.
- `server-cf/src/auth.ts`: visitor cookie and query sanitization.
- `server-cf/wrangler.jsonc`: relay domain.
- `README.md` and `client/tunnel-client.ts`: the published client usage and its relay connection.

Version: relay protocol 2. Corrections: none. The HTTP document was written
from these sources; the reference strings preserve the upstream bytes, without
changing the vendor's contract to match the twin.

Vendored bytes (sha256): `openapi.json` `e9dc4d9a6396473c3f1e1d14b5fbfb4567e0fbe23fb16e2f47fc3bf3b9b5ea73`.

The served contract is Harness's public, unauthenticated HTTP relay. The management
API, visitor WebSocket bridging, quotas, JWT/basic-auth gates, inspector, usage
snapshots and reservation expiry are outside the demand represented here.
No HTTP API operation is served; the status operation is an explicit gap.
The vendor publishes no request/answer examples for a served HTTP operation:
the client sample is a program, not an HTTP request/answer example the replay tool
can route. The customer life exercises the control frames and visitor responses.
