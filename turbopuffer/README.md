# @volter/twin-turbopuffer

Protocol 3 twin of turbopuffer's API. Nothing is served: every spec operation
answers the vendor-shaped JSON gap (`404`, `{"status":"error","error":"not found"}`).
The [API overview](https://turbopuffer.com/docs/auth) documents this error envelope;
the pinned SDK maps 404 to `NotFoundError`. The vendor does not publish the exact
unknown-path message, so the pack uses `not found` in that envelope.
No vendor resource, namespace engine, screen, credential door or refresh is served.

Dub partner search requires an operator-supplied `TURBOPUFFER_API_KEY`; reads also
need `PARTNER_SEARCH_READ_ENABLED=true`. Both ship empty. The pinned settings are
recorded under `optional` in `journeys/demand.json`, and the life has no acts.
Published examples remain in `spec/doc-examples.json` and count as unserved.
`spec/SOURCE.md` preserves the vendor's document, its hash and path corrections.
