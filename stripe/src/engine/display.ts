// What Stripe's pages show of an account, and where its Connect OAuth connections are kept.

// What Stripe's pages show of an account, and where its Connect OAuth connections are kept.

type Row = Record<string, any>;

/** The name an account shows its customers (Checkout, the customer portal): its public business name,
 *  `business_profile.name` ("The customer-facing business name", docs.stripe.com/api/accounts/object), which the
 *  operator sets on the Dashboard ("You can change a Checkout page's name by modifying the Business name field",
 *  docs.stripe.com/payments/checkout/customization/appearance). Where the documentation stops and the twin decides:
 *  with none set it falls back to the Dashboard's account name, `settings.dashboard.display_name` ("used on the Stripe
 *  Dashboard to differentiate between accounts", the same object page), and with neither to "Twin Inc.", the name the
 *  twin has always given the World's own account. */
export const PLATFORM_DEFAULT_NAME = 'Twin Inc.';
export function publicBusinessName(account: Row | undefined): string {
  const named = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  return named(account?.business_profile?.name) ?? named(account?.settings?.dashboard?.display_name) ?? PLATFORM_DEFAULT_NAME;
}
