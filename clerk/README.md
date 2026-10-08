# @volter/twin-clerk

A local Clerk instance: the **Backend API** an application's server calls (`@clerk/backend`, unmodified, at
`https://api.clerk.com/v1`) and the **Frontend API** the unmodified `@clerk/clerk-js` bundle calls from the browser (the
instance's own host, `twin.clerk.accounts.dev`), over one state. A user made through the Backend API signs in through
clerk-js; a session clerk-js starts is one the Backend API lists and mints tokens for.

The Frontend API also answers at `frontend-api.clerk.dev`, the destination of Clerk’s documented same-site proxy and vgauth’s Worker. That host routes directly to the Frontend API lane, with the same instance state and browser credentials.

## Use with an existing app

Use Node 22.6 or newer.

Install the exact twin release and World CLI in your app's folder:

```console
npm install --save-dev --save-exact @volter/world@3.0.146 @volter/twin-clerk@1.0.3
./node_modules/.bin/volter world init --name my-app --twins clerk --source clerk=@volter/twin-clerk
```

Review the selected vendor and generated bindings before starting. The World supplies synthetic credentials;
keep your app's real SDK. Read this release's modeled scope below.

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Replace `npm test` with your app's usual command. `down` retains data, and a later `up` resumes it.
Use these installed executables from the same app folder; install there first if they are missing.
[Bring an existing app](https://world-docs.volter.ai/docs/guides/use-with-an-existing-app) explains multi-vendor selection and routing.

A Protocol 3 derived pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md), "Protocol 3" and "Creating a
pack"): the surface is generated from Clerk's published OpenAPI documents (`spec/`, `fapi/spec/`), plain reads, writes
and deletes are the derived core's, the state machines are `src/semantics/states.ts`, and handlers by operationId
(`src/semantics/<family>.ts`) serve only what an operation does beyond them. Every other operation answers Clerk's own
404. The immutable catalog assessment records the declared surface, measured journeys and remaining gaps.

```bash
world-clerk serve [--port N] [--root DIR] [--read-only]
```

A World makes its people through the Backend API's own `POST /users`. Nothing is signed in.

## What it models

- **Backend API**: users (made, updated, their metadata merged or replaced, listed and counted with Clerk's filters,
  deleted), sessions (made for a test, listed, revoked, their tokens), sign-in tokens (made,
  revoked, used once by the Frontend API), an instance's organization settings (Organizations are off until
  turned on, as on a new Clerk instance), custom permissions and roles beside the system ones, organizations with
  their memberships and invitations, JWT templates, SAML enterprise configuration and the instance's public keys.
- **Frontend API** (what clerk-js needs to boot and what the applications measured drive through it): the environment,
  the dev browser, the client and its `__client` cookie, sign-up by email and password (the address verified by an
  emailed code) and by an invitation's ticket, sign-in by password, by an emailed code and by ticket, sessions (touched,
  read and their tokens), an
  invitation's link, and `/.well-known/jwks.json`. Clerk's published clerk-js bundle (5.127.2,
  `vendor/clerk-js/`, with its SOURCE.md) is served as published at the `/npm/@clerk/clerk-js` loader path.
- **Webhooks**: user.deleted, Svix-signed, to the instance's webhook endpoints. The payload includes timestamp, instance_id, request event_attributes and the deleted user's external_id. Each delivery is recorded; the Dashboard endpoint is set through `POST /_twin/webhook-endpoints`.

The OAuth identity-provider flow serves the account worker used by Volter Editor: authorization redirects to sign-in and explicit consent, then a registered callback receives a single-use code bound to S256 PKCE. The worker exchanges it at `/oauth/token`; refresh grants retain the user and selected organization. Access tokens use the `at+jwt` header type Clerk's SDK expects; OpenID Connect ID tokens use `JWT`. Register the public OAuth application with `POST /v1/oauth_applications` before using it. Codes expire after ten minutes, access and ID tokens after one day, and refresh tokens after ten years in the pinned Frontend API spec.

The Frontend API accepts the documented `clerk.<application domain>` host family and `frontend-api.clerk.dev`; proxy calls require a held instance secret key in `Clerk-Secret-Key`, the full `Clerk-Proxy-Url`, and `X-Forwarded-For`.

Organization settings are stored as the Backend API's `OrganizationSettings` singleton and read back through `GET /v1/instance/organization_settings`; the Frontend environment renders its domain fields in the Frontend shape. Dashboard-only sign-in configuration remains private bookkeeping. Memberships retain the Backend API's `public_user_data.user_id` reference, including after refresh. The known-resource scopes read JWT templates, enterprise connections and their SAML children without promising enumeration for those types.

## Keys

The Backend API takes only the keys the instance holds: the application's, which the World issues when it boots
(`POST /_twin/app-credentials`, the descriptor's credential door, with the publishable key, the `CLERK_JWT_KEY` a
backend verifies session tokens with and the webhook signing secret), and every key the API Keys page's door made. No
`Authorization` header is Clerk's 401 `authorization_header_format_invalid`, and any other key, whatever its shape, is
its 401 `clerk_key_invalid`. A request with no secret key is never the Backend API's: on a Frontend API path it is the
browser's, answered by the Frontend API.

**Each World signs with its own key.** Session tokens, the tokens of JWT templates without a key of their own, and
invitation tickets are signed with an RSA key the World makes once at random (`ctx.signingKey`), served as the
instance's JWKS, so a token verifies only against the World that issued it and no one can mint one from this package.
A template with its own signing key signs with that key, in its algorithm (RSA or HMAC, SHA-256 to 512; others are
refused).

## Doors

The World's hands on the instance, standing in for the Clerk Dashboard (`src/semantics/doors.ts`); the `POST` doors are
refused on a read-only twin:

- `POST /_twin/secret-keys {name}`: a secret key, as the API Keys page shows it once (`sk_test_…` on a development
  instance); the twin keeps its hash.
- `POST /_twin/webhook-endpoints {url, events, signing_secret?}`: a webhook endpoint and its `whsec_…` signing secret
  (the one given, when the World's application already holds one).
- `POST /_twin/instance {…}`: the instance's sign-up settings (password on or off, legal consent, organization
  membership optional or required, the Frontend API host, the Native API on or off).
- `POST /_twin/native-applications {platform, …}`: an iOS app (`app_id_prefix`, `bundle_id`) or Android app
  (`package_name`) registered on the Native applications page. A native client's request (`_is_native=true`, its client
  token in `Authorization`) is Clerk's 400 `native_api_disabled` until the Native API is on.
- `GET /_twin/emails?to=<address>`: what Clerk sent an address (verification codes, invitations), oldest first.
- `GET /_twin/webhook-messages?type=<event>`: what was delivered to the webhook endpoints, oldest first.

## Not modelled

OAuth device authorization, token exchange, dynamic registration, userinfo and revocation; SSO sign-in (an enterprise connection is configured, never signed in through) and passkeys; multi-factor authentication; phone numbers; application-invitation acceptance and revocation,
allowlist and blocklist, actor tokens, redirect URLs, domains, OAuth application updates and deletion, and the webhook
endpoints API; uploaded logos and profile images; standalone SAML mutations and enumeration (known connections are readable), permission/role deletion, UserProfile and client session removal, and every Frontend API route clerk-js's organization components drive. Each
answers the gap, never a fabricated success.

The first-party account broker’s production share invitation calls Backend API `CreateInvitation`; the companion stores that application invitation, sends its ticket to the modeled recipient inbox, and exposes `ListInvitations` for read-back. These operations honor notification, metadata, expiration and duplicate handling. Application-invitation acceptance, revocation and bulk creation remain separate gaps.
