# sigstore customer life: outline

## The customer

**Volter** publishes its twins to npm from a GitHub Actions workflow with provenance (company RFC 0012, designed; the
workflow holds `id-token: write`): `npm publish --provenance` asks Fulcio for a code-signing certificate for the
workflow's GitHub Actions identity, signs an in-toto SLSA provenance statement about the tarball, and logs it in Rekor as
a `dsse` entry (../journeys/demand.json). The World's npm registry checks the bundle it is sent against Fulcio's trust
bundle.

The World clock starts 2026-01-01.

## People and programs

| who | holds | how |
|---|---|---|
| the release workflow | a GitHub Actions identity token (the World's GitHub twin issues it), an ephemeral key | npm 10.9.8's @sigstore/sign |
| the World's npm registry | nothing | reads Fulcio's trust bundle |

## The arc

### 1. The first release (Tue 6 Jan)
The registry reads Fulcio's trust bundle, the same root each time. Fulcio refuses a certificate request with no
identity token, a token that is no JWT, and a token from an issuer it does not trust. npm logs `@volter/world-core`'s
statement: the answer carries the entry's signed timestamp, its inclusion proof and the log's signed checkpoint.
Proposing it again is Rekor's conflict, naming the entry. `@volter/world`'s is the second entry. An entry of a kind the
log does not keep is refused.

### 2. The second release (Tue 3 Feb)
`@volter/world` 0.2.0's statement is the third entry, integrated at the World's moment; the trust bundle is unchanged.

## What the life does not walk
Fulcio issuing the certificate: it checks the identity token against the World's GitHub twin (its OIDC discovery and
keys), which a walk of this pack alone does not run; a World running both walks it with `npm publish --provenance`.
Rekor's reads and Fulcio's configuration: no application here calls them.
