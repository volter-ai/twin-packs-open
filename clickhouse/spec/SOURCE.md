# ClickHouse protocol sources

Intent before implementation: serve the measured PostHog bootstrap SQL through ClickHouse HTTP and native TCP over one World store. Reuse the kernel ClickHouse parser/evaluator; the pack owns database/table state, DDL and wire formats. Unknown grammar, table engines or cluster declarations return ClickHouse errors.

The HTTP surface is authored from [ClickHouse HTTP interface](https://clickhouse.com/docs/interfaces/http). Native packets and blocks come from [Native protocol](https://clickhouse.com/docs/resources/develop-contribute/native-protocol/protocol) and [Native format](https://clickhouse.com/docs/resources/develop-contribute/native-protocol/format). No ClickHouse OpenAPI document is claimed. Vendor reference bytes and provenance precede derivation.

Application demand: PostHog advertised revision `60dd1fec2d13efcde1ed0dbafb5b71d5a3bb1a43`, unchanged `posthog/management/commands/migrate_clickhouse.py`, `posthog/clickhouse/client/connection.py` and `docker/clickhouse/docker-entrypoint-initdb.d/init-db.sh`. The retained deployment declares `clickhouse/clickhouse-server:26.9.13.15`, HTTP8123 and native9000, and original config/schema mounts. Those source mounts and the other infrastructure gaps stay explicit.

The declared service census read 1023 retained Compose files in 1.15 seconds: ClickHouse11/193 publishers and14/300 surveyed repos. These are declared variants/profiles, not selected pinned-image execution. Six unrelated templates did not parse. Full generated input evidence is retained at `/Volumes/PeakSSD/heavy-runs-out/builders/s1-managed-service-demand-artifact/demand.json`.

No application, query, recipe, test or typecheck has run. The shared codec has an independent source review; the pack has no behavior verdict. The first implementation unit is bootstrap SQL, followed by the remaining measured callers. Managed-service integration goes through the reviewed arc-world source path.


Native settings and client-info layouts are read from the reached `clickhouse-driver`0.2.10 source (`connection.py`, `clientinfo.py`, `writer.py`), retained with exact URLs and digests under `s1-managed-service-demand-artifact/driver-source/`. Revision54429 is negotiated explicitly; unknown later layouts are not silently consumed.

CityHash1.0.2 and ClickHouse frame/LZ4 mechanics are the reviewed kernel unit, patch `s1-clickhouse-codec-v3.patch` SHA2563fc002932c7577b38c257ecea4c7494fc300323e0442b8c58a04eeb7c1cf0dc1, above arc-world intent8736248b. Retained primary C++ sources and license are inventoried in `compression-source/source-reading.json`. That unit is committed on arc-world as `7e58409c`, with the separately owned standing-baseline refresh; this pack must not be admitted with an older kernel.

Replication semantics use [the vendor replication reference](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication). This unit is local coordination only: schema is registered under the replication path, replicas have unique names, and rows address that shared path. A configured remote cluster is refused. The life uses synthetic names and explicitly disabled system logs; enabled system-log writes/flush remain an operation gap.


Vendored/authored document digests (SHA256):
- `http.md`: `4fc88e9c495e16c6f514f9e01368466c63444f3ed33c4736c2ffebc698d87c87`
- `native-basics.md`: `6c83b8764e912961399f31bc1ed0dae7cc4cded27d0aa390fe6126fb004e2e9f`
- `native-client.md`: `d284978f67c3edbaf6f7883faf6dc5d657d115555b45080023aee17bdd554a9a`
- `native-columns.md`: `6ac09babfb2345eafe5ab5acb7895fbdd4f9152e905045914b3f723b0c4d5341`
- `native-server.md`: `cc580973148c2f93e1641571d025b61320abe2a0b40f92cac23c39ec1c6302cf`
- `openapi.json`: `db498ecde40edd812d4932cfe5bdc375aa38bf76db295eabc3b6c1af43e2fead`

Original input behavior uses the vendor [configuration reference](https://clickhouse.com/docs/operations/configuration-files),
[users reference](https://clickhouse.com/docs/operations/settings/settings-users) and
[executable UDF reference](https://clickhouse.com/docs/sql-reference/functions/udf).
XML grammar uses the kernel's generic strict document helper with unchanged
`@xmldom/xmldom`0.9.12 as its exact optional dependency, MIT licensed; SQL boundaries
reuse the existing vendor lexer. No host shell or UDF is executed by the reader.
Pinned PostHog config XML, users, default fragment and UDF file identities are retained
in `spec/recordings/original-input-source-reading.json`. Original password values are
not copied into the World: a nonempty source user needs an issued throwaway credential.

The declaration at PostHog60dd1fec names ClickHouse26.9.13.15 by default. Its retained
entrypoint source runs initdb for absent data, or any nonempty
`CLICKHOUSE_ALWAYS_RUN_INITDB_SCRIPTS`, uses `CLICKHOUSE_USER`, and iterates a shell glob.
This reader does not model that initialization/resume/locale contract and names it as a
gap; original SQL is not executed on every boot. The declaration's tag and upstream
source reading do not authenticate the image rootfs. Image defaults and generated
`users.d/default-user.xml` are also gaps until the carrier provides that complete reading.
Config fragments follow ConfigProcessor.cpp's main-file `.d` and sibling `conf.d` sets.
Other XML files, same-named source siblings and unmodeled earlier merge attributes refuse.

Plausible CE deployment source `5cb5234fd7754d86a86b2f897788857de4164941` is retained
unchanged under `spec/recordings/plausible-3.1.0/`, with its MIT notice and per-file
identity reading. The vendor mounts all three XML files at their original targets,
requires HTTP `/ping`, and sets `CLICKHOUSE_SKIP_USER_SETUP=1`. Its query-log fragment
keeps a MergeTree log with 30-day retention; it is never replaced by disabled logging.
The application SQL/SDK bodies remain unread.

User generation is read from ClickHouse commit
`834cccbc6e8c7f0db21ec500394c3a567b83482f`, release reference `v24.12.6.70-stable`.
`spec/recordings/clickhouse-24.12.6.70-entrypoint-reading.json` binds the original
script and Apache-2.0 notice. This is a behavior reference, not authentication of the
mutable `24.12-alpine` image. Only matching actual entrypoint bytes from the verified
carrier select the interpreter. It consumes only the default no-argument invocation:
exact skip `1`, explicit user/password/access settings, or an untouched-default local-only
generation. The vendor hashes Poco innerText, not XML structural equality; modified
or substituted default-node comparisons stay gaps, as do unknown invocations. A regular password-file value strips trailing LF as shell command substitution
does; no shell is executed. The generated fragment overlays `users.d/default-user.xml`
before the final merge, without changing original bytes. Its ACL/profile/access rules
still pass through the vendor reader, where unserved behavior refuses. With no
`CLICKHOUSE_DB` and no initdb entries, the source performs no initialization call;
all other initialization/resume cases remain named gaps. No app, query or test run.

The entrypoint's mandatory prelude resolves `user_directories.users_xml.path`,
reads that exact original users file and requires `users.default` before even
SKIP=1. Missing or unsupported prelude inputs refuse. Empty-initdb recognition
consults both the original image inventory and the effective mount inventory.
Generated password fragments are transient: their lengths and digests are absent
from the emitted reading. Original source file identities remain unchanged.

File-selected readonly profiles and the unrestricted network policy are defined in
[user-profiles.md](user-profiles.md), SHA256 `3651983a6f95449bd283088a2d1f12b24851d18203257db1706fe11cd65afa6e`. Both HTTP and native
queries enforce the selected policy before execution; other profile, quota and
peer-address directives remain named gaps. No parser, query or app was run.

Readonly-1 client setting comparisons use the generated COMMON_SETTINGS initializer
reading in `recordings/readonly-setting-defaults-24.12.json`, SHA256 `10e379b672f7e43e559ce85f12a279e8f1ec74ee195d5fdeb0ee8b2b823b70de`.
The artifact pins primary source bytes, types, initializer expressions and source
lines. Literal defaults are converted at their vendor field width. Build-condition-dependent constants and unresolved
automatic/enum/format-factory settings, aliases and input forms are comparison gaps;
no changed setting is silently accepted in mode 1. PostHog60dd1fec
`users.xml` (retained source SHA256 `0671738a7f9380887f2ed42fce051ef3734bf50369b0934123a35a854f520d56`)
selects the readonly profile for its dictionary reader. This source behavior unit
does not claim that either application boots.

## What the twin does beside the life

Plausible CE source5cb5234f adds a first original-input act: preserve its three XML bind files at their vendor targets, identify the actual image entrypoint bytes, and apply its exact user-generation branch before listening. Its CLICKHOUSE_SKIP_USER_SETUP=1 retains the original user configuration. Logs, settings and initialization directives require their own vendor behavior; a missing one keeps startup refused. Unknown entrypoint bytes or non-default invocation also refuse.

The operator's original users file selects an empty or served read-only profile and an
unrestricted network for a user. Both wires retain the profile: a read-only user
can read the held migration table, and a client attempt to set readonly to zero
refuses before a write. A conflicting operator policy cannot weaken the source
file's policy, including through a later configuration door call. Readonly mode 1
checks HTTP/native client settings: a modeled changed value refuses with 164,
an unchanged value is retained, and an unresolved comparison names its gap. All
UInt64 policy values retain their distinct values. Restricted peer networks, other profile settings and quotas stay
named gaps until their mechanisms are supplied.
