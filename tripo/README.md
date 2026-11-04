# @volter/twin-tripo

The Tripo twin (Protocol 3), serving what Volter Editor calls ([journeys/demand.json](./journeys/demand.json),
[journeys/decisions.json](./journeys/decisions.json)): `GET /v2/openapi/user/balance`, the call the editor's Account
settings test a connected key with, answered in Tripo's envelope (`code` 0, `data.balance`, `data.frozen`); a key no
account holds is 401 code 1002. The declared spec retains the complete fixed HTTP surface of Tripo's official
Python SDK 0.4.2 at `4115894a0a603c5183c9ed6dc8662745562c8941`, including v2 and v3 task/upload operations
([spec/SOURCE.md](./spec/SOURCE.md)). The retained reference bytes establish the document’s sources.

The World's door: `POST /_twin/accounts` ({ balance? }: an account with its credits, and its API key, `tsk_…`). The
credential door answers TRIPO_API_KEY.

Task generation, both upload channels, polling and v3 segmentation are declared gaps: the demanded editor and
customer life call none of them. Their published examples remain in the inventory as unserved examples.
Account management and real account refresh are outside the served integration.
Credits and keys are World account fixtures; the pack declares no vendor-backed half. The conservative rate budget
is the procedure's fallback of 30 requests per minute because these sources state no per-minute allowance.

Screens are not required by this API integration: the measured caller tests a credential by reading balance.
Balance is served only on api.tripo3d.ai and api.tripo3d.com, its declared v2 hosts. The v3 hosts claim only /v3 paths.
The account door stands in for platform account/key tooling; no browser dashboard or billing flow is demanded.
Unknown unprotected URLs use the captured front's HTML 404; the protected v2 prefix and declared v3 bearer paths authenticate before routing.
Authenticated unknown-path and v3 unknown-response bodies are not established by these sources, so the retained
front 404 is used at that documentation boundary. The examples replay the retained unknown-request recordings, proving the front 404 and protected-prefix 401. The editor uses fetch and has no official-SDK client cases.
