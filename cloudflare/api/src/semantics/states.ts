// Cloudflare API v4's state machines (docs/contributing/architecture.md, "What an author writes": states), each move
// cited, and its rulings of what is not state; the manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

/** A zone's `status`: pending until Cloudflare sees the domain's nameservers are its own, then active ("Your domain
 *  will be pending until … the nameserver change is detected", https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/).
 *  Every zone is added through the API (`zones-post`); no door makes one active. */
const zoneStatus: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'vendor', from: ['pending'], to: 'active', source: 'https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/' },
  ],
};

/** A custom hostname's `status`: pending until its ownership is verified (the TXT record or HTTP token its customer
 *  publishes), then active ("Once the ownership verification is complete, the status … changes to Active",
 *  https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/). */
const hostnameStatus: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'vendor', from: ['pending'], to: 'active', source: 'https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/' },
  ],
};

/** A custom hostname's certificate, `ssl.status`: pending validation until its validation records are published, then
 *  active; a new validation method issues new records, pending again (the edit's "used to indicate that hostname should
 *  pass domain control validation"). */
const sslStatus: StateField = {
  initial: 'pending_validation',
  transitions: [
    { actor: 'vendor', from: ['pending_validation'], to: 'active', source: 'https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/' },
    { operation: 'custom-hostname-for-a-zone-edit-custom-hostname', from: ['pending_validation', 'active'], to: 'pending_validation', source: 'spec:custom-hostname-for-a-zone-edit-custom-hostname "should pass domain control validation"' },
  ],
};

/** An API token's `status`: active, or disabled by its update (user-api-tokens-update-token and the account's own).
 *  Neither update is served (both are the manifest's unmodeled: no demand, life or example disables a token), so no
 *  step can ask for either move, and the machine holds none: a token is active until it expires or is deleted. */
const tokenStatus: StateField = {
  initial: 'active',
  transitions: [],
};

/** A membership's `status`: the account's maker is its accepted Super Administrator from the start (the dashboard's
 *  sign-up, the World's door). An invited person's acceptance or rejection is the membership's update ("Accept or
 *  reject this account invitation"), which is not served (the manifest's unmodeled: no demand, life or example invites
 *  anyone), so the machine holds neither move. */
const memberStatus: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'external', from: ['pending'], to: 'accepted', source: 'https://developers.cloudflare.com/fundamentals/account/create-account/' },
  ],
};

// The API lane owns the shared custom-domain machine and its refresh; the S3 lane clock observes external DNS through this context.
// source: https://developers.cloudflare.com/r2/buckets/public-buckets/ "Active"
// The clock handler observes the stored external proof before making these vendor transitions; elapsed time alone is insufficient.
const ownership: StateField = { initial: 'pending', transitions: [
  { actor: 'vendor', from: ['pending'], to: 'active', source: 'https://developers.cloudflare.com/r2/buckets/public-buckets/' },
] };
const ssl: StateField = { initial: 'initializing', transitions: [
  { actor: 'vendor', from: ['initializing', 'pending'], to: 'active', source: 'https://developers.cloudflare.com/r2/buckets/public-buckets/' },
] };
const domainState = { state: { 'status.ownership': ownership, 'status.ssl': ssl }, notState: ['enabled', 'minTLS'] };

export const states = {
  CustomDomain: domainState,
  iam_account: { notState: ['type'] },
  zones_zone: { state: { status: zoneStatus }, notState: ['type'] },
  'tls-certificates-and-hostnames_custom-hostname': { state: { status: hostnameStatus, 'ssl.status': sslStatus } },
  iam_token_base: { state: { status: tokenStatus } },
  // the same stored tokens under the name the dashboard's token pages mint them by
  ApiToken: { state: { status: tokenStatus } },
  'iam_membership-with-policies': { state: { status: memberStatus } },
  // a widget's settings, each the operator's choice, none a lifecycle (its region fixed at creation, its provenance recorded)
  turnstile_widget_detail: { notState: ['clearance_level', 'deployed_via', 'last_modified_via', 'mode', 'region'] },
  turnstile_widget_list: { notState: ['clearance_level', 'deployed_via', 'last_modified_via', 'mode', 'region'] },
  // a Notifications destination's type is read off its URL at creation, and a policy's alert type is the operator's choice
  aaa_webhooks: { notState: ['type'] },
  aaa_policies: { notState: ['alert_type'] },
};

// notState: worker_script.schedules is a replacement collection of Cron Trigger configuration, not a lifecycle state.
