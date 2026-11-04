# fly spec — provenance

- **File:** `openapi.json.gz`, gzip of Fly.io's published Machines API document (OpenAPI 3.0.1, "Machines API 1.0").
- **Upstream:** https://docs.fly.io/api/machines/openapi.json (fetched 2026-09-30; the older docs.machines.dev URLs
  redirect there or answer 404). Server `https://api.machines.dev`, every path under `/v1`.
- **SHA-256 of the uncompressed document:** `d2164dbcd43bc9a544e7470a6751f2476f5b73fe28fb50b11468c2339fe25ee0`.
- **Corrections:** `patches.json`: the create-app body's `app_name`, which the apps reference documents and the schema
  names `name`.
- **Read by:** `bun scripts/derive-pack.ts fly`, which writes `../src/generated/surface.gen.json`.


- **Reference examples:** `doc-examples.json`, read from the Apps, Machines and Volumes reference
  pages on 2026-10-01. URLs are on each example. JSON comments and ellipsis in
  abridged samples are removed only to parse the shown fields; samples are not invented completed
  responses. The services create example and snapshot volume create example are malformed and recorded rather than repaired. The snapshot example retains its literal shell request, including the trailing comma after snapshot_id, and its restoring response.
- **Read:** the vendored schema and reference examples. `patches.json` also
  adds the documented volume host_dedication_key. `sources.json` is check-sources' citation record.
