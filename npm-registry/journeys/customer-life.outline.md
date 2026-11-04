# npm registry customer life: outline

## The customer

**Volter** publishes its twins and its harness to npm and runs applications that read them back
(../journeys/demand.json). Its catalog release (`scripts/pack-release.ts`) asks npm what version each pack is at
(`npm view`) and publishes every version npm lacks (`npm publish --access public`) with the release account's token;
the catalog index's check (`scripts/twin-catalog.ts`) reads each version's document and the attestations it names.
**tabnode** installs packages in a page: a package's abbreviated document, the version a lockfile pins, the tarball.
**Substrate**'s image build fetches each planned package's tarball at the registry's own path. **Volter Harness**
(`supercode update`, and its check at start) reads `@volter/supercode`'s latest version on the stable channel and its
dist-tags on the latest channel. **Twenty**'s app marketplace searches the registry for `keywords:twenty-app`, resolves
an app's latest version and downloads its tarball, and checks a registration claim against the version's provenance.

Dana and Priya each use a website-issued token with package publishing permission, valid until 1 March 2026. Dana may publish in @volter as its owner; Priya publishes unscoped packages.

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| Dana Ruiz, who runs Volter's releases | the npm account `dana-ruiz`, owner of the `volter` organization | npmjs.com's sign-up and "create an organization" pages (doors); the release's token |
| a World application | `NPM_TOKEN`, the World user `world`'s token (the credential door) | npm 10.9.8 |
| tabnode, Substrate's image build | nothing: public packages are read anonymously | the page's fetch, Node's fetch |
| a Volter Harness user | nothing | supercode-cli 0.4.0 |
| the catalog index's check | nothing | Node's fetch |
| Priya Natarajan, a Twenty app developer | the npm account `priya-n` (on npm Pro, for private packages) | npmjs.com's sign-up page; npm publish |
| a Twenty workspace | nothing (APP_REGISTRY_URL is the registry) | Twenty's marketplace and app fetcher |
| Priya's team's own Twenty | `APP_REGISTRY_TOKEN`, her token | Twenty's app fetcher, the token sent with its registry reads |
| the catalog release in CI (GitHub Actions, volter-ai/twin-world's catalog-release workflow) | Dana's token; the job's OIDC identity, which Fulcio certifies | npm publish --provenance |

## The arc

### 1. Setting up (Mon 5 Jan)
Dana signs up and creates the `volter` organization, which owns the `@volter` scope. The World issues its application's
token, the same at every boot; that user is in no organization, so its publish into `@volter` is refused, the scope refusal follows from that missing membership.

### 2. The first release (Tue 6 Jan)
`npm view` finds no `@volter/world-core`; the release publishes it, `@volter/world` 0.1.0 and `@volter/supercode` 0.4.0,
public, with Dana's token. A separate release observer checks the public version metadata to enable downstream installs, including the tarball digests.

### 3. The applications install it (Wed 7 Jan)
tabnode reads each package's abbreviated document (the install form: its dependencies and `dist`, no readme) and the
version its independent lockfile consumer pins without the first installer cache. Substrate receives the returned tarball URLs in its dependency plan and fetches those URLs.

### 4. The harness's update check (Thu 8 Jan)
A Volter Harness user's check reads `@volter/supercode`'s latest version (`/@volter/supercode/latest`, the scope's slash
kept) and, on the latest channel, its dist-tags (`/-/package/@volter/supercode/dist-tags`): 0.4.0, nothing newer.

### 5. The catalog check (Mon 2 Feb)
The index's check reads `@volter/world`: its version names no attestations, since the release published it without
provenance, so the check stops without an attestation request.

### 6. The second release (Tue 3 Feb)
`npm view` answers 0.1.0; the release publishes `@volter/world` 0.2.0 and `@volter/supercode` 0.5.0. The harness's
next check finds 0.5.0 on both channels; tabnode reads both versions of `@volter/world` and downloads the new tarball at the returned URL.

### 7. A Twenty app (Wed 11 Feb)
Priya signs up and publishes `twenty-app-standup` 1.0.0, tagged `twenty-app`, and `standup-core` 1.2.0, which is not.
A Twenty workspace's marketplace searches for `keywords:twenty-app` and finds only the app, with its author, homepage
and publisher; it stops after the short first page. An admin attempts an install: Twenty resolves the version, downloads the returned tarball URL, then rejects the archive because Priya omitted manifest.json. Priya supplies explicit version 1.0.0 for her registration claim, which asks for that version's provenance and finds none (the 404 Twenty reads as no
provenance).

### 8. Priya's internal app (Thu 12 Feb)
Priya's own team runs Twenty with `APP_REGISTRY_TOKEN` set to her token. She publishes `@priya-n/standup-internal`
0.1.0, its manifest.json included, without `--access public`, so the scoped package is restricted to her. Her team's
Twenty resolves the version with the token (the name percent-encoded, as Twenty encodes it) and downloads the
returned tarball, the token sent to the registry's own host.

### 9. The release moves to CI, with provenance (Tue 17 Feb)
The catalog release runs in GitHub Actions and publishes its first pack, `@volter/twin-github` 0.1.0, with
`--provenance`: the job's Sigstore bundle (a certificate Fulcio issued to the job's OIDC identity, its entry in Rekor)
is attached. The registry checks it against Fulcio's trust bundle and Rekor's key, and refuses it: the pack's
package.json names no repository, and npm requires it to match the workflow's. Dana adds the repository and re-runs
the job; the publish is accepted.

### 10. The catalog check reads the provenance (Wed 18 Feb)
The index's check reads `@volter/twin-github`: its version names its attestations, and the check reads them for the
signing certificate's repository and workflow.

## What the life does not do
A walk holds no Fulcio or Rekor of its own: the CI job's bundle is made with the sigstore twin's issuer and log
helpers under keys of the life's, and the life's application answers stand in for Fulcio's trust bundle and Rekor's
key. npm whoami, token create, org membership, deprecate, unpublish, owners, the other dist-tag writes, access and teams, hooks,
stars, audit, profile and legacy login: no application here makes them (the manifest's `unmodeled`).
