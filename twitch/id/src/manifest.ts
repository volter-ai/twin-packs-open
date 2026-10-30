// The id lane's manifest: Twitch's authentication service at id.twitch.tv (docs/contributing/architecture.md, "Other
// wires: lanes"), over the vendor's one store. The surface is generated (./generated/surface.gen.json, from ../spec by
// derive-pack): the token endpoint (the client credentials, authorization code and refresh token grants), validate,
// revoke and the device code request, written from Twitch's authentication pages (../spec/SOURCE.md). The authorize
// page is this lane's screen (./screens/authorize.tsx).
//
// THE STATE THIS LANE SHARES WITH THE ROOT: the developer console's applications (`application`) and their client
// secrets, the accounts a person authorizes as (`user`), and the people who log in (the kernel's `_person`, the session
// kit's `_web_session`), all the root's (../../src/manifest.ts). THE STATE IT KEEPS: the tokens it issues (`_token`) and
// the authorization codes the authorize page issues (`_authorization_code`), each by its SHA-256, which the Twitch API's
// front reads (../../src/semantics/around.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'twitch',
  service: 'twitch',
  // source: https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/ "Set the following x-www-form-urlencoded parameters"
  body: { form: { coerce: false } },
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: https://dev.twitch.tv/docs/authentication/revoke-tokens/ "client does not exist"
  // id.twitch.tv's refusals carry the status and a message ({ "status": 404, "message": "client does not exist" })
  error: { status: '{status}', message: '{message}' },
  readOnly: { status: 403, message: 'This twin is running read-only; writes are refused.' },
  // Where the documentation stops: Twitch documents no answer for a path id.twitch.tv does not have; the twin answers
  // its error body with 404.
  notFound: { status: 404, message: 'Not Found' },
  deleted: {},
  resources: {
    _token: { idPrefix: '', ...states._token, refresh: { none: "a token is a credential the app holds; Twitch's API lists no tokens (validate reads one the caller presents)" } },
    _authorization_code: { idPrefix: '', ...states._authorization_code, refresh: { none: 'an authorization code is spent once by the token it is traded for; nothing reads one back' } },
  },
  screens: [{
    id: 'authorize', kind: 'flow', host: 'id.twitch.tv', path: '/oauth2/authorize', status: 'done',
    controls: ['Username', 'Password', 'Log In', 'Authorize', 'Cancel'],
    demand: "the simulated viewers send each viewer here to authorize the app with user:write:chat (the authorization code grant flow), and the viewer is redirected back with a code or with access_denied (journeys/demand.json)",
    source: 'https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/',
  }],
  vendorBacked: { none: "id.twitch.tv issues credentials (tokens, codes): a credential's secret is never refreshed from the vendor into a World (credential custody), and nothing else is stored here" },
  hosts: [{ host: 'id.twitch.tv' }],
  discovery: {
    twinOf: "Twitch's authentication service: the authorize page (log in, Authorize, Cancel), the token endpoint (client credentials, authorization code, refresh token), validate and revoke",
    stores: 'the tokens and authorization codes it issues, each by its SHA-256',
  },
};
