// TikTok's manifest: a vendor of two APIs, each a lane (architecture, "Other wires: lanes"): the open platform
// (`open`: Login Kit's token, the Content Posting API, the Display API, the upload host and the authorize page on
// www.tiktok.com), and the API for Business (`business`, business-api.tiktok.com).
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'tiktok',
  discovery: {
    twinOf: "TikTok's open platform: an app's authorize page and tokens, posting videos and photos (direct and to the inbox) with their upload host and status, and a user's profile, stats and videos",
    stores: "the developer site's apps and URL properties, TikTok's people, authorization codes and tokens (by their SHA-256), posts and their uploads, and videos",
  },
  lanes: {
    routes: [
      { lane: 'business', host: '^business-api\\.tiktok\\.com$' },
      { lane: 'open', host: '^(open\\.tiktokapis\\.com|open-upload\\.tiktokapis\\.com|upload\\.us\\.tiktokapis\\.com|www\\.tiktok\\.com)$' },
    ],
    default: 'open',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-tiktok',
    resources: ['publish', 'video'],
    specSource: 'written from the API reference pages of developers.tiktok.com (open/spec/openapi.json, provenance in open/spec/SOURCE.md)',
    description: "TikTok twin — Login Kit's authorize page and tokens, the Content Posting API (direct and inbox videos by chunked upload, photos pulled from verified URLs, post status) and the Display API (user info and stats, video list and query).",
    adoption: { sdks: [], envStems: ['TIKTOK'] },
    hosts: [{ host: 'business-api.tiktok.com' }, { host: 'open.tiktokapis.com' }, { host: 'open-upload.tiktokapis.com' }, { host: 'upload.us.tiktokapis.com' }, { host: 'www.tiktok.com', pathPattern: '^/v2/auth/authorize' }],
    endpointEnvNone: 'an app calls open.tiktokapis.com and sends people to www.tiktok.com; the World claims the hosts',
    clientCasesNone: 'An app calls both TikTok APIs with fetch; no official SDK behaviour is required.',
    // the vendor-backed root's credential, per lane: a person's refresh token with the app's key and secret, traded on
    // each API's refresh grant for the access token every call carries (an open-platform token lives a day), kept until
    // the answered lifetime ends; the refresh token an answer carries replaces the sealed one
    // source: https://developers.tiktok.com/doc/oauth-user-access-token-management "POST https://open.tiktokapis.com/v2/oauth/token/"
    // source: https://developers.tiktok.com/doc/oauth-user-access-token-management "Its value should always be set as"
    // source: https://developers.tiktok.com/doc/oauth-user-access-token-management "may be different than the one passed in the payload"
    // source: spec:ttUserOauth2RefreshToken "Renew a TikTok account access token"
    // Where the documentation stops: the Business page does not say its refresh token rotates; `rotate` keeps a new one
    // when the answer carries it and changes nothing when it carries the same.
    auth: { in: 'lanes', lanes: {
      open: { in: 'exchange',
        request: { method: 'POST', path: '/v2/oauth/token/', format: 'form',
          body: { client_key: { credential: 'client_key' }, client_secret: { credential: 'client_secret' }, grant_type: 'refresh_token', refresh_token: { credential: 'refresh_token' } } },
        token: 'access_token', expiresIn: 'expires_in', rotate: { answer: 'refresh_token', credential: 'refresh_token' } },
      // the Business API reads its token from the Access-Token header, bare, and answers an expired one HTTP 200 with a code
      // source: spec:ttUserOauth2RefreshToken "a refusal is a non-zero code, answered HTTP 200"
      business: { in: 'exchange',
        request: { method: 'POST', path: '/open_api/v1.3/tt_user/oauth2/refresh_token/', format: 'json',
          body: { client_id: { credential: 'business_client_id' }, client_secret: { credential: 'business_client_secret' }, grant_type: 'refresh_token', refresh_token: { credential: 'business_refresh_token' } } },
        token: 'data.access_token', header: 'access-token', scheme: '', expiresIn: 'data.expires_in', rotate: { answer: 'data.refresh_token', credential: 'business_refresh_token' } },
    } },
    credentialDoor: { account: { field: 'account', tenancy: 'Developer account', source: 'https://developers.tiktok.com/doc/login-kit-web' }, deployment: { field: 'deployment', object: 'Registered Open and Business developer applications', source: 'https://developers.tiktok.com/doc/login-kit-web' },  path: '/_twin/app-credentials', body: {}, fill: { TIKTOK_CLIENT_ID: 'client_key', TIKTOK_CLIENT_SECRET: 'client_secret', TIKTOK_BUSINESS_CLIENT_ID: 'business_client_id', TIKTOK_BUSINESS_CLIENT_SECRET: 'business_client_secret' } },
  },
};
