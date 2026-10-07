// Every state machine of the Frontend API lane (docs/contributing/architecture.md, "What an author writes, and how": the
// one place a pack writes its states), keyed by the lane manifest's resource names. ../manifest.ts takes each whole.
import type { StateField } from '@volter/world-core';

const SIGN_UP_COMPLETE = 'spec:/components/schemas/Client.SignUp/properties/missing_fields/description "These fields are mandatory in order for the sign-up to satisfy the attached registration policy and be marked as complete."';
const SIGN_UP_VERIFY = 'spec:/components/schemas/Client.SignUp/properties/unverified_fields/description "List of fields which are already supplied to the current sign-up but they need to be verified."';
const SIGN_UP_UPDATE = 'spec:updateSignUps "Updates the sign-up object specified by ID, with the supplied parameters."';
const SIGN_IN_CREATE = 'spec:createSignIn "In order to authenticate a Sign in in as few requests as possible, you can pass in parameters to this request that can identify and verify the Sign in."';
const SIGN_IN_IDENTIFIED = 'spec:prepareSignInFactorOne "Prepares the verification object for the identified Sign in."';
const SIGN_IN_ATTEMPT = 'spec:attemptSignInFactorOne "Requires the sign in attempt to be identified, and the first factor verification to be prepared, unless you\'re using a password."';

/** A sign-up's `status` (spec:/components/schemas/Client.SignUp/properties/status). It is `missing_requirements` until
 *  every required field is given and every given identifier verified, then `complete` (and a user and a session exist).
 *  A sign-up is `abandoned` by Clerk when its `abandon_at` passes; that move is the vendor's clock and is not made here. */
const signUpStatus: StateField = {
  initial: 'missing_requirements',
  transitions: [
    // fields given, something still missing or unverified: the sign-up stays
    { operation: 'createSignUps', from: ['missing_requirements'], to: 'missing_requirements', source: SIGN_UP_VERIFY },
    { operation: 'createSignUps', from: ['missing_requirements'], to: 'complete', source: SIGN_UP_COMPLETE },
    { operation: 'updateSignUps', from: ['missing_requirements'], to: 'missing_requirements', source: SIGN_UP_UPDATE },
    { operation: 'updateSignUps', from: ['missing_requirements'], to: 'complete', source: SIGN_UP_COMPLETE },
    // the address verified, a required field still missing: the sign-up stays
    { operation: 'attemptSignUpsVerification', from: ['missing_requirements'], to: 'missing_requirements', source: SIGN_UP_COMPLETE },
    {
      operation: 'attemptSignUpsVerification', from: ['missing_requirements'], to: 'complete', source: SIGN_UP_COMPLETE,
    },
  ],
};

const OAUTH_STARTED = 'spec:/components/schemas/Stubs.Verification.Oauth "external_verification_redirect_url"';
const OAUTH_CALLBACK = 'spec:getOauthCallback "The endpoint where the OAuth providers redirect to after a successful authentication attempt."';
const OAUTH_TRANSFERABLE = 'spec:/components/schemas/Stubs.Verification.Oauth "transferable"';

/** A sign-in's `status` (spec:/components/schemas/Client.SignIn/properties/status). A sign-in is made naming its user
 *  (`needs_first_factor`), or naming and proving them at once (a password given with the identifier, or a ticket:
 *  `complete`); a first factor proved completes it (no second factor is enabled: ./environment.ts). The vendor's other
 *  moves (`needs_second_factor`, `needs_new_password`, `needs_client_trust`, `abandoned`) are not made here. */
const signInStatus: StateField = {
  initial: 'needs_identifier',
  transitions: [
    { operation: 'createSignIn', from: ['needs_identifier'], to: 'needs_identifier', source: OAUTH_STARTED },
    { operation: 'getOauthCallback', from: ['needs_identifier'], to: 'complete', source: OAUTH_CALLBACK },
    { operation: 'getOauthCallback', from: ['needs_identifier'], to: 'needs_identifier', source: OAUTH_TRANSFERABLE },
    { operation: 'createSignIn', from: ['needs_identifier'], to: 'needs_first_factor', source: SIGN_IN_IDENTIFIED },
    { operation: 'createSignIn', from: ['needs_identifier'], to: 'complete', source: SIGN_IN_CREATE },
    {
      operation: 'attemptSignInFactorOne', from: ['needs_first_factor'], to: 'complete', source: SIGN_IN_ATTEMPT,
      // a complete sign-in's first factor is verified: https://clerk.com/docs/guides/development/errors/frontend-api,
      // VerificationAlreadyVerified, 400
      refusals: { complete: { status: 400, code: 'verification_already_verified', message: 'This verification has already been verified.' } },
    },
  ],
};

// The root Session machine owns the lifecycle; this lane changes only activity and organization selection.
export const states: Record<string, { state?: Record<string, StateField>; notState?: string[] }> = {
  _oauth_code: { state: { status: { initial: 'active', transitions: [
    { operation: 'getOAuthToken', from: ['active'], to: 'used', source: 'https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "Each code can be exchanged once before it expires."' },
    { operation: 'getOAuthToken', from: ['used'], refusal: { status: 401, code: 'invalid_grant', message: 'The authorization code has already been used.' }, source: 'https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "Each code can be exchanged once before it expires."' },
  ] } } },
  'Client.SignUp': { state: { status: signUpStatus } },
  'Client.SignIn': { state: { status: signInStatus } },
  'Client.Session-2': { state: { status: { initial: 'active', transitions: [{ operation: 'removeClientSessionsAndRetainCookie', from: ['active'], to: 'removed', source: 'spec:removeClientSessionsAndRetainCookie "Removes all the sessions of the current client without removing the __client cookie"' }] } } },
};
