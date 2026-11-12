# HyperDX's ingest: the OpenTelemetry Protocol over HTTP (OTLP/HTTP)

HyperDX ingests through an OpenTelemetry collector's OTLP receiver (its browser SDK sends to `https://in-otel.hyperdx.io`
`/v1/traces` and `/v1/logs`), so this lane's wire is the protocol's, written from its specification below.

- **Why this document:** OTLP publishes no OpenAPI document. Its specification
  ([docs/specification.md](https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md),
  OTLP Specification 1.11.1, the page https://opentelemetry.io/docs/specs/otlp/ renders) gives the HTTP transport's
  three paths (`/v1/traces`, `/v1/logs`, `/v1/metrics`), its two encodings, its answers and failures; the .proto
  files give the messages. `openapi.json` is written from the specification's "OTLP/HTTP" section: one POST operation
  per signal (`exportTraces`, `exportLogs`, `exportMetrics`), its request and response messages named, and the
  answers it states (200 full or partial success, 400 bad data, 413 too large, 429 and 503 throttling). It is the
  vendored document; the messages' fields are the .proto files', not restated in it.
- **Version:** opentelemetry-proto `v1.11.1`, commit `b3f75588eb23c5fca62264edd05d382de49beb1a`.
- **sha256** of `openapi.json`: `e8c57e2a19806687e4529abbd11d027f5a7a42ade677a27c243ac79f0b50666e`.
- **Grouping** (`grouping.json`): an operation's family is its tag (`Traces`, `Logs`, `Metrics`); every path begins `/v1/`.
- **Corrections:** none.

## Vendored files

- `specification.md.gz`: docs/specification.md at the commit above, gzipped; sha256 of the uncompressed bytes `18525fa29803740421409d87a07d56cbaa47c204405811618463c823cb770486`.
- `proto/`: the .proto files the three requests and their answers use, at their upstream paths:
  - `proto/google/protobuf/any.proto`: https://raw.githubusercontent.com/protocolbuffers/protobuf/b407e8416e3893036aee5af9a12bd9b6a0e2b2e6/src/google/protobuf/any.proto, sha256 `bcf5de6ce463b1a38ff76b77955aa7e580b4ec12af34a927b1d45c9efb0faf66`
  - `proto/google/rpc/status.proto`: https://raw.githubusercontent.com/googleapis/googleapis/d14bf59a446c14ef16e9931ebfc8e63ab549bf07/google/rpc/status.proto, sha256 `108562c2d7854812908cdcd0d988132880822b05ab5e4f28960e1a5572217854`
  - `proto/opentelemetry/proto/collector/logs/v1/logs_service.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/collector/logs/v1/logs_service.proto, sha256 `0252687fc8f59d139ced709d383e83678e9bd4957bdbe76077242f1c32363fa5`
  - `proto/opentelemetry/proto/collector/metrics/v1/metrics_service.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/collector/metrics/v1/metrics_service.proto, sha256 `2bb3c6adee5f7609c8a32c5e4b1ec57057320015e298e9cf136699a42abc24d7`
  - `proto/opentelemetry/proto/collector/trace/v1/trace_service.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/collector/trace/v1/trace_service.proto, sha256 `03c8cc4e3e101087d884392d6eda32152ad5cd696e6344f50deaa59804a75c7a`
  - `proto/opentelemetry/proto/common/v1/common.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/common/v1/common.proto, sha256 `0429795169e29089cc53490b541a0ae89fa7c80492ac58ed2b3c4171cce4ecee`
  - `proto/opentelemetry/proto/logs/v1/logs.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/logs/v1/logs.proto, sha256 `0c9d0c45eea723d38ef28ee13135ff61c037387f41cacc476ccac3485d6c138a`
  - `proto/opentelemetry/proto/metrics/v1/metrics.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/metrics/v1/metrics.proto, sha256 `9663b2670f980041e73a71a7c09fdf4fe0bc64056be762f2fcbd2642c4d112a3`
  - `proto/opentelemetry/proto/resource/v1/resource.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/resource/v1/resource.proto, sha256 `34fe1c26b8959f09d97656348ae03b105d15a5f07ada0f8f1614ef5dff7d1569`
  - `proto/opentelemetry/proto/trace/v1/trace.proto`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/trace/v1/trace.proto, sha256 `45a33961142210add67d583cc525702fb985afdbae181e6daf2143929bad0613`
  `google/rpc/status.proto` is the failure body the specification names (googleapis at the commit its
  specification links); `google/protobuf/any.proto` (protobuf v29.3) is the type its `details` hold.
- `examples/`: the specification's OTLP JSON request examples (`examples/trace.json`, `logs.json`, `metrics.json` at the
  commit above), replayed by `doc-examples.json`:
  - `examples/trace.json`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/examples/trace.json, sha256 `f8f2870852b247f734a53ca7f022d4d942bd29732df54440494948af181bd373`
  - `examples/logs.json`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/examples/logs.json, sha256 `5da7283e6772026408341cb45054c7c90cdc9674bd083bcfa6b586341dc3f7a4`
  - `examples/metrics.json`: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/examples/metrics.json, sha256 `b40977696f743f556b9556eb5e716425c4c1b4369f078a3504615e605cf21bff`

## The messages' field table

`../src/engine/schema.ts` is the messages' fields by number, read from `proto/` by the installed standard's proto
reader (`readProtoFiles` and `protoSchema` of `@volter/twin-standard`'s `src/spec-ir-proto.ts`, the reader its derive
uses for a proto unit), run from twin-packs-p3 as

    bun -e "import { readFileSync, readdirSync, statSync } from 'node:fs'; import { join, relative } from 'node:path';
      import { readProtoFiles, protoSchema } from '@volter/twin-standard/src/spec-ir-proto.ts';
      const root = 'hyperdx/ingest/spec/proto'; const files = {};
      const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.proto')) files[relative(root, p)] = readFileSync(p, 'utf8'); } };
      walk(root); const s = protoSchema(readProtoFiles(files)); console.log(JSON.stringify({ messages: s.messages, enums: s.enums }));"

and written out as data, one message per block. The kernel's protobuf codec decodes a binary request and encodes an
answer over it.

Read by: Claude (Opus 5.5), 2026-11-09.
