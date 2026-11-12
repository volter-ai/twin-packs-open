# @volter/twin-sigstore

The Sigstore twin: the two public services `npm publish --provenance` signs through.

- **Fulcio** (`fulcio.sigstore.dev`, lane `fulcio/`, from Fulcio's own API description): a code-signing certificate for a
  key whose holder proves an OIDC identity. It trusts GitHub Actions' issuer (the World's GitHub twin), checks the token
  against the issuer's keys and the `sigstore` audience, checks the key signed the token's subject, and issues a
  certificate from the World's Fulcio root naming the workflow (SAN) and its repository, commit and run (Fulcio's
  `1.3.6.1.4.1.57264.1.8`–`.24` extensions).
- **Rekor** (`rekor.sigstore.dev`, lane `rekor/`, from Rekor's API description): the transparency log. An entry
  (`intoto`, `dsse`, `hashedrekord`) is kept canonicalized and answered with the log's signed entry timestamp and its
  RFC 6962 inclusion proof and checkpoint; a repeated entry is the log's conflict.

Served is what `npm publish --provenance` and the World's npm registry call ([journeys/demand.json](./journeys/demand.json)):
Fulcio's `signingCert` and `trustBundle`, and Rekor's entry creation and public verification key. Fulcio's configuration and Rekor's other reads (log
info, proofs, entries by UUID or index, search) are each lane's `unmodeled`. Not modelled: Fulcio's issuers
other than GitHub Actions.

Keys: Fulcio's root and Rekor's log key are the World's signing keys (`ctx.signingKey`), made once and kept.

## Journeys

`journeys/customer-life.json` (outline beside it): Volter's releases logged with provenance.
