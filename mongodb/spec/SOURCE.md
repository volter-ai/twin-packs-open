# MongoDB: no usable spec, so the SDK's types and recordings stand in

MongoDB publishes a command reference (its server manual) and driver specifications. Neither is usable here: both
are licensed Creative Commons Attribution-NonCommercial-ShareAlike 3.0, and the server's own source is under the
SSPL. Nothing of them is copied, quoted, summarised or vendored in this pack, and no rule in it cites a page of the
manual. By the platform's rule for a vendor with no usable spec, the SDK's types and recordings stand in.

## The SDK's types, as a table: `command-builders.json`

- What it is: every command document MongoDB's own Node driver builds, each field it can carry, the field's declared
  type, the condition the driver sends it under, and the fields the session, connection and message layers add to
  every command.
- Read from: `clients/mongodb-6.20.0.tgz`, the driver as published to npm, unmodified. Upstream
  https://registry.npmjs.org/mongodb/-/mongodb-6.20.0.tgz ; SHA-256
  `a12bd599cb4f39cdf222b32380ea3efd1f60c6d88615e0700632a303a9006b02` (`clients/archives.sha256`,
  `clients/upstream.json`). Licence Apache-2.0.
- **Version:** `6.20.0`; the tag's commit is `477140e932062586f4598677648a562e75f19657`
  (https://github.com/mongodb/node-mongodb-native). The files read (`src/operations/`, `src/sessions.ts`,
  `src/cmap/connection.ts`, `src/cmap/commands.ts`) are byte for byte the same in the archive and at that commit
  (compared when the table was made).
- Read by: `extract-command-builders.mjs`, kept beside the table as its provenance. It reads the driver's syntax tree
  with the TypeScript compiler and executes nothing of the driver. The same archive in gives the same file out. Its
  header carries the command.
- Read on 2026-10-08 by worker 1. `patches.json`: no corrections.

What the table says: which commands a client can send and how. 31 builders in 23 files, 156 fields: 64 always sent,
81 when the option is given, 4 depending on the server's wire version, 7 under a condition kept verbatim (`other`).
10 fields have a type the driver itself declares as `any` or does not declare.

What it does not say:
- Nothing of what a server DOES with a command. That is the recordings'.
- No aggregation stages and no expression operators: the driver types a pipeline as documents. A stage enters this
  pack only by demand, with a recording.
- Not read, each for its reason: `run_command.ts` (the document is the caller's own), the three `search_indexes`
  files (Atlas Search, not a server a World runs), and `client_bulk_write` (the bulkWrite command of server 8.0,
  absent on the 7.0 server the recordings are of).

Checked once against real traffic: every field of the 528 command documents LibreChat's driver sent a MongoDB server
on a first visit (boot, registration, sign-in, the first page, sign-out, sign-in) is stated by this table; 34 by the
commands' own builders, `lsid` and `$db` by the envelope, none unstated.

## Recordings, for behaviour: `recordings/`

Each is one answer of MongoDB's own server to one command: MongoDB Community 7.0.16 (the pinned macOS ARM64 archive,
SHA-256 `e01c5ce1ef8efbef4196797130564b8f121f6e29f20ccf70e025feba07e15739`), standalone, run privately on loopback
for the question and removed after. The file says what was asked (any setup commands, then the command), of which
version, the answer, and the documents and indexes of the named collections after it. Commands are sent as written,
over the wire, with nothing added but `$db`.

A recording proves the vendor's server did this once, for this input, at this version, in this topology. It does
not prove the vendor says so, and it says nothing of an input nobody asked.

## The wire

MongoDB's message framing is the kernel's (`@volter/world-core/mongodb`), read from the same driver archive
(`src/cmap/commands.ts`).

## A declared single-member handshake

The optional `serve --replica-set <name>` mode uses the same Apache-2.0 driver archive's SDAM field readers:
`src/sdam/server_description.ts` and `src/sdam/topology_description.ts`. They consume `setName`, `hosts`, `primary`,
`me`, `isWritablePrimary`/`ismaster`, `secondary`, `setVersion` and `topologyVersion`. The one member is
the listener this process actually serves. This is a handshake scope, not a replication or oplog implementation.
It exposes no `logicalSessionTimeoutMinutes`, so the driver's session/retryable-write eligibility rules do not
send `txnNumber`. Explicit transaction fields remain refused. Replica-set administration (`replSetInitiate`,
`replSetGetStatus`, `replSetGetConfig`), transactions, retryable writes and oplog reads remain unserved.
No election identifier is emitted: this scope implements no election. Non-primary read preferences remain a
gap, refused when they add the unsupported `$readPreference` envelope. Standalone answers and their recorded
session/transaction refusal are unchanged.

First need is Wekan's `db-ready.mjs` (`releases/ferretdb/` at upstream
`fbd02672266cf7164ebf7943c10bd756298f5462`): it connects with the declared replica-set URI and sends `ping`.
It never administers the set. The stopped image's build reading names the same 4,870-byte helper and the terminal
argv retains `replicaSet=rs0` at the World's actual port. Lead ruling m-abda49ec under owner delegation,
2026-10-13: use these Apache driver field readers, keep the manual excluded, and leave unrecorded administration
as gaps. No new vendor recording or application execution is claimed.

## The bytes of record

The spec files' SHA-256, as committed:

- `clients/archives.sha256`: `3a8779b88dd94d68fb89c26707e2a71212e2505e80fa569ce62751b9923ab41d`
- `clients/upstream.json`: `08b5b3da0ba52f1737cc5f251a9806110c20caf1d8980120afe8792b6a03b5ac`
- `command-builders.json` (`extract-command-builders.mjs` over the archive above): `3f2014454a978d64d6d26093c6f18e1796497e9e8c97010905ab685464002173`
- `normalise.json` (what is not compared between the server's answer and the twin's, and what is compared field by field rather than in order, each with its why): `5cd7bce1f02a5c76ac7f3456c9de1d17ad7fa4a5879978d138862656b4c17fc5`
