// File, file link, Identity and billing-portal semantics. A file is the uploaded document's object
// (the twin keeps no bytes); a file link is answered, not kept. An Identity verification session is
// created here and verified through the twin's own helper outside Stripe's surface; its reports
// are the derived core's to list and read, as are file list and retrieve, session retrieve and
// portal-configuration retrieve.
import type { Row } from './common.ts';
export const PBC = 'billing_portal.configuration';

/** A portal configuration's features, each filled where the request leaves it: every feature is answered (the served
 *  spec requires all five), as the create page's example answers a request that sets only customer_update and
 *  invoice_history: payment_method_update disabled, subscription_cancel disabled at_period_end with proration_behavior
 *  none and its five default reasons, subscription_update disabled with no allowed updates and proration_behavior none
 *  (docs.stripe.com/api/customer_portal/configurations/create); trial_update_behavior "Defaults to a value of
 *  `end_trial` if you don't set it during creation" (the served spec). Where the documentation stops and the twin
 *  decides: a feature the request leaves out is disabled, and schedule_at_period_end has no conditions. */
export const PORTAL_FEATURES: Row = {
  customer_update: { allowed_updates: [], enabled: false },
  invoice_history: { enabled: false },
  payment_method_update: { enabled: false, payment_method_configuration: null },
  subscription_cancel: { cancellation_reason: { enabled: false, options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] }, enabled: false, mode: 'at_period_end', proration_behavior: 'none' },
  subscription_update: { default_allowed_updates: [], enabled: false, proration_behavior: 'none', schedule_at_period_end: { conditions: [] }, trial_update_behavior: 'end_trial' },
};
export const filled = (base: unknown, given: unknown): unknown => {
  if (!given || typeof given !== 'object' || Array.isArray(given) || !base || typeof base !== 'object' || Array.isArray(base)) return given === undefined ? base : given;
  const out: Row = { ...(base as Row) };
  for (const [k, v] of Object.entries(given as Row)) out[k] = filled((base as Row)[k], v);
  return out;
};
