# ADR 0000: Installed and served contracts use their declared owners

Status: accepted.

## Decision

A pack's documented installation must provide every API its implementation imports, at the compatible minimum its manifest declares. Shared format readers remain in world-core; an installation example selects a released core that provides its imported readers. Other working pins retain their versions.

World [ADR 0030 §§4 and 6](https://github.com/volter-ai/twin-world/blob/main/docs/adr/0030-a-twin-account-is-an-organizations.md) makes each vendor's live key resource the sole authentication authority. Tripo and WorldLabs issue `_api_key` rows through `ctx.accountKey`; request authentication selects that live, unrevoked row and then its linked account. An account row is tenancy, not a second key store.

The vendor's HTTP wire policy applies to every response produced by its relay. Tunnel's [pinned relay contract](../../tunnel/spec/SOURCE.md) supplies one `cors(request)` policy for preflight, socket answers and local HTTP failures. Disconnection, request-size refusal, disconnect/replacement and timeout answers all carry that policy while retaining their native status and body. The local text response factory consumes the original request and calls `cors(request)`.
