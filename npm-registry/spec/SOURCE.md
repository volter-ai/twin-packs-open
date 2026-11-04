# The npm registry's API, as npm's own client calls it

- **Why this source:** npm publishes no machine-readable spec of its registry API; its registry docs
  (https://github.com/npm/registry/tree/main/docs) are prose and cover a part of it. Its CLI makes every registry call
  through `npm-registry-fetch`, from its own libraries and commands.
- **Source:** npm 10.9.8, as installed with Node 22.23.2 (`/opt/homebrew/Cellar/node@22/22.23.2_1/lib/node_modules/npm`),
  the files below with their sha256; the libraries at npm-registry-fetch 18.0.2, libnpmpublish 10.0.2, pacote 19.0.2,
  npm-profile 11.0.1, libnpmaccess 9.0.0, libnpmsearch 8.0.0, libnpmorg 7.0.0, libnpmteam 7.0.0, libnpmhook 11.0.0.
- **Vendored:** `client-ops.json`, the facts of each registry request the client makes (method, URL, query and body
  keys), not the client's code. Made by twin-world's `scripts/extract-js-client-ops.ts` over those files (the command is
  in its header; the fetch callees `npmFetch`, `fetch`, `regFetch` and their `.json` forms). 57 calls.
- **Version:** `npm 10.9.8`
- **Read by:** `bun <twin-world>/scripts/derive-pack.ts <this pack>` (world-tooling `spec-ir-client.ts`).
- **What it does not say:** what any answer holds, and the URLs the registry hands out (a tarball's, a login's done URL,
  a page's next, a version's attestations). The URLs are `patches.json`, each quoting its source; the answers are the
  registry docs' examples.
- **Read by (reader):** the twin orchestrator, 2026-09-29.

Files (sha256, path under the npm install):

```
f77f415d14cbef4da51bd95b1ecf6ba185819e6912ecad8de575c53f53679b7b  node_modules/pacote/lib/registry.js
d4843de4eec468b75632de2f431eb769a333dbd345b1b294f57a4a9eb077192c  node_modules/pacote/lib/remote.js
c0bc91076a2f6db8b0fd9936871b9dabe127f5ec7ae27dcb599d5c363b16c749  node_modules/libnpmpublish/lib/publish.js
1026369a9a575d8714e6037c87688b8d0e1654f45cf09a55dee53c3e19c32821  node_modules/libnpmpublish/lib/unpublish.js
1a02d7918515eca5ee7ff5fdb0a432e9e10d436dd7fde681e70250af335e74bb  node_modules/libnpmaccess/lib/index.js
d91acad36065d6a64bc95c0ed6a0f103c3224b59d7985938f22a12f481503721  node_modules/npm-profile/lib/index.js
72da9e1f07b92cd02ae489b9cf395668b6d1f9ebb7ac063a37e68f32db0dcfae  node_modules/libnpmsearch/lib/index.js
4d19d31c9bd1f3d9a3b4ad873cf90c77f34c56a7d59ae62ea067b568db539586  node_modules/libnpmorg/lib/index.js
5afa0b1c6dad2718457c5d13d397d26b74de03897e6628dd879d98fd7efdad39  node_modules/libnpmteam/lib/index.js
00721790bee96a4c34cbe6d616ade6dd9f80de725ed3ecf02e227257e33d896a  node_modules/libnpmhook/lib/index.js
f707adea712190858928fec01a394f80b60ff67d5cc1bd9e990c94fe1742d125  lib/commands/deprecate.js
a825d168247f4b6af454555f666001908eda15350b7fbdbfdddea75b9496a71e  lib/commands/dist-tag.js
4bd52a8f921707ced510dde83fd25e6379fb46d09c9c377d3fad5169b26f5723  lib/commands/publish.js
207bd8e7e577df61fd383a99da8bc1ed27917ad9b678b8471ef25968d126147b  lib/commands/logout.js
68880528e0888cd0eb3089b5f43fed3590fd9ba066cc3c6a0524ae57cbc51629  lib/commands/owner.js
b4b8bc32ffab91c7a8eaf981e38eadd315b3cd45b0a09e9c45213d251fe0cdee  lib/commands/star.js
c763a6be5e318fd57af984ef103d843ce1e535f77c14f69f42ba5104ce8364c5  lib/commands/stars.js
dc52e857e6f06431df24c9fe5e2f7423df041cacf2f7b9156ed9cd706ddebd4e  lib/utils/get-identity.js
9337eb9cf9f4f2883e18a47dc0c1c678b20bb7e95a88deec8c4f0c9f532c5799  lib/utils/verify-signatures.js
5d1f79e676575f78c8766f4474d1bf6fd4a098da44f1a3d0705af474e9fb588e  lib/utils/ping.js
740e376674101b1dca9655924552adb3f9c0991dac136fd29389a64b50f2b134  node_modules/@npmcli/arborist/lib/audit-report.js
```
- **Vendored bytes (sha256):** `client-ops.json` `779a8695fee60025eaca8834f16149dc2433a42b7527b54bb0c5dcb926763413`.

The response declarations in patches.json are read from npm/registry's package metadata reference:
https://raw.githubusercontent.com/npm/registry/main/docs/responses/package-metadata.md . They name the package
and embedded version fields the client extraction cannot carry. doc-examples.json retains that page's full and
abbreviated tiny-tarball examples and REGISTRY-API.md's search response sample, with source URLs.
Read by codex-npm-registry-author, 2026-10-01. The example setup carries the actual public tiny-tarball 1.0.0 and
yargs 6.6.0 tarballs fetched from their documented registry paths; their byte hashes are in the task command log.

The rule user/authentication.md states, "Authentication can be provided in `Basic` or `Bearer` form" (its example:
`curl -u username:password`), is an example too (read on 2026-10-17), replayed as the answers it causes on a
restricted package the page's own account publishes: Basic credentials read it, and a wrong password authenticates no
one, so its publish is refused as unauthenticated.

recordings/registry-cors.txt records a public metadata HEAD response's CORS header, with request, date and recorder.
