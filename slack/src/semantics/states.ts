// Slack's ordinary workspace states, decided in journeys/decisions.json for t_ad153e0a c2.
// Vendor timestamps (a group's date_delete and snooze_endtime) report a time, not an enum state; their projections
// and timed behavior remain in the corresponding group/DND semantics. No Grid or SCIM state is modeled.
import type { StateField } from '@volter/world-core';

const isArchived: StateField = {
  initial: false,
  transitions: [
    // source: https://docs.slack.dev/reference/methods/conversations.archive "Channel has already been archived"
    { operation: 'conversations_archive', from: ['false'], to: 'true', refusal: { status: 200, code: 'already_archived', message: 'already_archived' }, source: 'https://docs.slack.dev/reference/methods/conversations.archive' },
    // source: https://docs.slack.dev/reference/methods/conversations.unarchive "Channel is not archived"
    { operation: 'conversations_unarchive', from: ['true'], to: 'false', refusal: { status: 200, code: 'not_archived', message: 'not_archived' }, source: 'https://docs.slack.dev/reference/methods/conversations.unarchive' },
  ],
};

const deleted: StateField = {
  initial: false,
  transitions: [
    { actor: 'external', from: ['false'], to: 'true', source: 'https://slack.com/help/articles/204475027-Deactivate-a-member-s-account' },
    { actor: 'external', from: ['true'], to: 'false', source: 'https://slack.com/help/articles/360002061747-Reactivate-a-members-account' },
  ],
};

const inviteStatus: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'external', from: ['pending'], to: 'approved', source: 'https://slack.com/help/articles/115004854783-Manage-invitation-requests' },
    { actor: 'external', from: ['pending'], to: 'denied', source: 'https://slack.com/help/articles/115004854783-Manage-invitation-requests' },
  ],
};

// An outgoing Connect invitation's status is the constant 'sent' in its pending list view, not a modeled
// acceptance/approval machine. This pack does not perform receiving-workspace acceptance or approval.
// source: https://docs.slack.dev/reference/methods/conversations.listConnectInvites "status"
// notState: connect_invite.status — a pending-only stored snapshot; expiration removes it from the pending scope.
const externalShared: StateField = {
  initial: false,
  transitions: [
    // source: https://docs.slack.dev/reference/methods/conversations.inviteShared "it becomes a Connect channel"
    { operation: 'conversations_inviteShared', from: ['false', 'true'], to: 'true', source: 'https://docs.slack.dev/reference/methods/conversations.inviteShared' },
  ],
};

export const states = {
  team: {},
  user: { state: { deleted } },
  channel: { state: { is_archived: isArchived, is_ext_shared: externalShared } },
  usergroup: {},
  invite_request: { state: { status: inviteStatus } },
};
