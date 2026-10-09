# @volter/twin-stripe

A local Stripe: the REST API the unmodified `stripe` SDK calls (`https://api.stripe.com/v1`), the hosted pages an
application sends a person through, and Stripe.js, over one state.

## Use with an existing app

Use Node 22.6 or newer.

In an app that already uses this vendor, install this exact release and the product CLI:

```console
npm install --save-dev --save-exact @volter/world@3.0.147 @volter/twin-stripe@3.0.3
./node_modules/.bin/volter world init --name my-app --twins stripe --source stripe=@volter/twin-stripe
```

Run the local executable from this app’s folder; if it is missing, complete the installation here before continuing.

Review the detected vendor and generated bindings before booting. Read the credential names and limitations below; the World supplies throwaway credentials. Then run your app's own command through the World:

```console
./node_modules/.bin/volter world up
./node_modules/.bin/volter world run -- npm test
./node_modules/.bin/volter world log
./node_modules/.bin/volter world down
```

Here `npm test` is your app's existing command; replace it with your app or test command. `down` retains state.
A later `up` resumes it; do not reset or initialize again merely to return.

Publisher and catalog contribution instructions: [the public publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md).


A Protocol 3 pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)). Its surface is
generated from Stripe's published OpenAPI document (`spec/`). The derived core serves plain reads, writes and deletes.
Handlers are in `src/semantics/<family>.ts`, the state machines in `src/semantics/states.ts`, and Stripe's own
computation (money and declines, billing, the ledger, the API versions) in `src/engine/`.

```bash
world-stripe serve [--port N] [--root DIR] [--read-only]
```

## What it models

What the demand reaches (`journeys/demand.json`: Open Autonomy, Twin, Volter Harness, and the stripe-node applications
Cal.com, Dub, Postiz, Rallly and Twenty, with their frontends' Stripe.js), the life (`journeys/customer-life.json`) and a
vendor-backed World's refresh; each served operation is decided in `journeys/decisions.json`:

- **Customers**: created, updated, searched, listed by email, deleted; their balance transactions and payment methods,
  and their active entitlements (read). Balance-transaction writes answer the gap.
- **Catalog**: products and prices created and listed, prices retrieved, coupons and promotion codes managed. Product search and administrative product/price updates answer the gap.
- **Checkout Sessions** and the customer portal (sessions and configurations): pay, add a card, pay an open invoice,
  cancel at the period's end or at once.
- **Subscriptions**: created by hosted Checkout (including trials), read, updated (items, discounts, a trial
  ended early or added) and canceled, with renewals on the World clock. Direct `POST /v1/subscriptions` is outside
  the declared application demand and returns the gap; use the release operation table to check other subscription
  and schedule endpoints before choosing this twin.
- **Invoices**: invoice items, drafts, finalize, pay (a draft is finalized on the way), void, delete, lines,
  previews and their payments. Invoice lines are read in the invoice; the standalone lines endpoint answers the gap.
- **Intents**: payment and setup intents, confirmed on the server or by Stripe.js with the publishable key and the
  client secret, through the testing page's cards (declines, 3-D Secure) and test bank accounts (ACH debits that settle,
  micro-deposit verification asked), a hold confirmed under manual capture and canceled, a bank transfer that waits for
  funds; payment methods attached and detached; refunds (held for want of balance, with a destination charge's
  transfer reversed and its application fee refunded); the charges, disputes and Radar reviews the testing page's cards
  bring.
