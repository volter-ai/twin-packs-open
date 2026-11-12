# Redis's own command table

- Files: `commands/`, the unmodified server command metadata Redis publishes as `src/commands/*.json`, the source of COMMAND DOCS.
- Upstream: https://github.com/redis/redis/tree/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/src/commands
- **Version:** `7.4.0`; commit `c9d29f6a918c335bc1778d9f68e521c1bbb36a0f`.
- Archive: https://codeload.github.com/redis/redis/tar.gz/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f
- Archive SHA-256: `de367b250cdc751f209600cc340901db972f0410a23d2d6102cb3e074b122ae8`; each vendored file's SHA-256 is `commands.sha256`.
- `upstream.json` records the archive provenance. `patches.json`: no corrections.
- Read by: redis-builder, using Redis's command table, published reference and pinned server source; `derive-pack` reads the table.
- RESP is Redis's own TCP protocol: https://redis.io/docs/latest/develop/reference/protocol-spec/ .
- The surface is all published command metadata; only `journeys/demand.json`'s calls are served.
- Published examples: `doc-examples.json` records Redis's command-page examples and the pinned vendor test’s exact HINCRBY assertion; `sources.json` holds the checked citations.

The pinned Redis command pages are vendored as `docs/<COMMAND>.md.gz`. Their raw-byte SHA-256, upstream URLs and redis-doc commit `3541d0e20cc4bb7873bdbf51a7717757b806577f` are listed in `docs-provenance.json`. The command pages were read through twin-standard's `read-page` before transcribing the examples. The pages include examples of commands outside the demand; those commands remain the gap, with reasons in the example journey.

Pinned client source archives are unmodified npm-published bytes in `clients/`. `clients/upstream.json` records their package version, upstream URL and SHA-256; `clients/archives.sha256` verifies each archive. They make the complete connection initiators, command-generation tables and queue Lua callers reviewable without a dependency install. The lockfile-resolved versions are those in `journeys/demand.json`; no archive's command inventory widens the served set.

- Exact integer example: Redis’s pinned [hash tests](https://raw.githubusercontent.com/redis/redis/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/tests/unit/type/hash.tcl), HINCRBY overflow precondition and signed-64-bit assertion, copied with its expected reply.
