# @volter/twin-clickhouse

ClickHouse SQL over a World store, reached through the unchanged official HTTP clients or the native TCP protocol. Database and table schemas, inserted rows and local replication coordination are stored subjects of the World; both listeners see the same branch.

HTTP uses8123 and native TCP uses9000 in the vendor server. This pack's factory and CLI accept separately allocated ports (`--port` for HTTP, `--native-port` for TCP). The official JavaScript client reads `CLICKHOUSE_URL`. Native clients read a host and native port. A managed boot may supply `--configuration FILE` with synthetic users, cluster/macros settings and an initial database list. Configuration is applied through the operator door and databases through CREATE DATABASE before either listener is offered to applications. An older kernel without compression-frame exports is refused at startup. Default authentication is the vendor's `default` user with an empty password; the operator configuration door can declare other synthetic users.

The authored official-client entry is `journeys/first-use.json`, pinned to `@clickhouse/client`1.12.0. It creates a MergeTree table, inserts an event as JSONEachRow and reads it again. Retained readback performs SELECT through the same client. Neither that workflow nor the declared life has run.

The bootstrap SQL subset includes CREATE DATABASE, CREATE TABLE for Memory/MergeTree/ReplicatedMergeTree/Distributed, VALUES/JSONEachRow/native inserts, SHOW/DESCRIBE and the kernel's SELECT grammar. ReplicatedMergeTree requires explicit local coordination and macros. Distributed execution requires an explicitly configured single local cluster. Remote replication and distributed fanout are refused.

Native negotiation is revision54429. UTF-8 String values, fixed-width integers through64 bits, Float32/64, Date/Date32/DateTime, Nullable and Array columns are represented. LZ4 and uncompressed native frames use the shared kernel codecs. Other column encodings, external tables, newer native fields and compression methods are explicit gaps.

Enabled system logs are a gap. SYSTEM FLUSH LOGS succeeds only with logs explicitly disabled by the operator. The supplied PostHog deployment's original mounts and other managed infrastructure requirements remain required; this pack does not establish a completed PostHog bootstrap.

Protocol and SDK provenance is in `spec/SOURCE.md`; the HTTP OpenAPI document is authored from the vendor reference. Generated surface/facts describe the declared API and wiring. Runtime coverage remains unmeasured. Package license Apache-2.0; Node22.3+; requires the matching World kernel with its ClickHouse compression export. Use [the World workflow](https://world-docs.volter.ai/docs/getting-started) for lifecycle, credential custody and reset/resume.

The original-input reader is available at `@volter/twin-clickhouse/original-inputs`.
The CLI accepts `--original-inputs manifest.json --original-root <image-or-project-root>`.
The manifest uses kind `clickhouse.original-inputs`, version1, a digest-pinned image or
40-hex source commit, declared `selfHosts`, `mounts: [{path,target}]`, and the complete
`files: [{target,bytes,sha256}]` inventory. The CLI enumerates mounted directories and
rehashes every file; missing, additional, changed or escaping files refuse. The reader
awaits the kernel's strict `xml.parseDocument` helper, whose exact optional grammar is
`@xmldom/xmldom`0.9.12. A kernel without that helper refuses original inputs explicitly.
Its returned reading records each directive's
applied, superseded or gap disposition without printing passwords or SQL bodies.

Plain macros, one declared local shard/replica, served HTTP/native ports and simple users
with issued throwaway credentials are interpreted into the proposed configuration. SQL
bootstrap files are parsed for the reading and remain an initialization-policy gap. Other settings,
profiles/ACLs, Keeper, schemas, executable UDFs, and shell bootstrap are named gaps.
A gap stops startup before the operator door, vendor SQL or either listener. The current
carrier supplies mounted files only; the complete pinned image defaults and entrypoint-
generated user configuration remain named gaps for every original-input plan. PostHog's
original mounted config and initdb inputs still contain those gaps; this reader does
not make that deployment bootable yet. No reader, query or application has run here.