- **Apps secret store**; existing Radar value lists and their items (reads and item insertion).
- **Connect**: Express and Custom accounts, account links (Stripe's hosted onboarding) and login links, transfers (from
  a charge's funds too), payouts, the balance and its transactions, application fees and their refunds, and Connect
  OAuth (cal.com's).
- **Issuing** (Open Autonomy's card rail): cardholders and cards (a card is `inactive` unless its create names a status;
  its number and CVC drawn from the World and shown only when expanded), activated, frozen and canceled; authorizations
  asked of the real-time endpoint, approved or declined within the window or decided by Stripe when it ends, and
  received from the vendor and closed by its transactions. Their published fixtures are recorded notReplayed because authorization creation and capture test helpers remain outside demand.
- **Webhook endpoints** made through the API, each with its own signing secret; events listed.

**Keys.** The platform's secret and publishable keys, and its webhook secret, are issued by the credential door and
held by their SHA-256. A request with no key, or with one Stripe never issued, is refused 401. A connected account's
OAuth key acts as that account.

**The gap.** Operations outside application demand and the declared refresh reads answer Stripe's unknown-URL 404
(the manifest's literal `unmodeled` list). This includes administrative catalog updates and deletion, direct
PaymentMethod creation and attachment, send-invoice, balance-credit writes, test clocks and Issuing test helpers,
top-ups, Plans, meter and entitlement-feature setup, Radar-list creation, and separate products such as Terminal,
Treasury, Tax, Climate, Identity and Financial Connections. Reading an already declared resource for vendor-backed
refresh remains served; declaring an unused product does not establish application demand.

**Vendor-backed.** Every stored resource declares its `refresh` (the list that reads it back, under its parent where it
has one); Stripe's webhooks are ingested by their `Stripe-Signature` (`type`, `data.object`); calls are charged against
Stripe's documented limit (25 requests a second in a sandbox).

## Events

Every write Stripe reports sends its event (`payment_intent.succeeded`, `customer.subscription.created`,
`invoice.paid`, …; a charge sends `charge.succeeded` or `charge.failed`, never an invented `charge.created`), declared as data the kernel renders, stores, signs (`Stripe-Signature: t=…,v1=…`, which the
SDK's `constructEvent` verifies) and delivers to the account's enabled webhook endpoints whose `enabled_events` take it
(`*`, `<family>.*` or the type). Each event is rendered in the writing request's API version.

- **Connect**: an event of a connected account (a write made with its `Stripe-Account` header, its own
  `account.updated`, or a row kept on its books, such as the payout time makes for it) carries the top-level `account`
  and reaches only endpoints created with `connect=true`; the platform's reach only the others.
- **Signing secrets in a World**: the credential door issues the application its keys and two signing secrets, its
  account's (`STRIPE_WEBHOOK_SECRET` and the other names an application reads it by) and its Connect endpoint's
  (`STRIPE_CONNECT_WEBHOOK_SECRET`), the same on every boot; an endpoint made on the Webhooks page (a door) is signed
  with the one of its kind. The twin reads no env.

The documented card-brand samples keep their brand and credit/debit/prepaid funding type when saved
through Checkout or the portal. Other raw numbers retain synthetic Visa metadata; the twin does not
look up a real card issuer.

## Screens

Authored pages and content at the declared vendor URLs (`src/screens/`):

- **Checkout** (`checkout.stripe.com/c/pay/{session}`): payment, setup and subscription sessions, including trials.
- **Customer portal** (`billing.stripe.com/p/session/{session}`): cancel or renew a plan, update the card and pay an open invoice.
- **Connect onboarding** (`connect.stripe.com/setup/…`): the Account Link's business, identity, payout and agreement form.
- **Stripe.js** (`js.stripe.com/v3/`, `/v3/stripe.js`, `/<release train>/stripe.js`): `redirectToCheckout({ sessionId })` opens the hosted session. Unsupported members refuse.
- **Checkout client wire** (`api.stripe.com/v1/payment_pages/{session}`): the authored session operations used by Stripe.js CheckoutProvider.
- **Dashboard** (`dashboard.stripe.com/customers`, `/customers/{customer}`, `/settings/public`, `/radar/lists`, `/test/issuing/balance`): inspect SDK-created customers and their stored subscriptions, payments, payment methods, invoices and metadata; set the public business name, create Radar lists and fund test Issuing. The workspace opens Public details; choose Customers in its sidebar to inspect a record. Customer pages are read-only. Search matches name, email, id or description; dates are UTC. Dashboard customer creation/editing, exports, guest-customer grouping and global search are unavailable.

Page actions use the same stored resources as the API. Public screen references and authored choices are in [spec/SOURCE.md](./spec/SOURCE.md).

## Doors

The World's hands where Stripe's API has no act (`src/semantics/doors.ts`), refused on a read-only twin:

- `POST /_twin/app-credentials`: the platform's keys and webhook secret, as the runtime issues them to a World's
  applications.
- `POST /_twin/webhook-endpoints {url, events, connect?}`: an endpoint added on the Dashboard's Webhooks page.
- `POST /_twin/account {settings?, business_profile?, …}`: the platform's own account settings, as the Dashboard
  changes them.
- `POST /_twin/drain`: time's events, sent when a runner drives them (`payout.paid`, `balance.available`).

## Published examples

`journeys/vendor-examples.json` replays Stripe's published examples for the operations the pack serves: the fixtures
beside its spec (`spec/fixtures3.json.gz`), and the requests and rules its documentation pages publish
(`spec/doc-examples.json`: the testing page's cards and test bank accounts, the payment lifecycle's states, and each
reference page's stated rule). Examples whose preconditions require an unserved setup operation are recorded notReplayed naming that operation and its pinned-spec citation. Served preconditions replay through vendor APIs, including customer balance changes and their immutable ledger entries. Coverage remains missing where no application call or published replay reaches it.
