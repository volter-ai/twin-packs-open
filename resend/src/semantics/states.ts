// Resend's state machines (docs/contributing/architecture.md, "What an author writes": states), each move cited; the
// manifest takes each resource's whole.
import type { StateField, Transition } from '@volter/world-core';

const vendor = (from: string[], to: string, source: string): Transition => ({ actor: 'vendor', from, to, source });
const external = (from: string[], to: string, source: string): Transition => ({ actor: 'external', from, to, source });

/** An email's `last_event`: Resend takes it (`queued`) and sends it (`sent`); the recipient's server takes it
 *  (`delivered`), refuses it (`bounced`) or answers only for now (`delivery_delayed`, not final; the twin retries nothing),
 *  the email moving once from all its recipients' replies (./clock.ts); a recipient opens it (`opened`, on a domain with open tracking) or marks it
 *  as spam (`complained`). Where the twin stops: it rewrites no link for click tracking and no door follows one (Dub
 *  turns click tracking off; no application here turns it on), so it declares no `clicked` move. */
// source: spec:/components/schemas/Email/properties/last_event "The status of the email."
const EVENTS = 'spec:/components/schemas/Email/properties/last_event "The status of the email."';
const lastEvent: StateField = {
  initial: 'queued',
  transitions: [
    vendor(['queued'], 'sent', EVENTS),
    vendor(['queued'], 'scheduled', 'spec:/components/schemas/SendEmailRequest/properties/scheduled_at "Schedule email to be sent later."'),
    { actor: 'time', from: ['scheduled'], to: 'queued', source: 'spec:/components/schemas/SendEmailRequest/properties/scheduled_at "Schedule email to be sent later."' },
    vendor(['sent'], 'delivered', EVENTS),
    vendor(['sent'], 'bounced', EVENTS),
    vendor(['sent'], 'delivery_delayed', EVENTS),
    external(['delivered'], 'opened', EVENTS),
    external(['delivered', 'opened'], 'complained', EVENTS),
  ],
};

/** A domain's `status`: `not_started` when added; verifying marks it `pending` and Resend checks its records at the
 *  owner's DNS host, finding them (`verified`) or, after 72 hours without them, not (`failed`); a failed domain may be
 *  verified again. */
// source: https://resend.com/docs/dashboard/domains/manage-domains "Resend was unable to detect the DNS records within 72 hours."
const DOMAINS = 'https://resend.com/docs/dashboard/domains/manage-domains';
const domainStatus: StateField = {
  initial: 'not_started',
  transitions: [
    { operation: 'domains/verify', from: ['not_started', 'failed', 'pending'], to: 'pending', source: 'https://resend.com/docs/api-reference/domains/verify-domain' },
    { actor: 'time', from: ['pending'], to: 'verified', source: DOMAINS },
    { actor: 'time', from: ['pending'], to: 'failed', source: DOMAINS },
  ],
};

/** An API key: made on the API Keys page, active until it is deleted there. */
const keyStatus: StateField = {
  initial: 'active',
  transitions: [external(['active'], 'deleted', 'https://resend.com/docs/dashboard/api-keys/introduction')],
};

export const states = {
  email: { state: { last_event: lastEvent } },
  domain: { state: { status: domainStatus } },
  _api_key: { state: { status: keyStatus } },
};
