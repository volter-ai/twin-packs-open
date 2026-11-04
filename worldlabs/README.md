# @volter/twin-worldlabs

The Protocol 3 World API credential-check scope for Volter Editor ([demand](./journeys/demand.json), [decisions](./journeys/decisions.json)). It serves `POST /marble/v1/worlds:list` with `WLT-Api-Key`, validating page sizes from 1 to 100. Issued accounts have no generated worlds, so a successful check returns `worlds: []` and `next_page_token: null`.

`POST /_twin/accounts` stands for Platform account/key issuance and fills `WORLDLABS_API_KEY` with a throwaway credential. This scope stores only local account/key bookkeeping and refuses binding to a real-system root. Populated live accounts, generation, media upload, operations, exports, credits, deletion and the Marble creation UI are outside it; those API operations answer the gap. The vendor-backed half cannot be claimed from an empty-list credential test.

No screens are supplied: this scope is the World API used by code, with the Platform key/billing pages represented by the credential door. The Marble creation canvas is outside the measured demand. The rate budget uses the kernel's conservative fallback; the published generation-start limits do not describe this list call.

The spec and evidence limits are in [spec/SOURCE.md](./spec/SOURCE.md), including prior gateway 401 observations whose original recording was not retained.
