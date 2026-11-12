# currencyapi spec — provenance

- **File:** `openapi.yaml`, currencyapi's own OpenAPI document, the vendor's bytes unchanged (OpenAPI 3.1.0,
  `info.version` `"3"`, 24,669 bytes). Its description: "This document is generated from the currencyapi service
  implementation and is the machine-readable source of truth for the v3 REST API."
- **Upstream:** https://currencyapi.com/docs/openapi.yaml (ETag `"64af6ae13e68c5fb1663be0c7073c907"`), fetched
  2026-09-27. The documentation links it ("the full API is available as a machine-readable OpenAPI 3.1 specification",
  https://currencyapi.com/docs), and every error the live API answers names it (`actions.docs`).
- **SHA-256 of the vendor's bytes:** `3ba819ab0ba1b38b7d6cdebfde0db0df6cf3bcdb106d05962ae93f115b771dd8`.
- **License:** the document states none, and currencyapi's site publishes it without terms of its own ("© 2026 Currencyapi.com, All rights reserved."
  under the site's Terms of Service). It is vendored as the interface description the vendor publishes for clients to
  read, unmodified, and corrected only by `patches.json`. The official JavaScript client
  (`@everapi/currencyapi-js` 1.0.6, https://github.com/everapihq/currencyapi-js at `858c695d36794713a7abc1fcee5ebcebdbbc0bfb`)
  is MIT; it was read for the paths it calls (`status`, `currencies`, `latest`, `historical`,
  `range`, `convert` under `https://api.currencyapi.com/v3/`, the key in the `apikey` header), not vendored.
- **Operation ids:** the document's own (`getLatest`, `getHistorical`, `getConvert`, `getRange`, `getCurrencies`,
  `getCountries`, `getStatus`).
- **Corrections:** `patches.json` (RFC 6902, each with its reason and evidence), applied before the IR: the error body of
  a 401 and a 429 (`error`, `actions`, and a monthly-quota 429's `quota`), which the status-code page documents and the
  spec's `Error` lacks; and the rates endpoints' 404 for a timeframe with no data (historical, convert, range), which
  the status-code page documents and the spec omits.
- **Recordings:** `recordings/401-missing-api-key.json` and `recordings/401-invalid-api-key.json`, the live API's answers
  on 2026-09-27 to `GET https://api.currencyapi.com/v3/latest` with no key and with a key it does not hold (both 401,
  `www-authenticate: Key`). The invalid key's message is `Unauthorized`; the status-code page and the spec's example
  print `Invalid authentication credentials`. The twin answers as the live API did. And
  `recordings/minute-limit-headers.txt`, the rate-limit headers of the live API's answer to a keyless
  `GET https://api.currencyapi.com/v1/agent/keys` (`x-ratelimit-limit-minute: 10`, `x-ratelimit-remaining-minute`), the
  names the twin gives the Free plan's minute limit; the documentation names no minute header. And
  `recordings/agent-keys-post-403.json`, the live API's 403 `agent_keys_disabled` to a keyless
  `POST https://api.currencyapi.com/v1/agent/keys` (its GET answered an HTML 404), which the twin answers the same.
- **Read by:** `bun scripts/derive-pack.ts currencyapi`, which writes `../src/generated/`.
- **The documentation** is also published whole as text, https://currencyapi.com/docs/llms-full.txt (every page with
  its `Source:` URL), which is where this pack's builder read it; the pages cited are the rendered pages themselves.
- **The pages' examples** (`doc-examples.json`): every request and answer the documentation pages print for an
  operation of this spec (latest, historical, convert, range, currencies, countries, status, the quickstart's, the
  authentication page's, the status-code page's, and the currency-converter guides' `latest` calls), beside the spec's
  own examples. A page's elision entry in an answer (`"...": "180+ more currencies"`, `"...": {}`) is left out of the
  vendored output: it stands for the rest of the map, not a key.
- **APIs the pages document and this spec omits, outside the count until modelled:** the hosted MCP server at
  `https://api.currencyapi.com/mcp` (https://currencyapi.com/docs/mcp: tools generated from this same spec), and the
  automated key issuance an error's `actions.get_free_api_key` names (`https://api.currencyapi.com/v1/agent/keys`,
  which answered `403 agent_keys_disabled` to a `POST` on 2026-09-27).
- **Outside any API:** an account, its API keys and its plan are made on the dashboard at app.currencyapi.com
  (https://currencyapi.com/docs/quickstart, /authentication; https://currencyapi.com/pricing). No demanded caller
  requires these flows; the pack serves no screens or credential setup.
