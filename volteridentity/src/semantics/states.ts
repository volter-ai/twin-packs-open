// State moves the served product and device APIs make; the machines are consulted before writing.
import type { ResourceDecl } from '@volter/world-core';
export const states = {
  _refresh_token: { state: { status: { initial: 'active', transitions: [
    { operation: 'post_api_auth_oauth2_token', from: ['active'], to: 'rotated', source: 'recording:provider-refresh-source.txt "revoked: rotatedAt"' },
  ] } } },
  member: { state: { role: { initial: 'member', transitions: [
    { operation: 'productChangeMemberRole', from: '*', to: 'owner', source: 'spec:productChangeMemberRole "A member\'s role changed"' },
    { operation: 'productChangeMemberRole', from: '*', to: 'admin', source: 'spec:productChangeMemberRole "A member\'s role changed"' },
    { operation: 'productChangeMemberRole', from: '*', to: 'member', source: 'spec:productChangeMemberRole "A member\'s role changed"' },
  ] } } },
  invitation: { state: { status: { initial: 'pending', transitions: [
    { operation: 'productCancelInvitation', from: ['pending'], to: 'canceled', source: 'spec:productCancelInvitation "A pending invitation cancelled"' },
  ] } } },
  _device_code: { state: { status: { initial: 'pending', transitions: [
    { operation: 'post_api_auth_device_approve', from: ['pending'], to: 'approved', source: 'spec:/paths/~1api~1auth~1device~1approve/post "Approve device authorization"' },
    { actor: 'external', from: ['pending'], to: 'approved', source: 'spec:/paths/~1api~1auth~1device~1approve/post "Approve device authorization"' },
  ] } } },
} satisfies Record<string, Partial<ResourceDecl>>;
// Device denial is the vendor's move, but no served operation makes it: device deny is unmodeled.
// Invitation acceptance/rejection is the vendor's own organization-plugin flow, outside the served product API.

// notState: _settings.ISSUER is the installation's configured origin, not a lifecycle state.
