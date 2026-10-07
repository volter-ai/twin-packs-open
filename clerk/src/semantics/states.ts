// Every state machine and state ruling of the Backend API (docs/contributing/architecture.md, "What an author writes,
// and how": the one place a pack writes its states), keyed by the manifest's resource names: each state field's machine
// (its initial state, and each transition with the operation or actor that makes it, its refusal and its citation), and
// the candidates ruled not state fields, each with its reason. ../manifest.ts takes each resource's whole.
import type { StateField } from '@volter/world-core';

const INVITATION = 'spec:/paths/~1organizations~1{organization_id}~1invitations/post/description "New organization invitations get a \\"pending\\" status until they are revoked by an organization administrator or accepted by the invitee."';
const REVOKE = 'spec:/paths/~1organizations~1{organization_id}~1invitations~1{invitation_id}~1revoke/post/description "Only organization invitations with \\"pending\\" status can be revoked."';

/** An organization invitation's `status`. The spec's schema lists no values; its operations' descriptions name them. A
 *  revocation of one that is not pending is Clerk's 404 `organization_invitation_not_pending`
 *  (https://clerk.com/docs/guides/development/errors/backend-api). */
const invitationStatus: StateField = {
  initial: 'pending',
  transitions: [
    {
      operation: 'RevokeOrganizationInvitation', from: ['pending'], to: 'revoked',
      refusal: { status: 404, code: 'organization_invitation_not_pending', message: "The organization invitation is not in the 'pending' status." },
      source: REVOKE,
    },
    // the invitee accepts through the Frontend API: a sign-up or sign-in with the invitation's ticket (../../fapi)
    { actor: 'external', from: ['pending'], to: 'accepted', source: INVITATION },
  ],
};

/** A session's `status` (spec:/components/schemas/Session/properties/status). The Frontend API lane makes a session
 *  active when a sign-up or sign-in completes, and a browser's own moves (ended, removed) are the lane's
 *  (../../fapi/src/semantics/states.ts); these are the Backend API's. Expiry and abandonment are the vendor's clock and
 *  are not made here. */
const sessionStatus: StateField = {
  initial: 'active',
  transitions: [
    {
      operation: 'RevokeSession', from: ['active'], to: 'revoked',
      // https://clerk.com/docs/guides/development/errors/frontend-api: InvalidActionForSession, 400
      // `invalid_action_for_session`, "Unable to <action> session <sessionID>" (the Backend API's errors page lists no
      // refusal of its own for a session that is not active)
      refusal: { status: 400, code: 'invalid_action_for_session', message: 'Unable to revoke session {id}' },
      source: 'spec:RevokeSession "Sets the status of a session as \\"revoked\\", which is an unauthenticated state."',
    },
    // a password changed with `sign_out_of_other_sessions` signs the user out everywhere
    {
      operation: 'UpdateUser', from: ['active'], to: 'revoked',
      source: 'spec:UpdateUser "Set to `true` to sign out the user from all their active sessions once their password is updated."',
    },
  ],
};

/** A sign-in token's `status` (spec:/components/schemas/SignInToken/properties/status: pending, accepted, revoked). It
 *  is revoked by the Backend API ("Revokes a pending sign-in token"), and accepted when the Frontend API signs its user in
 *  with it ("Each token can only be used once": https://clerk.com/docs/guides/development/errors/frontend-api,
 *  SignInTokenAlreadyUsed). */
const signInTokenStatus: StateField = {
  initial: 'pending',
  transitions: [
    {
      operation: 'RevokeSignInToken', from: ['pending'], to: 'revoked',
      // https://clerk.com/docs/guides/development/errors/backend-api: SignInTokenCannotBeRevoked, 400
      refusal: { status: 400, code: 'sign_in_token_cannot_be_revoked_code', message: 'Only pending tokens can be revoked.' },
      source: 'spec:RevokeSignInToken "Revokes a pending sign-in token"',
    },
    // the user signs in with it through the Frontend API (../../fapi: a sign-in's strategy `ticket`)
    { actor: 'external', from: ['pending'], to: 'accepted', source: 'https://clerk.com/docs/guides/development/errors/frontend-api "This sign in token has already been used. Each token can only be used once."' },
  ],
};

export const states: Record<string, { state?: Record<string, StateField>; notState?: string[] }> = {
  // source: spec:/components/schemas/Invitation/properties/status "pending"
  // source: spec:CreateInvitation "By default, the invitation expires after 30 days."
  Invitation: { state: { status: { initial: 'pending', transitions: [
    { actor: 'external', from: ['pending'], to: 'expired', source: 'spec:CreateInvitation "By default, the invitation expires after 30 days."' },
    // Acceptance/revocation are separate flows outside this demand; their endpoints remain gaps.
  ] } } },
  OrganizationInvitation: { state: { status: invitationStatus } },
  Session: { state: { status: sessionStatus } },
  SignInToken: { state: { status: signInTokenStatus } },
  // a role's `is_creator_eligible` is computed from its permissions, not a lifecycle
  Role: { notState: ['is_creator_eligible'] },
  // a user's `locked` is moved by LockUser, UnlockUser and failed sign-in attempts, none of which the twin serves
  User: { notState: ['locked'] },
  // a SAML connection's `active` is its setting (UpdateSAMLConnection's `active`), not a lifecycle the vendor moves
  SAMLConnection: { notState: ['active'] },
  // an enterprise connection's `active` is its setting (UpdateEnterpriseConnection's `active`), not a lifecycle the vendor moves
  EnterpriseConnection: { notState: ['active'] },
};
