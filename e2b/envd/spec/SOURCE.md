# envd spec provenance

E2B publishes one envd API as its process/filesystem protobuf services and its content HTTP specification. Vendored bytes: `process.proto` (fetched 2026-09-30 from https://github.com/e2b-dev/E2B/spec/envd/process/process.proto), `filesystem.proto` and `openapi/files.yaml` (fetched 2026-10-01 from https://github.com/e2b-dev/E2B/blob/5c0f6eb22bdb/spec/envd/filesystem/filesystem.proto and https://github.com/e2b-dev/E2B/blob/5c0f6eb22bdb/spec/envd/envd.yaml). The original content spec's version is 0.1.3. `openapi/process.json` and `openapi/filesystem.json` are conversions by twin-world's `spec-proto-to-openapi.ts --style grpc`, fetched date 2026-10-01, omitting servers because the vendor's content document supplies none. The manifest supplies the actual sandbox host. No patches.

- `process.proto` SHA-256 `8edd9358c7dbfcad96796b3f0ed8d14c262b8b14d6bc7d5e84d468941511b8e0`.
- `filesystem.proto` SHA-256 `dccb895f282c7e415bd78027a28e69470fb0ddd5de0677222518ddb6a9b88430`.
- `openapi/files.yaml` SHA-256 `bc18f6c810f608e0e9b3c775a8cc41a33a56710ca9610cf25cd6285da46acaeb`.
- `openapi/process.json` SHA-256 `cd5b7b229ddfd88a1113e48a0931045272d1bebe523447619b1d43619fa25ab7`.
- `openapi/filesystem.json` SHA-256 `4f5c3a694eb69867b0166b827342c6cc70b4612b77cde78c7798815bfb50b458`.

`doc-examples.json` records the official SDK examples, translated through Twenty's pinned e2b 2.45.0 client: https://docs.e2b.dev/quickstart and https://docs.e2b.dev/filesystem/read-write, read 2026-10-01. Those pages publish code, not JSON response samples; setup-decided values are asserted in the replay.
