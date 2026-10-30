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
| subscriptions | listed and read by id |
| orders | read by id and listed (by checkout, customer, product, subscription, status), each paid order told by `order.created` and `order.paid` |
| webhooks | checkout creation and order events declared for raw endpoints registered and listed through the API (`/v1/webhooks/endpoints`); World renders, signs and transports them |

Portal email sign-in, cancellation, invoice downloads and payment-method changes are outside this scope. Calendar-month subscription renewals and trial conversion run on the World clock; payments use deterministic test confirmation tokens and succeed. Fixed/custom paid checkouts require the client confirmation token; trial orders are deferred. Production and sandbox credentials and records are independent. Checkouts expire after 24 hours.

Every other operation of Polar's API is the gap (`src/manifest.ts` `unmodeled`, and the operations no handler serves).

Confirmation claims the checkout's `open` to `confirmed` transition through the kernel's atomic `ctx.change` before
creating customer or payment effects. Concurrent confirmations of the same checkout cannot both create an order.
An interruption after that claim remains unresolved; no complete multi-resource recovery is implied.

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
