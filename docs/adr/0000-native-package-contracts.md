# ADR 0000: Installed and served contracts use their declared owners

Status: accepted.

## Decision

A pack's documented installation must provide every API its implementation imports, at the compatible minimum its manifest declares. Shared format readers remain in world-core; an installation example selects a released core that provides its imported readers. Other working pins retain their versions.

Companion API calls obey the same installed contract. The pack's companion dependency and native lock select the implementation that supplies the tenancy and operations its journey uses. VGAuth's singleton service selects Clerk's organization/deployment-aware application issuer. Its isolated assessment resolves that exact registry release through the existing dependency resolver, so Clerk publication precedes VGAuth preparation. A source sibling does not establish an installed counterpart's behavior.

World [ADR 0030 §§4 and 6](https://github.com/volter-ai/twin-world/blob/main/docs/adr/0030-a-twin-account-is-an-organizations.md) makes each vendor's live key resource the sole authentication authority. Tripo and WorldLabs issue `_api_key` rows through `ctx.accountKey`; request authentication selects that live, unrevoked row and then its linked account. An account row is tenancy, not a second key store.

The vendor's HTTP wire policy applies to every response produced by its relay. Tunnel's [pinned relay contract](../../tunnel/spec/SOURCE.md) supplies one `cors(request)` policy for preflight, socket answers and local HTTP failures. Disconnection, request-size refusal, disconnect/replacement and timeout answers all carry that policy while retaining their native status and body. The local text response factory consumes the original request and calls `cors(request)`.

Pack facts are release metadata at the package-root `generated/pack-facts.json`. The [build owner](../../scripts/build.ts) writes them after compilation, and World's [package reader](https://github.com/volter-ai/twin-world/blob/main/packages/world-core/src/pack-paths.ts) reads that canonical path. The [compiler](../../scripts/compile.mjs) copies runtime assets beside compiled source and excludes this release metadata from `dist`. The archive has one current facts document, and its members do not depend on an earlier build's generated output.
