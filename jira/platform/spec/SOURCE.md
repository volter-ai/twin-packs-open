# jira platform spec — provenance

- **File:** `openapi.json.gz`, gzip of Atlassian's published Jira Cloud platform REST API v3 document.
- **Upstream:** https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json (fetched 2026-09-30; version
  `1001.0.0-SNAPSHOT-ade149fa6dad08c873671553469d748b9d38106d`). Served at a site (`https://<site>.atlassian.net`) and,
  for an OAuth 2.0 (3LO) app, at `https://api.atlassian.com/ex/jira/{cloudId}` (the manifest's `pathPrefix`).
- **SHA-256 of the uncompressed document:** `bcef1dbe22657c639c7662d59b075106e0f3ddde1ccd6e9daafe99ccaac339ee`.
- **Corrections:** none.
- **Read by:** `bun scripts/derive-pack.ts jira/platform`.

The createIssue reference links Atlassian Document Format; its document structure is read at
https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/ for the root version rule.
