# github spec — provenance

## Repository mirror

The Code-tab layout follows GitHub's public [repository quickstart](https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories), including its file-list screenshot. File selection and Raw follow [Viewing and understanding files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files). These references were read on October 8, 2026 without signing into GitHub. Pages are authored markup, not copied vendor DOM or assets.

The mirror reads the pack's existing stored Git objects for its branch selector, folders, files and README; navigation preserves the World mount. A private repository remains unavailable to visitors without its existing member session. Source files show escaped text and line anchors; Markdown files render through the shared Markdown renderer. Raw returns the actual blob bytes as plain content. The existing smart-HTTP and raw-content-host handlers remain separate. Branch switching is read-only. Issues, pull requests, Actions, Projects, Security, Insights, Settings, the clone dropdown, Blame, symbol navigation and submodules are not browser implementations here; the visible controls are unavailable. No production browser-fidelity or published-release claim follows from this source change.

- **File:** `openapi.json.gz`, gzip of GitHub's published REST OpenAPI description.
- **Upstream:** https://github.com/github/rest-api-description, [`descriptions/api.github.com/api.github.com.json` at `0b5823abf64cf5680ebd3d3c7ef22481f97e0e7d`](https://raw.githubusercontent.com/github/rest-api-description/0b5823abf64cf5680ebd3d3c7ef22481f97e0e7d/descriptions/api.github.com/api.github.com.json). The pinned upstream bytes exactly match this snapshot.
- **Spec version:** `1.1.4` (`info.version`); server `https://api.github.com`.
- **SHA-256 of the uncompressed document:** `b8ca03764f54058ec40e2b61e048a4518ee88e943ac04d393b1757094c895aad`.
- **Read by:** the author of [the published-examples journey](../journeys/vendor-examples.json), through the repository’s `read-page --raw`; the pinned bytes were compared with the uncompressed snapshot. `derive-pack.ts` writes `../src/generated/surface.gen.json`.

- **File:** `schema.graphql.gz`, gzip of GitHub's public GraphQL schema (SDL).
- **Upstream:** https://docs.github.com/public/fpt/schema.docs.graphql (GitHub’s public schema, the one its GraphQL reference documents). The snapshot exactly matches [`src/graphql/data/fpt/schema.docs.graphql` at github/docs `e0873351c5408b92fdc67ce22b95890cb62ed749`](https://raw.githubusercontent.com/github/docs/e0873351c5408b92fdc67ce22b95890cb62ed749/src/graphql/data/fpt/schema.docs.graphql).
- **SHA-256 of the uncompressed document:** `8ecdb21a5c3affdeaa0e55bd9174536aa6c69cbb61f20ec796085aa1509c95df`.
- **Read by:** the author of [the published-examples journey](../journeys/vendor-examples.json); `derive-pack.ts` writes `../src/generated/graphql-sdl.gen.json` (served by the kernel’s GraphQL wire over `../src/semantics/graphql.ts`).

- **File:** `doc-examples.json`, the rules GitHub's REST, Apps, Actions and repository pages state, each as the refusal
  (or the option) it causes, with the page (`source`) and the page's own words (`means`), replayed by
  `../journeys/vendor-examples.json`. The REST response examples remain in the upstream description; this file also holds page examples and stated rules for their documented options.
- **`sources.json`:** the pages the semantics and the manifest cite, as `bun scripts/check-sources.ts github` fetched
  them (each quoted line found).

- **`patches.json`:** restores `network_count` and `subscribers_count` to the repository list shape, as GitHub's repository reference answers them; its upstream repository schema omits them. It also declares the documented release-asset binary stream omitted from the frozen response content table.

- **`cwes.html.gz`:** MITRE's Research Concepts CWE view, linked by GitHub's [advisory creation guide](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/creating-a-repository-security-advisory), read through the repository's read-page tool at https://cwe.mitre.org/data/definitions/1000.html. SHA-256 of the page bytes: `953f27ecda609013f20504cf4a77fedacbff4941f419a51e0d3183016b7bc6b1`.
- **`cwes.txt.gz`:** that page's rendered text from the same read-page call, SHA-256 `ae8decc15156a3bb599fd00c484d248f864fafcdd820947fc0ca3868f096ca44`. `derive-cwes.ts` deterministically writes the pack-owned reference data in `src/engine/cwes.json`, imported by the pure `src/engine/cwes.ts` helper; no hosted lookup runs while serving.
