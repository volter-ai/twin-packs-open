# github spec — provenance

## Repository mirror

The Code-tab layout follows GitHub's public [repository quickstart](https://docs.github.com/en/repositories/creating-and-managing-repositories/quickstart-for-repositories), including its file-list screenshot. File selection and Raw follow [Viewing and understanding files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files). These references were read on October 8, 2026 without signing into GitHub. Pages are authored markup, not copied vendor DOM or assets.

The mirror reads the pack's existing stored Git objects for its branch selector, folders, files and README; navigation preserves the World mount. A private repository remains unavailable to visitors without its existing member session. Source files show escaped text and line anchors; Markdown files render through the shared Markdown renderer. Raw returns the actual blob bytes as plain content. The existing smart-HTTP and raw-content-host handlers remain separate. Branch switching is read-only. Issues, pull requests, Actions, Projects, Security, Insights, Settings, the clone dropdown, Blame, symbol navigation and submodules are not browser implementations here; the visible controls are unavailable. No production browser-fidelity or published-release claim follows from this source change.

- **File:** `openapi.json.gz`, gzip of GitHub's published REST OpenAPI description.
- **Upstream:** https://github.com/github/rest-api-description, [`descriptions/api.github.com/api.github.com.json` at `0b5823abf64cf5680ebd3d3c7ef22481f97e0e7d`](https://raw.githubusercontent.com/github/rest-api-description/0b5823abf64cf5680ebd3d3c7ef22481f97e0e7d/descriptions/api.github.com/api.github.com.json). The retained upstream capture exactly matches the pinned bytes; this package substitutes only the credential-like example string values listed below.
- **Spec version:** `1.1.4` (`info.version`); server `https://api.github.com`.
- **SHA-256 of the original uncompressed upstream document:** `b8ca03764f54058ec40e2b61e048a4518ee88e943ac04d393b1757094c895aad`.
- **Read by:** the author of [the published-examples journey](../journeys/vendor-examples.json), through the repository’s `read-page --raw`; the pinned bytes were compared with the original uncompressed snapshot before the listed example substitutions. `derive-pack.ts` writes `../src/generated/surface.gen.json`.

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

## Credential-like example values

SHA-256 of the packaged uncompressed `openapi.json.gz` after the listed replacements: `c542080203c49494518ef0d9b9b6ff4c21b2d40a2170dafbaddcf0d97bb4fe62`.

The exact keys sweep flags 75 string values in the pinned public REST examples. Each listed value is replaced by an explicit inert string of the same JSON type. Every other byte of the uncompressed document, including operations, schemas, field names and the pinned upstream locator, stays unchanged. The original captured bytes remain outside the package beside the release custody record for comparison.

The twin does not serve these spec samples as response data. GitHub App creation and manifest conversion issue private PEM keys through `ctx.signingKey` (`src/semantics/doors.ts` and `src/semantics/apps.ts`); supported Actions public-key responses use `ctx.crypto.sealedBoxKeyPair` (`src/semantics/actions.ts`). Stored user keys come from the caller. Their runtime formats are independent of the inert spec markers.

JSON paths below use RFC 6901 and are relative to `openapi.json.gz` after decompression.

