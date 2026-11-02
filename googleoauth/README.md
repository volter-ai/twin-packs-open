# @volter/twin-googleoauth

Google OAuth 2.0 and OpenID Connect at the vendor's identity endpoints. The [spec provenance](./spec/SOURCE.md) records the identity documentation, Discovery document and retained upstream response. [Demand](./journeys/demand.json) names the application callers.

The twin serves discovery, the account chooser and consent redirect, authorization-code exchange with PKCE, refresh tokens, service-account JWT assertions, revocation, token information, userinfo and signing keys. ID tokens use the World's signing key. Credentials and account data remain local; no request signs in to Google or creates a real Google account. Device authorization is an explicit gap.

`POST /_twin/credentials` supplies the service-account JSON key file, OAuth client, synthetic person and project API key described by the manifest's credential door. The runtime fills `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `YOUTUBE_API_KEY`. Repeating the same request returns the same credentials. Its optional `world_account` selects a named World account and is distinct from the nested `account` object describing the person who consents. Named accounts receive separate client credentials, service accounts and synthetic people.

The setup doors also accept individual OAuth clients (`POST /_twin/clients`), people (`POST /_twin/accounts`) and service accounts (`POST /_twin/service-accounts`). A client registers its exact redirect URIs before authorization. The chooser lists the people held in this World and redirects to the selected client's registered URI after consent.

Rules, layout and tools: [the architecture](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md#protocol-3-the-derived-pack) and [the public publisher guide](../README.md).
