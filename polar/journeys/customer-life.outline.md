# polar customer life: outline

## The customer

**Volter** takes its money in through one Polar organization (../journeys/demand.json).
**Volter World's platform** bills through its biller (twin-world `apps/billing` at `96ca4478bb39`, `@polar-sh/sdk`): at
boot it finds or makes its meters and its Team plan by name; an org upgrades on Polar's hosted checkout, its org id the
customer's external id; the biller reads an org's plan and usage from Polar's customer state by that id, reports usage
as events each carrying its own id so a retry never counts twice, and opens the customer portal for Manage billing.
**Open Autonomy** takes patronage (open-autonomy `apps/platform/src/polar.ts` at `0841076bed91`, REST over fetch): it
makes each project tier's monthly and one-time products, sends a patron to Polar's checkout, and learns of a paid order
twice, from the signed `order.paid` webhook and from its thanks page, which reads the checkout, its orders and the
order's customer back.

**Relay** (`volter-ai/game-store` at `b2d9869d9a794d7dbd4a9be222dd7fd08ab6a634`, REST over fetch) is an
owner-directed source adoption. Its seed uses the existing application credential door and endpoint API; its offline
checkout reads the original checkout and confirms through the returned client secret with a synthetic token. Its
signed order callback reads the order afresh before fulfilling a store receipt. Recurring source also reads a product
by id; that store route is not mounted. Native refunds, recurring cancellation and durable webhook recovery remain
outside the implemented acts. No Relay runtime or journey execution is recorded by this outline extension.

The World clock starts 2026-01-01. This organization, its credentials and records are in production; buyers receive only checkout URLs or their own session tokens.

## People and programs

| who | holds | how |
|---|---|---|
| Lena Ortiz, Volter's operator | authority over this organization's token and webhook settings | makes the platform's Organization Access Token (door), registers Open Autonomy's webhook endpoint (API) |
| the platform's biller | the organization's OAT, granted read/write scope over its meters, products, checkouts, customers, customer sessions and events | @polar-sh/sdk |
| Open Autonomy's platform | the organization's OAT, granted products/checkouts write, orders/customers read and webhook settings scope; endpoint secret for verification | fetch |
| Ada (Acme Robotics, Acme Labs), Globex's admin | their own org's billing page; authorization over only their checkout and customer session | the biller's checkout and Manage billing |
| Grace, Heidi | their card on Polar's page; authorization over only their checkout | Polar's hosted checkout, from Open Autonomy's give button |

## The arc

### 1. Setting up (Mon 5 Jan)
Lena makes the platform's token. The biller boots: it lists the meters (`meters:list`), finds none and makes `world_hours` (the sum of
each `world.hour` event's units) and `worlds_provisioned` (a count) (`meters:create`); it lists the products
(`products:list`), finds none and makes the Team plan (`products:create`): $49 a month, 2 cents a world-hour beyond
the plan on the hours meter, a 14-day trial. At its next boot it finds both by name.

### 2. An org upgrades (Tue 6 Jan)
The biller reads Acme's billing by its org id (`customers:get_state_external`): Polar has no such customer (404), so
Acme is on Free. Ada chooses Team: the biller opens a checkout with Acme's org id as the customer's external id
(`checkouts:create`); Ada opens its url, Polar's checkout page (`checkouts:client_get`), and supplies payment details
(`checkouts:client_confirm`), back to the billing page. The trial starts without an immediate charge. Acme's state now holds the Team subscription, trialing.

### 3. Usage (Wed 14 Jan)
Acme creates a World and the biller reports it. Two hours later the biller reports the completed world-hours (`events:ingest`); a retried tick sends the last hour again and
Polar counts it a duplicate. Acme's state shows two world-hours consumed.

### 4. Manage billing (Mon 2 Feb)
Ada opens Manage billing: the biller makes a customer session for Acme by its org id (`customer-sessions:create`), and
she follows its returned portal URL and sees her subscription, now active after its trial ended, and purchase history. Polar charged her when the trial ended on 20 January; calendar-month renewals create subsequent paid orders. Next day Globex, on Free, is refused a session the same way; support asks Lena to create Globex its customer by its org id; then the biller can create its session. The biller's isNotFound check accepts status 404 or an error message containing not found or 404. Polar documents this validation as 422; whether its fallback runs depends on the actual error message. This session error does not match, so support intervenes.

### 5. Patronage (Tue 10 to Thu 12 Feb)
Lena registers Open Autonomy's webhook endpoint when patronage launches, for order.created and order.paid; future events of the whole organization reach it, including billing orders it cannot settle without patronage metadata. Open Autonomy makes acme/rover's first tier, monthly and once (`products:create`). Grace gives once: Open Autonomy
opens her checkout (`checkouts:create`), back to its thanks page with `{CHECKOUT_ID}`; she leaves the tab for 25 hours while talking to the maintainer, tries to pay after expiry (410), returns to the application for a fresh checkout, pays and
returns on Wednesday 11 February with the checkout's id. Polar tells Open Autonomy the order was made and is paid (`order.created`,
`order.paid`, signed with the endpoint's secret). The thanks page reads the checkout back (`checkouts:get`), its orders
(`orders:list`) and the order's customer (`customers:get`). Next day, Thursday 12 February, Heidi gives monthly: her paid order is the first of a subscription.

### 6. A leaked token (Thu 16 Apr)
The platform's token is revoked on the settings page; the old one is refused and a new one works.

### 7. A vendor-backed refresh reads the organization back
With the new token, a World rooted at this organization reads back what the manifest refreshes: the webhook endpoints
(`webhooks:list_webhook_endpoints`, its secret), the checkouts newest first (`checkouts:list`: Heidi's succeeded), the
subscriptions the latest started first (`subscriptions:list`: Heidi's active, Acme's Team), the customers newest first
(`customers:list`) and the usage events (`events:list`: Acme's World and two hours, the
retried hour not a third).

### 8. Relay's source adoption

World issues Relay its application token. Relay lists and, if absent, registers its exact raw endpoint with the native
API, retaining the returned UTF-8 signing secret. It finds or creates a game product, creates the original checkout
with the Volter ID as external customer id and a Relay checkout id as metadata, then reads it back before using its
client-secret confirmation route. The native hosted URL remains a vendor URL and is never fetched in local mode.
The client uses only a synthetic confirmation token, never payment details. Confirmation claims this checkout once;
a second concurrent confirmation refuses before creating payment effects. After a signed order event, Relay reads
that order by id, verifies the original checkout/customer/amount binding, and applies its own receipt authority.
Product/subscription-by-id reads support the separate, unmounted recurring source. Orders and subscriptions lack a
vendor organization_id field; their read handlers resolve the environment through the existing shared row helper,
rather than applying a generic organization-field filter or adding a fabricated vendor field.
Executable journey additions are deferred by
the owner's construction rule; this act records the source contract only.

## What the life does not do
The meters' and webhook endpoints' reads by id and changes, checkouts' update, the
subscriptions' changes, benefits, discounts, refunds, checkout links, the customer portal's email sign-in, settings, cancellation, invoices and payment-method changes, and its API, and every
other operation no application of the demand calls.
