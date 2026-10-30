// The id lane's state machines (docs/contributing/architecture.md, "State"): what id.twitch.tv's credentials move
// through, each keyed by the lane manifest's resource names. A token's expiry is its clock's, read when it is presented
// (its `expires_at`), not a move.
import type { StateField } from '@volter/world-core';

/** An access token (`_token`, kept by its SHA-256): active until its app revokes it. */
const tokenStatus: StateField = {
  initial: 'active',
  transitions: [
    { operation: 'oauth2Revoke', from: ['active'], to: 'revoked', source: 'https://dev.twitch.tv/docs/authentication/revoke-tokens/' },
  ],
};

/** An authorization code (`_authorization_code`, kept by its SHA-256): issued by the authorize page, spent by the token
 *  it is traded for. */
const codeStatus: StateField = {
  initial: 'issued',
  transitions: [
    { operation: 'oauth2Token', from: ['issued'], to: 'spent', source: 'https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/' },
  ],
};

export const states = {
  _token: { state: { status: tokenStatus } },
  _authorization_code: { state: { status: codeStatus } },
};