| JSON path | Inert replacement | Reason |
| --- | --- | --- |
| `/paths/~1applications~1{client_id}~1grant/delete/requestBody/content/application~1json/examples/default/value/access_token` | `<example-access-token>` | Public upstream access-token sample; inert example, never an issued credential. |
| `/paths/~1applications~1{client_id}~1token/post/requestBody/content/application~1json/examples/default/value/access_token` | `<example-access-token>` | Public upstream access-token sample; inert example, never an issued credential. |
| `/paths/~1applications~1{client_id}~1token/patch/requestBody/content/application~1json/examples/default/value/access_token` | `<example-access-token>` | Public upstream access-token sample; inert example, never an issued credential. |
| `/paths/~1applications~1{client_id}~1token/delete/requestBody/content/application~1json/examples/default/value/access_token` | `<example-access-token>` | Public upstream access-token sample; inert example, never an issued credential. |
| `/paths/~1applications~1{client_id}~1token~1scoped/post/requestBody/content/application~1json/examples/default/value/access_token` | `<example-access-token>` | Public upstream access-token sample; inert example, never an issued credential. |
| `/paths/~1credentials~1revoke/post/requestBody/content/application~1json/examples/default/value/credentials/0` | `<example-credentials>` | Public upstream revocation request credential sample; inert example, never an issued credential. |
| `/paths/~1credentials~1revoke/post/requestBody/content/application~1json/examples/default/value/credentials/2` | `<example-credentials>` | Public upstream revocation request credential sample; inert example, never an issued credential. |
| `/paths/~1credentials~1revoke/post/requestBody/content/application~1json/examples/default/value/credentials/3` | `<example-credentials>` | Public upstream revocation request credential sample; inert example, never an issued credential. |
| `/paths/~1credentials~1revoke/post/requestBody/content/application~1json/examples/default/value/credentials/4` | `<example-credentials>` | Public upstream revocation request credential sample; inert example, never an issued credential. |
| `/paths/~1repos~1{owner}~1{repo}~1pages~1deployments/post/requestBody/content/application~1json/examples/default/value/oidc_token` | `<example-oidc-token>` | Public upstream Pages OIDC request sample; inert example, never an issued assertion. |
| `/paths/~1user~1keys/post/requestBody/content/application~1json/examples/default/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/paths/~1user~1ssh_signing_keys/post/requestBody/content/application~1json/examples/default/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/integration-from-manifest/value/client_secret` | `<example-client-secret>` | Public upstream App secret sample; inert example. The App handler issues its own secret at runtime. |
| `/components/examples/integration-from-manifest/value/webhook_secret` | `<example-webhook-secret>` | Public upstream webhook secret sample; inert example. The App handler issues its own secret at runtime. |
| `/components/examples/integration-from-manifest/value/pem` | `<private-key-issued-at-runtime>` | Public upstream private-key sample; inert marker. App responses use a well-formed private PEM from ctx.signingKey at runtime. |
| `/components/examples/installation-token/value/token` | `<example-token>` | Public upstream token sample; inert example, never an issued credential. |
| `/components/examples/installation-token/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/authorization-with-user/value/token` | `<example-token>` | Public upstream token sample; inert example, never an issued credential. |
| `/components/examples/authorization-with-user/value/hashed_token` | `<example-hashed-token>` | Public upstream token digest sample; inert example, never an issued credential. |
| `/components/examples/scope-token/value/token` | `<example-token>` | Public upstream token sample; inert example, never an issued credential. |
| `/components/examples/scope-token/value/hashed_token` | `<example-hashed-token>` | Public upstream token digest sample; inert example, never an issued credential. |
| `/components/examples/repository-paginated-2/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/issue-with-repo-items/value/0/repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/repository-paginated/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/minimal-repository-paginated/value/repositories/0/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/minimal-repository-paginated/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/authentication-token/value/token` | `<example-token>` | Public upstream token sample; inert example, never an issued credential. |
| `/components/examples/authentication-token-2/value/token` | `<example-token>` | Public upstream token sample; inert example, never an issued credential. |
| `/components/examples/actions-public-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/codespaces-public-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/dependabot-public-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/migration-with-short-org-items/value/0/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/migration-with-short-org-2/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/migration-with-short-org/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/private-registries-public-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/full-repository/value/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository/value/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository/value/parent/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository/value/source/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/team-repository-alternative-response-with-repository-permissions/value/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository-default-response/value/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository-default-response/value/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository-default-response/value/parent/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/full-repository-default-response/value/source/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/check-suite/value/repository/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/check-suite/value/repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/check-suite-preference/value/repository/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-simple-items/value/0/head/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-simple-items/value/0/base/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/check-suite-paginated/value/check_suites/0/repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/minimal-repository-items-2/value/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request/value/head/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request/value/base/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-review-request/value/head/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-review-request/value/base/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-simple/value/head/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/pull-request-simple/value/base/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/minimal-repository/value/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/team-repository-alternative-response-with-extra-repository-information/value/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/codespaces-user-public-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/codespace-with-full-repository/value/repository/template_repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/codespace-with-full-repository/value/repository/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/codespace-with-full-repository/value/repository/parent/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/codespace-with-full-repository/value/repository/source/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/key-items/value/0/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/key-items/value/1/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/migration-items/value/0/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/migration-2/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/migration/value/repositories/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/repository-items-default-response/value/0/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |
| `/components/examples/ssh-signing-key-items/value/0/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/ssh-signing-key-items/value/1/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/ssh-signing-key/value/key` | `<example-key>` | Public upstream public-key sample; inert example. Supported Actions keys are generated at runtime and stored user keys come from the caller. |
| `/components/examples/starred-repository-items-alternative-response-with-star-creation-timestamps/value/0/repo/temp_clone_token` | `<example-temp-clone-token>` | Public upstream temporary clone-token sample; inert example, never an issued credential. |

The customer journey also obtains Octocat's password at execution from the existing `/_twin/users/octocat/password` admin door. An omitted password uses the retained World secret scoped to that login, stores its normal hash and returns it for capture. An explicitly supplied password keeps the existing 204 response. Both request positions reuse the same generated value; sign-in, two-factor and device-flow steps remain in place.

| Journey JSON path | Replacement | Reason |
| --- | --- | --- |
| `../journeys/customer-life.json#/steps/1/body/password` | Omitted; capture the door's `password` as `octocat_password`. | Generate the flagged fixture credential at execution. |
| `../journeys/customer-life.json#/steps/8/body` | Password form field uses `{encoded:octocat_password}`. | Reuse the generated fixture credential when signing in. |
