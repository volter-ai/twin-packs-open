// Stripe's billing_portal operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { filled, PBC, PORTAL_FEATURES } from '../engine/files.ts';
import { asBool, nowUnix } from '../engine/stripe.ts';
import { actingAccount, created, fail, list, newest, where } from './shared.ts';
export async function GetBillingPortalConfigurations(ctx: HandlerContext): Promise<Response> {
  return list(ctx, PBC, where(ctx, newest(ctx, PBC), {
    active: (c, v) => asBool(c.active) === asBool(v),
    is_default: (c, v) => asBool(c.is_default) === asBool(v),
  }));
}

export async function PostBillingPortalConfigurations(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(
    await created(ctx, PBC, { ...ctx.params, business_profile: filled({ headline: null, privacy_policy_url: null, terms_of_service_url: null }, ctx.params.business_profile), features: filled(PORTAL_FEATURES, ctx.params.features) }, {
      active: true, is_default: false, livemode: false,
      login_page: { enabled: false, url: null },
      metadata: {}, default_return_url: ctx.params.default_return_url ?? null,
      updated: nowUnix(ctx.occurredAt),
    }),
  );
}


// ── the customer portal ──

// the configuration defaults to the account's default one
export async function PostBillingPortalSessions(ctx: HandlerContext): Promise<Response> {
  const customer = typeof ctx.params.customer === 'string' ? ctx.params.customer : '';
  if (!customer) return fail(ctx, 'Missing required param: customer.', 400, 'parameter_missing');
  if (!ctx.row('customer', customer, { withDeleted: true })) return fail(ctx, `No such customer: '${customer}'`, 404, 'resource_missing');
  const configuration = typeof ctx.params.configuration === 'string' && ctx.params.configuration
    ? ctx.params.configuration
    : (ctx.rowsRaw('billing_portal.configuration', { withDeleted: true }).find((c) => c.is_default)?.id ?? 'bpc_twin_default');
  const id = ctx.mint('billing_portal.session');
  return ctx.reply(
    await created(ctx, 'billing_portal.session', {
      id, customer, configuration, return_url: ctx.params.return_url ?? null, url: `https://billing.stripe.com/p/session/${id}`,
      locale: ctx.params.locale ?? null, on_behalf_of: ctx.params.on_behalf_of ?? null, livemode: false,
      // the account the session was made on (Stripe-Account), whose name the portal shows (screens/billing-portal.tsx)
      ...(actingAccount(ctx) ? { _brand_account: actingAccount(ctx) } : {}),
    }, {}),
  );
}
