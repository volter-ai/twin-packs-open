# @volter/twin-currencyapi

Protocol 3 twin of currencyapi's v3 API. Nothing is served: every spec operation
answers the vendor-shaped JSON gap (`404`, `{"message":"Not Found"}`).
The [status-code documentation](https://currencyapi.com/docs/status-codes) declares
404 for an endpoint that does not exist and a human-readable `message`; it does
not specify the unknown-endpoint message, so the pack uses `Not Found`.
No vendor resource, screen, credential door or refresh is served.

Dub's FX-rate refresh requires an operator-supplied `CURRENCY_API_KEY`, absent
from its shipped defaults. The pinned configuration is recorded under `optional`
in `journeys/demand.json`. No demanded customer act remains, so the life is empty.
Published examples remain in `spec/doc-examples.json` and count as unserved.
`spec/SOURCE.md` preserves the vendor's document, its hash and error corrections.
