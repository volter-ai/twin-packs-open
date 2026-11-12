# hubspot spec — provenance

HubSpot publishes its API as one OpenAPI document per API and version, listed in its public spec catalog,
https://api.hubspot.com/public/api/spec/v1/specs (each entry names its `openApi` URL). The vendored documents all
name the one server `https://api.hubapi.com` and one OAuth scheme, so they are one API published as several documents
(docs/contributing/architecture.md, "Other wires"): each is vendored as published and read as their union
(`scripts/spec-documents.ts`).

- **Files:** `openapi/<name>.json.gz`, gzip (`gzip -9 -n`) of each document's bytes as the catalog URL answered them.
- **Fetched:** 2026-09-27, from the catalog's `openApi` URL for each entry and version below. The catalog lists newer
  dated versions of each (`2026-03`, `2026-09`, some `2025-09`); the pack vendors the numbered stable versions the
  twin's paths speak (`/crm/v3/...`, `/crm/v4/...`, `/oauth/v1/...`) and Dub calls.

| File | Catalog entry | Version | `openApi` URL | Operations | SHA-256 of the document |
|---|---|---|---|---|---|
| `contacts` | CRM / Contacts | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22150/version/3 | 13 | `a2150f2b1030da4b0df497f1888fe5027b70f1304da30dbb025d5a20761c7cb0` |
| `companies` | CRM / Companies | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22149/version/3 | 12 | `9dec0c5251136207dce6a65edce57ad8bd0fd7a8fb1c4571bda0fa98b79e588f` |
| `deals` | CRM / Deals | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/25196/version/3 | 12 | `19e252b252ea9cdf9d2537829e615617e55bcc2a370500b7ff866de1b9b05bf4` |
| `tickets` | CRM / Tickets | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22189/version/3 | 12 | `7f0992e9458fe9e16d00d6b72bdced967cb5fa14c2b02ec74eab12a0fc3f65cf` |
| `owners` | CRM / Crm Owners | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22153/version/3 | 2 | `d7b511d6e964d6ae1fb8e83b1f6fa3184d4b4bfbac4ed7a57e275f36ada76e5d` |
| `properties` | CRM / Properties | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/25174/version/3 | 13 | `1bc8ced2fac77840c7bf6f0e1ee17b259ad03c10b0557a5cdb5e9099a2bd0d80` |
| `pipelines` | CRM / Pipelines | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22177/version/3 | 14 | `80ba0da3a7e191167b861c57bed0a5c37e6e171d0a48a0004afc2da93609a700` |
| `associations` | CRM / Associations | 4 | https://api.hubspot.com/public/api/spec/v2/specs/release/25199/version/4 | 10 | `44230be570fa6b32ae1cee5194de39bd9dd54209961fdd4c2934447d2f2af373` |
| `meetings` | CRM / Meetings | 3 | https://api.hubspot.com/public/api/spec/v2/specs/release/22170/version/3 | 11 | `141d4da7ccc63bbce34a3b649f73c6d0a0f407eed6068ea33462796d070a2268` |
| `oauth` | Auth / Oauth | 1 | https://api.hubspot.com/public/api/spec/v2/specs/release/22117/version/1 | 4 | `6ee55dc7a63b14a4947e5a9154c7da6585d96d5a6e654bfa336b9b0092ea2b23` |

- **Version:** OpenAPI 3.0.1 each, 103 operations in their union.
- **Operation ids:** HubSpot's own, from the documents.
- **Deals' paths:** the document names `/crm/v3/objects/0-3`; the other object documents use names. No operation is served.
- **Contradictions ruled** (`patches.json`, RFC 6902, applied to the documents before their union): the one scheme
  `oauth2` lists different scopes in each document: each lists only the scopes its own operations name (the CRM object
  documents no `crm.schemas.*`; Properties and Pipelines no `crm.objects.partner-clients.*` or `products.read`; Crm
  Owners four; Oauth none), with the same authorization and token URLs. None refuses a scope another grants, so they
  are partial lists of one scheme; the patches write their union (130 scopes) into every document. Evidence: the
  spec's own words.
- **Not in the documents:** `/oauth/authorize` is a consent page, not an API operation. No screen is served. OAuth v3 is not vendored.
- **Read by:** twin-world's `scripts/derive-pack.ts`, writing `src/generated/`.
- **Read by contributor:** Codex.

No operation has a demanded caller. The optional integrations' evidence is in `journeys/demand.json`.
