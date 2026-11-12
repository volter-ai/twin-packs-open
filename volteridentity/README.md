# @volter/twin-volteridentity

The Volter Identity twin (`id.volter.ai`, Protocol 3). Its surface is derived from the service's own routes (`spec/`,
provenance in `spec/SOURCE.md`: Better Auth 1.7.5's plugins as the service configures them, and its product
organizations API), trimmed to what Volter's products call ([journeys/demand.json](./journeys/demand.json)):

| what it serves | for whom |
|---|---|
| discovery, JWKS, authorize (PKCE S256) with the sign-in page, the token endpoint (authorization code, refresh, `client_credentials` for `https://id.volter.ai/organizations`, the device code; a `resource` only one linked to the client), userinfo; tokens signed EdDSA | Twin, Volter Harness, Substrate, Open Autonomy, RH2 |
| the device code (a confidential client with its secret), the device page, and the code's claim and approval with a session (`GET /api/auth/device`, `POST /api/auth/device/approve`) | Volter Harness, RH2's widget and iOS app |
| GitHub and Google social sign-in and callbacks; Sign in with Apple by its ID token (`POST /api/auth/sign-in/social`) | RH2's iOS app |
| people and organizations, members and invitations (`/api/people`, `/api/organizations`) | Twin, with its organizations token |
| the operator's registration: `POST /admin/clients`, `/admin/resources`, `/admin/clients/{id}/resources`, behind a session and the admin token | the operator (Open Autonomy's and Twin's Worlds) |

## Clients

Products are registered by the operator through `/admin/clients`, which mints the client's id and secret with Better
Auth's defaults: a confidential client with its secret (`client_secret_basic` or `client_secret_post`), or a public one
with none (`token_endpoint_auth_method: none`, PKCE required). Each client takes only its registered grant types and
`client_credentials` scopes, and names only the resources linked to it. A loopback redirect (`http://127.0.0.1`)
matches on any port (RFC 8252 7.3) for a native client. The one exception is the shared client `@volter/identity`
signs in with, under the id the package publishes, made by `/_twin/shared-client`. ID tokens and resource access tokens are signed EdDSA (Ed25519)
with the World's issuer key (`ctx.signingKey`); codes, sessions and refresh tokens are drawn from the World's secrets
and kept by their SHA-256.

## Doors

- `POST /_twin/settings {ISSUER}`: the installation's permanent issuer, configured before OAuth account setup; the default is `https://id.volter.ai`. Discovery, redirects and JWT claims use this setting regardless of the request route.

- `POST /_twin/users {email, name?, emailVerified?}`: an existing emailed-code or passkey identity; social identities and their linked accounts are created by provider sign-in.
- `POST /_twin/shared-client`: `@volter/identity`'s shared public client, under the id the package publishes.
- `POST /_twin/app-credentials`: the operator's admin token for account setup (`IDENTITY_ADMIN_TOKEN`).
- `POST /_twin/social {provider: github | google | apple, client_id, client_secret?}`: the service's OAuth app at the
  provider; for Apple, `client_id` is the iOS app ids and no secret is sent.

## Journeys

`journeys/customer-life.json` (outline beside it): the operator's registration, Twin's organizations, supercode by
browser and device code, a Substrate share, Open Autonomy's giving page, and RH2's console, widget and the native iOS sign-in refusal. The life runs GitHub and Google as companion twins and reads the GitHub-linked funder id as Open Autonomy does. RH2's iOS Apple request receives 401 INVALID_TOKEN when the World cannot fetch Apple's verification keys; the app then stops before claim and approval. Verified native sign-in is recorded as vendor-backed, requiring the real Apple.

Rules, layout and tools: twin-world's architecture ("Protocol 3", "The catalog: where twins come from").

The login and device screens stand in for the hosted identity pages over the same people and sessions. The operator and product APIs are served; introspection, revocation, consent and the remaining Better Auth routes answer the documented gap. Provider calls reach the corresponding twin through ctx.vendorFetch; a World running no twin of a provider refuses its keys fetch.

Authorization honors client grants, scopes and S256 PKCE. Access tokens without a resource are opaque; resource tokens are signed JWTs. ID tokens preserve authentication time across refresh and include acr and at_hash. Device approval uses the signed-in session and preserves an existing claimant; the bare page accepts an entered code. Social identities retain their actual email-verification flag.

Consent-dependent authorization is outside the served first-party flows and returns invalid_request rather than issuing a code. Operator client registration, resource registration and resource linking declare `accountSetup`: their writes configure the account and are never deployed. A vendor-backed root carries the product's organizations client-credentials token. Refresh reads each known person and organization by id, then lists members and invitations under the observed organizations. Completeness covers only the known subjects and their member lists. Invitation lists are incomplete because the vendor exposes only pending, unexpired invitations.

Refresh tokens rotate while retaining the predecessor's revoked state. Under the modeled issuer's
zero-grace policy, reuse of a known, unexpired predecessor invalidates the same client's person family
and the opaque access tokens linked to those grants. Unknown, expired and wrong-client tokens refuse
without invalidating another family. A held-resource mismatch or a scope outside the held grant
refuses before reuse can invalidate the family. Current resource registration and client linkage are
checked only for an active grant's issuance: a resource-unbound revoked predecessor still invalidates
its family when reused with an unregistered resource. A successful scope reduction carries only its requested scopes forward.
A grant that held `offline_access` still issues a successor when the requested scope reduction omits it;
the successor itself holds only those reduced scopes. When neither held nor requested scopes include
`offline_access`, refresh issues no successor and leaves the grant reusable, preserving its siblings.
When both the held resource and requested scope mismatch, the held-resource refusal comes first.
A normal new device sign-in can issue a usable grant afterward.
This rule is sourced from the pinned provider in `spec/SOURCE.md`; thirty-second encrypted response
replay is a separate issuer change and is not represented by this pack. Existing JWTs keep their
signature/expiry semantics.
