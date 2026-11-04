# Bitly Protocol 3 twin

This twin serves Dub's Bitly migration and legacy redirect calls, pinned to the Dub commit in [demand.json](journeys/demand.json). Its surface comes from Bitly's unchanged v4 OpenAPI document and a cited OAuth token patch. It serves account groups, group tags, cursor-paged bitlinks, individual link reads and archive updates, synthetic platform limits, and Bitly's hosted OAuth authorization/code exchange.

The synthetic signup door creates an account, its first group and app registration. It supplies a preexisting synthetic branded domain, `chauncey.ly`; it creates no links. Create links through `POST /v4/bitlinks`. Generic and OAuth tokens belong to the same account; group and link access are tenant scoped. The life creates 101 archive links, changes archive state across sittings, connects Dub through the hosted flow and imports both pages with the API-returned cursor.

Unsupported spec operations and the manifest's explicit variants return the declared `NOT_FOUND` gap. QR codes, campaigns, custom keywords, link expiry, mobile deeplinks, password/refresh grants and redirect edits are outside this import scope. Invalid API credentials return `FORBIDDEN`; absent account subjects return `NOT_FOUND`. Cursors are deterministic local opaque values; quota data is synthetic (30/hour, 3/minute for the live-call guard), not a live Bitly account's allowance. No real credentials are required or retained.

The source facts and their boundaries are in [SOURCE.md](spec/SOURCE.md), [sources.json](spec/sources.json), and source citations. `doc-examples.json` retains complete published requests, including requests outside this surface. For valid JSON transcription, the reference's invalid pseudo-object `{ "any" }` is encoded as the unfilled object marker `"any"`; its spelling is retained here. Type words remain as rendered, interpreted against the served schema. The example journey records why the full filtered-list example and the invalid empty tag-type example cannot be replayed.

For the operating model and pack procedure, see twin-world's docs/contributing/architecture.md.
