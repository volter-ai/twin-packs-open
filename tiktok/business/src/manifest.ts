// The business lane's manifest: the vendor facts its spec (../spec, written from the API for Business v1.3 pages) does
// not carry. Served is what the customer life walks (../../journeys/demand.json,
// ../../journeys/decisions.json); revoking and the token's scopes are `unmodeled`.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'tiktok',
  // the vendor's one store: the open lane's apps, people, codes, posts and videos are these too
  service: 'tiktok',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // "Every Business API endpoint (except OAuth) ... wraps the payload in {code, message, data}" (clients read it so):
  // a refusal is a non-zero code, answered HTTP 200
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "These return codes take precedence over HTTP status codes"
  error: { code: '{code}', message: '{message}', request_id: '{id}', data: {} },
  errorsAnsweredAs: { status: 200, below: 500 },
  readOnly: { status: 200, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 200, code: 40008, message: "The interface (endpoint) has not been implemented." },
  // source: https://business-api.tiktok.com/gateway/api/doc/client/node/get/v2/?identify_key=c0138ffadd90a955c1f0670a56fe348d1d40680b3c89461e09f78ed26785164b&doc_id=1737172488964097&language=ENGLISH "The interface (endpoint) has not been implemented."
  // Where documentation stops: token errors do not establish an authentication gate before unknown-route resolution.
  gap: { status: 200, code: 40008, message: "The interface (endpoint) has not been implemented." },
  deleted: {},
  resources: {
    // the store's posts and videos are the open lane's types too, read back there; the API for Business names each account by
    // a business_id the World keeps for none, so nothing is read through this lane
    publish: { idPrefix: '', ...states.publish, refresh: { none: "the business lane's status read (GET business/publish/status) needs the account's business_id, which the World keeps for no publish; the open lane declares why publishes are not read back" } },
    video: { idPrefix: '', refresh: { none: "the business lane's video list needs the account's business_id, which the World keeps for none; the open lane reads the root's videos back" } },
    _access_token: { idPrefix: 'act_', ids: '{prefix}{n}' },
    _refresh_token: { idPrefix: 'rft_', ids: '{prefix}{n}' },
    _seq_publish: { idPrefix: '', ids: '{n}' },
    _seq_video: { idPrefix: '', ids: '{n}' },
  },
  unmodeled: ['ttUserOauth2Revoke', 'ttUserTokenInfoGet'],
  discovery: {
    twinOf: "TikTok's API for Business v1.3 as a TikTok account's owner uses it: its tokens, its profile, its posts, publishing videos and photos by URL, the publishing status, location tags and the Commercial Music Library's popular tracks",
    stores: "the vendor's one store (the open lane's): apps, people, codes and tokens, posts and videos, and the World's location tags and tracks",
  },
};
