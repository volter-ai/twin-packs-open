# Google Web Risk spec — provenance

Google Web Risk API v1 and its complete proto imports, fetched 2026-09-30.
Google API protos are pinned to googleapis/googleapis commit
`d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe`; protobuf imports are pinned to
protocolbuffers/protobuf commit `b8c1eaac5a6b0c33a9698be25a710b67fdca250f`.
The files are read directly by `derive-pack.ts` as `spec/proto/`, preserving the message schemas
in `src/generated/proto.gen.json`; the census-only proto-to-openapi conversion drops those schemas.

Corrections: none.

Read by: the author of [the published-examples journey](../journeys/vendor-examples.json), through the vendored files and twin-standard read-page.

| File | Upstream | SHA-256 of vendored bytes |
|---|---|---|
| `proto/google/api/annotations.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/annotations.proto | `e79ea741cb605a65e78ca322174764a4af9fde1962c1631e12b84c4934ba9a6c` |
| `proto/google/api/client.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/client.proto | `5e9fc117290fe7d3472791543c979bec7cf4497f3fe6ffaf9de9ae99cc4f1804` |
| `proto/google/api/field_behavior.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/field_behavior.proto | `bb7ed77725c95f751ec2c47cd92359d0137c39383b8a62aef41bab7aa7478da5` |
| `proto/google/api/http.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/http.proto | `ead99129aa15dd5f6233942030c72eec33bc0d7b1c7c260dc143293ef66c5b78` |
| `proto/google/api/launch_stage.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/launch_stage.proto | `68e22c9821227b4e84c7029569fce1055c21e6ccab991e0986bc75f12ef4dd82` |
| `proto/google/api/resource.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/api/resource.proto | `815d51eada4341bf01672b474b5ec0abbea190e8df9f4aa26a0c96dbdad2993b` |
| `proto/google/cloud/webrisk/v1/webrisk.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/cloud/webrisk/v1/webrisk.proto | `96e0f5265aeba779d70d11a3bb1b1de97ec13c63d80842cc6171d5b154d19937` |
| `proto/google/longrunning/operations.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/longrunning/operations.proto | `5d2e7f9eeb55b8417b50e0a536a092babd32d26e4fbeb7099c6cdcda6e16db9c` |
| `proto/google/protobuf/any.proto` | https://raw.githubusercontent.com/protocolbuffers/protobuf/b8c1eaac5a6b0c33a9698be25a710b67fdca250f/src/google/protobuf/any.proto | `8e56f61e3078e9232d39ce1b1bab28613783af8191f93a910c3617933f87a179` |
| `proto/google/protobuf/descriptor.proto` | https://raw.githubusercontent.com/protocolbuffers/protobuf/b8c1eaac5a6b0c33a9698be25a710b67fdca250f/src/google/protobuf/descriptor.proto | `5768e01d4d45a70e0d9e44cfd42753e1312a0bf0deec599b657914f9d1bf6a1f` |
| `proto/google/protobuf/duration.proto` | https://raw.githubusercontent.com/protocolbuffers/protobuf/b8c1eaac5a6b0c33a9698be25a710b67fdca250f/src/google/protobuf/duration.proto | `a3f7301ff2956ec2e30c2241ece07197e4a86c752348d5607224819d4921c9fe` |
| `proto/google/protobuf/empty.proto` | https://raw.githubusercontent.com/protocolbuffers/protobuf/b8c1eaac5a6b0c33a9698be25a710b67fdca250f/src/google/protobuf/empty.proto | `ecef3d54cc9e079673b9816c67bac770f7f3bf6dada2d4596ba69d71daa971e6` |
| `proto/google/protobuf/timestamp.proto` | https://raw.githubusercontent.com/protocolbuffers/protobuf/b8c1eaac5a6b0c33a9698be25a710b67fdca250f/src/google/protobuf/timestamp.proto | `fa6c44dca2c90a2aaf3a1e4776cef2e9177f70fba365f236269f0f41ac166c96` |
| `proto/google/rpc/status.proto` | https://raw.githubusercontent.com/googleapis/googleapis/d6ec9a598ecbcb3458b9e09ad7339af0ab8a71fe/google/rpc/status.proto | `f5bfd262e6705c7ae73f32e0ad8ee20ce8c0a2578df8c4f76ebf76b572f295ed` |

Documentation examples: `doc-examples.json`, read from Google’s [Lookup API guide](https://cloud.google.com/web-risk/docs/lookup-api). Requests and stated rules there belong to SearchUris; it is outside the measured demand.
