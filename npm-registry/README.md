# @volter/twin-npm-registry

The npm registry (`registry.npmjs.org`) as a Protocol 3 twin. Its surface is the registry API as npm's own client calls
it (`spec/client-ops.json`, npm 10.9.8), trimmed to what the applications here call
([journeys/demand.json](./journeys/demand.json)):

| what it serves | for whom |
|---|---|
| a package's document, full or abbreviated (`Accept: application/vnd.npm.install-v1+json`), and a version's tarball | tabnode, Substrate's image build, `npm view` and `npm install` in the catalog release, the catalog check |
| `npm publish` (a version and its tarball, sha1 and sha512 computed; a Sigstore provenance bundle checked when attached) | the catalog release (`scripts/pack-release.ts`) and the sealed World's seed |
| one version by number or tag (`GET /{package}/{version}`) | Volter Harness's update check, tabnode's pinned versions, Twenty's app install |
| `npm dist-tag ls` and a version's attestations | Volter Harness's latest channel, the catalog check, Twenty's registration claim |
| search with its qualifiers (`keywords:`, `author:`, `maintainer:`, `scope:`, `is:`/`not:`) | Twenty's marketplace |

Every other call npm can make is in the manifest's `unmodeled`.

## Credentials

`Authorization: Bearer <token>` or Basic credentials; anonymous requests read public packages. A token is kept by its
sha512, never as issued. Who may publish a scoped name is its user or a member of the organization it names.

The World's application is issued its token when the World boots: `POST /_twin/app-credentials` (the descriptor's
credential door) answers `{ token }` for the World user `world`. The descriptor fills `NODE_AUTH_TOKEN` and `NPM_TOKEN` from that token at every boot.
npm and bun reach the twin through `NPM_CONFIG_REGISTRY` or the World's host interception.

## Doors

- `POST /_twin/app-credentials`: the application's token.
- `POST /_twin/users {name, email, password, expires?}`: a user (npmjs.com's sign-up page), with a token whose optional expiry is checked against the World clock.
- `POST /_twin/orgs {name, owner}`: an organization (npmjs.com's "create an organization" page).

## Journeys

`journeys/customer-life.json` (outline beside it): Volter's releases, tabnode's and Substrate's installs, Volter Harness's update check, the catalog check and a Twenty
app found through Twenty's marketplace.

Rules, layout and tools: twin-world's architecture ("Protocol 3", "The catalog: where twins come from").

Known package documents refresh from the real-system root through the derived adapter; tarballs and attestations named in each document are copied into resource blobs. Provenance uses the World's Fulcio roots and Rekor signed witnesses. The World certificate authority does not operate a certificate-transparency service; the offline verifier requires the certificate chain, envelope signature and authenticated log signing time. Live deployment forwards the original publish to npm under its own policy.
