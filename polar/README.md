# @volter/twin-polar

The Polar twin (Protocol 3): Polar's API (`api.polar.sh`) derived from its own OpenAPI document (`spec/`, provenance
in `spec/SOURCE.md`), scoped to what the applications that bill through Polar call
([journeys/demand.json](./journeys/demand.json)): Volter's platform biller (twin-world `apps/billing`), Open Autonomy's patronage and Relay's offline store integration.

| area | served |
|---|---|
| catalog | meters (listed, made) and products (listed, made, read by id) |
| checkout | checkouts made, listed and read back by id, and Polar's hosted checkout page (`buy.polar.sh/<client secret>`), which reads and confirms it (making the order and, for a recurring product, the subscription) |
| customers | made, listed, read by id, their state (active subscriptions, meter usage) by external id, and a customer session and its pre-authenticated portal overview (subscriptions and purchase history) |
| usage | events ingested and listed |
| subscriptions | listed and read by id; period-end cancellation set or undone with `cancel_at_period_end` |
| orders | read by id and listed (by checkout, customer, product, subscription, status), each paid order told by `order.created` and `order.paid` |
| refunds | created for tax-free paid orders, with an atomic check and update of that order's remaining refundable balance |
| webhooks | `checkout.created`, `order.created`, `order.paid` and `order.refunded` declared for raw endpoints registered and listed through the API (`/v1/webhooks/endpoints`); World renders, signs and transports them |

## Scope and limitations

Portal email sign-in, cancellation, invoice downloads and payment-method changes are outside this scope. Calendar-month subscription renewals and trial conversion run on the World clock; payments use deterministic test confirmation tokens and succeed. Fixed/custom paid checkouts require the client confirmation token; trial orders are deferred. Production and sandbox credentials and records are independent. Checkouts expire after 24 hours.

- **Refunds:** refund listing and refund lifecycle webhooks (`refund.created`, `refund.updated`) are unsupported.
  Updating the order's balance and creating the refund record are separate writes, without atomic recovery across
  both. Tax splitting and customer credit-balance handling are not modeled; order and refund tax amounts are zero.
- **Subscriptions:** immediate revocation and update forms other than `cancel_at_period_end` are unsupported,
  as are outgoing subscription lifecycle webhooks. Clock renewal and trial conversion update the subscription
  before creating its order; there is no atomic subscription-and-payment transaction, concurrent renewal guarantee
  or recovery from an interruption between those writes. Incoming subscription webhooks refresh state; they do not
  establish outgoing lifecycle delivery.
- **Webhook endpoints:** registration and listing are supported; get, update, delete and secret reset are unsupported.
- **Usage-event retention:** 90-day retention and expiry are not modeled. Events remain stored; listing can filter
  their timestamps, and customer meter balances aggregate all stored matching events.
- **Checkout recovery:** confirmation claims the checkout's `open` to `confirmed` transition through the kernel's
  atomic `ctx.change` before creating customer or payment effects. Concurrent confirmations of the same checkout
  cannot both create an order. An interruption after that claim remains unresolved; there is no complete
  multi-resource recovery.
- **Products and pricing:** billing scope is single-product, single-price workflows in one currency. Checkout
  selection uses the first product and its first price; product switching, currency selection or conversion, and
  general multi-price billing are unsupported. Product creation checks that the name is nonempty, but does not
  enforce Polar's name length of 3–64 Unicode characters, its allowed presentment currencies or fixed-price amount
  validation.

Every other operation of Polar's API is the gap (`src/manifest.ts` `unmodeled`, and the operations no handler serves).

The pinned `2026-04` webhook contract signs with the entire endpoint secret's UTF-8 bytes. Slack and Discord endpoint
formats are not raw Polar events and are not sent through this declaration. Durable delivery outcomes, retries and
redelivery belong to World's shared event mechanism; the pack does not supply a second sender. The generated
[standing](../STANDING.md) owns qualification facts.

## Credentials

An organization's operations take an Organization Access Token the World issued (held by its SHA-256); a customer
portal operation takes a live customer session's token; the checkout's client operations take the checkout's client
secret in their path (each operation's security schemes, from the spec's security as the derive keeps them). The World's application is issued its token when
the World boots (`POST /_twin/app-credentials`, the descriptor's credential door), the same at every boot.

## Doors

- `POST /_twin/access-tokens {comment, expires_in_days?}` and `DELETE /_twin/access-tokens/{n}`: tokens (including their returned id) made and revoked
  on the settings page.
- `POST /_twin/app-credentials`: the application's token.
- `GET /_twin/deliveries?to=&type=`: every webhook sent, as the receiving server got it.
