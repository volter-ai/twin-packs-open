# fal Platform API

`openapi.json`: pinned source from https://api.fal.ai/v1/openapi.json, fetched 2026-10-01.
Version v1, OpenAPI 3.1.0. The vendor publishes no Git commit for this HTTP-generated schema.
Original upstream SHA256: `f458dd367b3a368c07e6f0cc36cbcafeded2f6a9f695909eb77291d66a983321`.
Read against Volter Editor's credential-check demand.
Corrections: none. Only getPricing is served; every other operation is explicitly unmodeled.
Pages read: https://fal.ai/docs/api-reference/platform-apis/openapi-schema.md,
https://fal.ai/docs/api-reference/platform-apis/authentication.md,
https://fal.ai/docs/platform-apis/v1/models/pricing.md.
The five getPricing response examples come unchanged from this document; its default price is
an example fixture, not a claim of live account pricing.

## Packaged public example scalars

`platform/spec/openapi.json` retains the pinned source above with only the string-scalar replacements listed below. Original inputs are retained outside the package at `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/fal/platform/spec/openapi.json`. Original uncompressed SHA-256: `f458dd367b3a368c07e6f0cc36cbcafeded2f6a9f695909eb77291d66a983321`; packaged uncompressed SHA-256: `e1ceb444d5710d7c29414b96f1bddbc1bcad89b871f735235354396be536cbdf`. Every byte outside the listed JSON string values is unchanged. These public samples are inert; runtime credentials are issued through the existing doors.

| JSON pointer | Packaged value | Reason |
| --- | --- | --- |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/edges/0/from` | `external:11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/edges/1/to` | `asset:00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/focus` | `asset:00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/nodes/0/id` | `asset:00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/nodes/0/output_key` | `00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/nodes/2/id` | `external:11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/example/lineage/nodes/2/output_key` | `11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/edges/items/properties/from/example` | `external:11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/focus/example` | `asset:00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/nodes/items/oneOf/0/properties/id/example` | `asset:00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/nodes/items/oneOf/0/properties/output_key/example` | `00000000000000000000000000000000` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/nodes/items/oneOf/1/properties/id/example` | `external:11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1assets~1{asset_id}~1lineage/get/responses/200/content/application~1json/schema/properties/lineage/properties/nodes/items/oneOf/1/properties/output_key/example` | `11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1keys/post/responses/201/content/application~1json/example/key` | `abc123def456:<example-key-secret>` | Preserves the secret component inside the combined key sample. |
| `/paths/~1keys/post/responses/201/content/application~1json/example/key_secret` | `<example-key-secret>` | Public key-secret sample replaced with an inert marker. |
| `/paths/~1serverless~1files~1list/get/responses/200/content/application~1json/schema/items/properties/checksum_md5/example` | `11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
| `/paths/~1serverless~1files~1list~1{dir}/get/responses/200/content/application~1json/schema/items/properties/checksum_md5/example` | `11111111111111111111111111111111` | Inert fixed-width graph identifier; focus, nodes, edges and schema/checksum mirrors retain their relationships. |
