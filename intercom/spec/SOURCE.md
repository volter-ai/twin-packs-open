# Intercom's API

- **Why this document:** Intercom's own OpenAPI description of its REST API, version 2.14 (the version
  `intercom-client` 7.0.3, which Dub uses, sends by default): intercom/Intercom-OpenAPI at
  `598020b7434f5d90f2b764c8d5421f5d541d4c31`, `descriptions/2.14/api.intercom.io.yaml`, vendored gzipped and unchanged.
- **Servers:** `https://api.intercom.io` (and its EU and Australian hosts).
- **Corrections** (`patches.json`): the OAuth token exchange (`POST /auth/eagle/token`), which Intercom's OAuth guide
  documents and the description omits.
- **Its pages:** the OAuth guide (the authorize URL, the exchange and its answer) and the webhook models (the
  notification, its topics and its `X-Hub-Signature`), developers.intercom.com, 2026-09-30.

- **Upstream:** https://raw.githubusercontent.com/intercom/Intercom-OpenAPI/598020b7434f5d90f2b764c8d5421f5d541d4c31/descriptions/2.14/api.intercom.io.yaml
- **File:** `openapi.yaml.gz`; SHA-256 of the uncompressed vendor bytes: `63cef11da63ec76f1cb4aa620da6114fda7141f8489a0a6275443da4a8cd6ee5`.
- **Read by:** Codex. No spec operation has a demanded caller; optional evidence is in `journeys/demand.json`.
