// X's state machines, each move cited: consent, single-use code and refresh credentials,
// OAuth 1.0a request tokens, upload sessions and Article publication.
import type { StateField } from '@volter/world-core';

const CODE_FLOW = 'https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token';
const AUTHORIZATION_CODE = 'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code';
const OAUTH1_REFERENCE = 'https://docs.x.com/fundamentals/authentication/api-reference';
const OAUTH1_THREE_LEGGED = 'https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens';

/** An authorize screen in flight settles once: the person presses Authorize app or Cancel, and the browser is sent to
 *  the callback with a code or `error=access_denied` (the Authorization Code Flow page: "Your users will be able to
 *  authorize your App or decline permission. After the user makes their choice, X will redirect the user to your
 *  App"). A settled screen takes no second decision. */
const authRequestSettled: StateField = {
  initial: false,
  transitions: [
    { actor: 'external', from: ['false'], to: 'true', source: CODE_FLOW },
  ],
};

/** An authorization code redeems once ("you can use the authorization code to create an access token", the token
 *  endpoint's step 3). Where the documentation stops: single use and the refusal's words are RFC 6749 §4.1.2's rule
 *  and the reported wire string (./shared.ts badAuthorizationCode). Not made by the twin: a code X
 *  revokes because it was presented twice (RFC 6749 §4.1.2's SHOULD), X's own move. */
const codeConsumed: StateField = {
  initial: false,
  transitions: [
    { operation: 'post_2_oauth2_token', from: ['false'], to: 'true', refusal: { status: 400, code: 'invalid_request', message: 'Value passed for the authorization code was invalid.' }, source: CODE_FLOW },
  ],
};

/** Refresh rotation consumes the presented credential once; the real-system root uses this grant. */
const refreshRevoked: StateField = {
  initial: false,
  transitions: [
    { operation: 'post_2_oauth2_token', from: ['false'], to: 'true', refusal: { status: 400, code: 'invalid_request', message: 'Value passed for the token was invalid.' }, source: CODE_FLOW },
  ],
};

/** An OAuth 1.0a request token's life across the three legs (the 3-legged flow page: "Create a request for a
 *  consumer application to obtain a request token. Have the user authenticate, and send the consumer application a
 *  request token. Convert the request token into a usable user access token"): issued by request_token, `pending`
 *  while its screen is shown (bound to the account the screen names), `authorized` or `denied` by the person's
 *  decision (GET oauth/authenticate authorizes an issued token without a screen for an App the person already
 *  approved), and `exchanged` by access_token. A token no longer issued or pending opens no screen; only an authorized
 *  one is exchanged. Not made by the twin: a request token's expiry (X's lifetime is undocumented;
 *  x.oauth1.request_token_ttl). */
const requestTokenState: StateField = {
  initial: 'issued',
  transitions: [
    // the screen shown (again): a guard that lets a pending token stay pending comes first
    { actor: 'external', from: ['issued', 'pending'], to: 'pending', source: OAUTH1_REFERENCE },
    // Authorize app on the screen, or oauth/authenticate skipping the screen for an App already approved
    { actor: 'external', from: ['issued', 'pending'], to: 'authorized', source: OAUTH1_THREE_LEGGED },
    // Cancel on the screen
    { actor: 'external', from: ['pending'], to: 'denied', source: OAUTH1_THREE_LEGGED },
    // step 3: the verifier exchanged for the access token, once
    { operation: 'post_oauth_access_token', from: ['authorized'], to: 'exchanged', refusal: { status: 401, code: '89', message: 'Invalid or expired token.' }, source: OAUTH1_REFERENCE },
  ],
};

// ── an upload session ───────────────────────────────────────────────────────────────────────────

const PROCESSING = 'spec:/components/schemas/GetMediaUploadStatusResponseDataProcessingInfo/properties/state "Processing state (pending, in_progress, failed, succeeded)."';
const FINALIZE = 'spec:finalizeMediaUpload "Finalizes a Media upload request."';
const STATUS = 'spec:getMediaUploadStatus "Retrieves the status of a Media upload by its ID."';
const CHECK_AFTER = 'spec:/components/schemas/GetMediaUploadStatusResponseDataProcessingInfo/properties/check_after_secs "Seconds to wait before polling status again."';

/** An upload session's state (the `upload` bookkeeping record, shared.ts `XMediaRecord.state`): `initialized` while its
 *  segments arrive, then an image `succeeded` the moment its bytes are whole, and a video `processing` (X's pending,
 *  then in_progress) until STATUS reads or the World clock walk it to `succeeded`; bytes X would not take as a video
 *  `failed`. A session no longer `initialized` takes no segment and no second finalize. Where the documentation stops:
 *  the refusal's words ("Media <id> is already finalized.") are the twin's, in X's invalid-request form. Not made by
 *  the twin: a video that fails in X's transcoder after it was taken (the twin transcodes nothing), X's own move. */
const uploadState: StateField = {
  initial: 'initialized',
  transitions: [
    // a segment lands on a session still open
    { operation: 'appendMediaUpload', from: ['initialized'], source: FINALIZE },
    // in any other state it is refused (a refusal with no `to` refuses where it stands)
    { operation: 'appendMediaUpload', from: '*', refusal: { status: 400, message: 'Media {id} is already finalized.' }, source: FINALIZE },
    // FINALIZE
    { operation: 'finalizeMediaUpload', from: ['initialized'], to: 'succeeded', refusal: { status: 400, message: 'Media {id} is already finalized.' }, source: PROCESSING },
    { operation: 'finalizeMediaUpload', from: ['initialized'], to: 'processing', refusal: { status: 400, message: 'Media {id} is already finalized.' }, source: PROCESSING },
    { operation: 'finalizeMediaUpload', from: ['initialized'], to: 'failed', refusal: { status: 400, message: 'Media {id} is already finalized.' }, source: PROCESSING },
    // a STATUS read of a processing video walks it one state (pending → in_progress → succeeded)
    { operation: 'getMediaUploadStatus', from: ['processing'], to: 'processing', source: STATUS },
    { operation: 'getMediaUploadStatus', from: ['processing'], to: 'succeeded', source: STATUS },
    // time walks it too: one step per check_after_secs since FINALIZE
    { actor: 'time', from: ['processing'], to: 'processing', source: CHECK_AFTER },
    { actor: 'time', from: ['processing'], to: 'succeeded', source: CHECK_AFTER },
  ],
};

// ── an Article ──────────────────────────────────────────────────────────────────────────────────

/** An Article is a draft until it is published, once: "Creates a new Article draft that can later be published", and
 *  publishing "Publishes a draft Article, making it publicly visible" (spec:articleCreateDraft, spec:articlePublish).
 *  Where the documentation stops: the refusal of a second publish, and its words, are the twin's, in X's
 *  invalid-request form. */
const articleStatus: StateField = {
  initial: 'draft',
  transitions: [
    { operation: 'articlePublish', from: ['draft'], to: 'published', refusal: { status: 400, message: 'Article {id} is already published.' }, source: 'spec:articlePublish "Publishes a draft Article, making it publicly visible."' },
  ],
};

export const states = {
  // source: spec:/components/schemas/User/properties/is_identity_verified "Indicates if this User has completed identity verification."
  User: { notState: ['is_identity_verified'] },
  auth_request: { state: { settled: authRequestSettled } },
  _authorization_code: { state: { consumed: codeConsumed } },
  _refresh_token: { state: { revoked: refreshRevoked } },
  _oauth1_request_token: { state: { state: requestTokenState } },
  upload: { state: { state: uploadState } },
  article: { state: { status: articleStatus } },
};
