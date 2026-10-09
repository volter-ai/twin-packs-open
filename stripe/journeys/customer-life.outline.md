# Kestrel Labs bills customers and pays partners with Stripe

Author: Contributor 88

Twenty’s workflow HTTP action creates a customer invoice with its user-supplied Stripe key. Postiz’s custom Checkout delegates loadActions, PaymentElement, promotion changes and confirmation to Stripe.js, and reads the stored subscription back. Kestrel runs the shipped Dub, Rallly and Postiz billing paths, the Twin sample shop, the Harness billing dashboard and Open Autonomy’s card rail. Its operators set up catalog prices, public details, Radar lists and sandbox funding through Stripe’s API or hosted controls. Subscribers pay in Checkout, change plans, try and end trials, settle overdue invoices, and cancel through the portal. Company and individual partners complete onboarding and receive commissions.

The December agent-card create follows Open Autonomy rails.ts:40 without a status, so Stripe’s inactive default declines the first unattended purchase. A treasurer then activates a replacement, pauses it during a credential check, and exercises the domain purchase’s approval, decline and partial capture flows. The application replies use rails.ts:109’s approved boolean. Delayed replies leave pending requests for the API decision inside the real-time window.

Later billing work uses the documented options of those served operations: negotiated and tiered prices, fixed and percentage discounts, trial changes, customer invoice defaults, payment methods, and history pagination. The story shows configuration errors where a catalog upload, issuer-policy import, stale account, method name or credential needs correction; no stored mutation is supplied by a scenario handler. Install-only and disabled feature paths are recorded in demand.optional.

## Acts in order


### Monday 5 January, 09:00: Kestrel Labs sets up Stripe

Elapsed: 6300m.

- The World: the platform's keys, as the Dashboard's API keys page shows them — POST /_twin/app-credentials. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- The World operator retains the platform balance for monthly partner commissions (Dashboard manual payouts) — POST /_twin/account. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Femke sets the business name on Public details — POST https://dashboard.stripe.com/settings/public. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Femke follows Save and sees Kestrel’s public business name — GET https://dashboard.stripe.com/settings/public?saved=1. Stripe: https://docs.stripe.com/payments/checkout/customization/appearance
- The World: Tallyforge's webhook endpoint, added on the Dashboard's Webhooks page — POST /_twin/webhook-endpoints. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- The product Tallyforge — POST /v1/products. Twin: apps/platform/src/sample.ts:44; Stripe operator catalog setup, spec:PostProducts
- Femke seeds the monthly price and Dub lookup key through Stripe’s Prices API — POST /v1/prices. Stripe operator: https://docs.stripe.com/products-prices/manage-prices#lookup-keys (create a price with lookup_key); spec:PostPrices
- Femke adds the upgraded monthly plan at $98 — POST /v1/prices. Stripe operator: https://docs.stripe.com/products-prices/manage-prices#lookup-keys (create a price with lookup_key); spec:PostPrices
- and yearly, $490 — POST /v1/prices. Twin: apps/platform/src/sample.ts:45; Stripe operator catalog setup, spec:PostPrices
- The Add-on seats product — POST /v1/products. Twin: apps/platform/src/sample.ts:44; Stripe operator catalog setup, spec:PostProducts
- its per-seat price, $8 a month — POST /v1/prices. Twin: apps/platform/src/sample.ts:45; Stripe operator catalog setup, spec:PostPrices
- Tallyforge lists its prices — GET /v1/prices?lookup_keys[]=pro_monthly. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/upgrade/route.ts:37
- Tallyforge reads its monthly price by id — GET /v1/prices/{monthly}. Rallly: apps/web/src/features/billing/mutations.ts:58

### Tuesday 6 January: the first subscriber

Elapsed: 1440m.

- Dub’s upgrade page loads its pinned Stripe.js release train — GET https://js.stripe.com/basil/stripe.js. Dub: apps/web/package.json:49, pnpm-lock.yaml @stripe/stripe-js@7.3.1; pinned SDK dist/index.mjs loadScript
- Ravel Agency starts Checkout for the monthly plan — POST /v1/checkout/sessions. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/upgrade/route.ts:141; apps/web/lib/stripe/index.ts:5
- Stripe's payment page shows the business name — GET {cs1_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Ravel pays with a card — POST {cs1_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Tallyforge reads the completed session and its subscription — GET /v1/checkout/sessions/{cs1}. Rallly: apps/web/src/app/api/stripe/portal/route.ts:34; spec:GetCheckoutSessionsSession
- and the session's line items — GET /v1/checkout/sessions/{cs1}/line_items?expand[]=data.price.product&limit=10. Dub: apps/web/app/(ee)/api/stripe/integration/webhook/utils/get-checkout-session-products.ts:47

### two hours later

Elapsed: 120m.

- Nordlicht Studio starts Checkout — POST /v1/checkout/sessions. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/upgrade/route.ts:141; apps/web/lib/stripe/index.ts:5
- Nordlicht's first card is declined — POST {cs2_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- its second card works — POST {cs2_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Tallyforge reads the session — GET /v1/checkout/sessions/{cs2}. Rallly: apps/web/src/app/api/stripe/portal/route.ts:34; spec:GetCheckoutSessionsSession
- Tallyforge finds Ravel by email — GET /v1/customers/search?query=email~%22billing%40ravel.test%22&limit=100&expand[]=data.subscriptions. Dub: apps/web/app/(ee)/api/customers/search-stripe/route.ts:53
- and lists customers — GET /v1/customers?email=billing%40ravel.test&limit=1. Twin: apps/platform/src/sample.ts:40
- and Ravel's subscriptions — GET /v1/subscriptions?customer={ravel}&status=all. Volter Harness: container/retake/stack/app/src/app.py:115 (status=all)
- The operations dashboard counts every subscription, canceled ones too — GET /v1/subscriptions?limit=100&status=all. Volter Harness: container/retake/stack/app/src/app.py:115
- and every customer — GET /v1/customers?limit=100. Volter Harness: container/retake/stack/app/src/app.py:116
- The sample shop's seeder looks its first customer up by email before seeding — GET /v1/customers?email=billing%40ravel.test. Twin: apps/platform/src/sample.ts:40
- Dub reads Ravel’s billing customer — GET /v1/customers/{ravel}. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/payment-methods/route.ts:66
- Femke opens Customers to inspect the SDK-created billing customer — GET https://dashboard.stripe.com/customers?q=billing%40ravel.test. World first-use customer inspection; Stripe: https://support.stripe.com/questions/export-customer-data-without-the-payment-details
- Femke opens Ravel's profile and sees the stored subscriptions and billing details — GET https://dashboard.stripe.com/customers/{ravel}. World first-use customer inspection; Stripe: https://support.stripe.com/questions/updates-to-the-customer-detail-page
- A missing customer profile is not an invented customer — GET https://dashboard.stripe.com/customers/cus_missing. The profile reads the existing customer view only.
- Twenty’s app health check reads its Stripe account with the user-supplied key — GET /v1/account. Twenty: packages/twenty-docs/developers/extend/apps/logic/logic-functions.mdx:850 (GET, Authorization only)
- Twenty’s invoice workflow creates the quote invoice for Ravel — POST /v1/invoices. Twenty: packages/twenty-docs/user-guide/workflows/how-tos/connect-to-other-tools/generate-quote-or-invoice-from-twenty.mdx:101; packages/twenty-server/src/modules/workflow/workflow-executor/workflow-actions/http-request/http-request.workflow-action.ts:28
- The invoice workflow reads the saved draft — GET /v1/invoices/{workflow_invoice}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- An uninstalled payment app’s setup request receives Stripe’s unknown-URL answer — POST /v1/setup_intents. Stripe: https://github.com/stripe/stripe-mock/issues/31; Cal payment app requires an app-store install (demand.optional)

### Monday 2 February: launch pricing

Elapsed: 38760m.

- Femke makes a coupon: 20% off for three months — POST /v1/coupons. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:136
- and reads it — GET /v1/coupons/{coupon}. Dub: apps/web/lib/rewardful/import-campaigns.ts:184; apps/web/lib/discounts/discount-provider-stripe.ts:87
- and its promotion code LAUNCH20 — POST /v1/promotion_codes. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:184; apps/web/lib/stripe/index.ts:23
- Tallyforge finds the code by its text — GET /v1/promotion_codes?code=LAUNCH20&limit=1. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:275
- and reads the code it names — GET /v1/promotion_codes/{promo}. Dub: apps/web/app/(ee)/api/stripe/integration/webhook/utils/get-promotion-code.ts:18
- Veldkamp starts Checkout with the code — POST /v1/checkout/sessions. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/upgrade/route.ts:141; apps/web/lib/stripe/index.ts:5
- and pays — POST {cs4_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- The session's discount — GET /v1/checkout/sessions/{cs4}. Rallly: apps/web/src/app/api/stripe/portal/route.ts:34; spec:GetCheckoutSessionsSession
- Postiz’s subscription screen loads its pinned Stripe.js script — GET https://js.stripe.com/clover/stripe.js. Postiz package.json @stripe/stripe-js ^8.6.0; CheckoutProvider delegates initCheckout/loadActions
- Postiz starts its default web billing with a seven-day custom Checkout trial — POST /v1/checkout/sessions. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- CheckoutProvider loads actions and the subscription summary — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/init. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The subscriber’s mistyped promotion receives its refusal — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/apply_promotion_code. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The subscriber applies Postiz’s campaign promotion — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/apply_promotion_code. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The subscriber removes the campaign promotion — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/remove_promotion_code. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The PaymentElement refuses an incomplete card — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/confirm. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The subscriber confirms through CheckoutProvider’s PaymentElement — POST https://api.stripe.com/v1/payment_pages/{postiz_cs}/confirm. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- Postiz reads the completed session and resulting trial subscription — GET /v1/checkout/sessions/{postiz_cs}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- Postiz previews the next subscription invoice — POST /v1/invoices/create_preview. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:1126-1129 (customer, subscription)
- Postiz reads the trial’s current line before showing a plan-change quote — GET /v1/subscriptions/{postiz_sub}. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- Postiz reads the active subscription item for the plan-change quote — GET /v1/subscriptions/{veld_sub}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:950 (retrieve(id))
- Postiz quotes a plan change while the current subscription discount applies — POST /v1/invoices/create_preview. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:343-355; Stripe: https://docs.stripe.com/billing/subscriptions/prorations
- Postiz removes the applied subscription discount before the next billing period — DELETE /v1/subscriptions/{veld_sub}/discount. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:1230 (deleteDiscount(id), no parameters)
- Postiz reads the active subscription item for the plan-change quote — GET /v1/subscriptions/{veld_sub}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:950 (retrieve(id))
- Postiz quotes its plan change at the current time without supplying proration_date — POST /v1/invoices/create_preview. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:343-355; Stripe: https://docs.stripe.com/billing/subscriptions/prorations
- The documented quote option create_prorations previews the next invoice — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview?query=subscription_details
- The documented quote option none previews the next invoice — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview?query=subscription_details
- An unchanged plan creates no proration even with always_invoice — POST /v1/invoices/create_preview. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:343-355; Stripe: https://docs.stripe.com/billing/subscriptions/prorations
- The documented preview credits unused time when removing a paid subscription item — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details
- The documented preview charges remaining time when adding a subscription item — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details
- At the billing boundary there is no unused time to prorate — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details
- The preview refuses a proration time outside the current billing period — POST /v1/invoices/create_preview. Stripe: https://docs.stripe.com/api/invoices/create_preview.md?query=subscription_details
- The quoted subscription still has one monthly unit — GET /v1/subscriptions/{veld_sub}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:343-355; Stripe preview leaves the subscription unchanged
- The quote removes its existing monthly line — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The quote finds the customer’s first current subscription when its id is omitted — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- A stale subscription id is refused in the quote — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The admin recovers the current subscription from its saved Checkout session — GET /v1/checkout/sessions/{postiz_cs}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:261,950; Stripe catalog and saved Checkout recovery
- A stale subscription line is refused in a plan-change quote — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- A stale catalog price is refused in a plan-change quote — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The admin reloads the current monthly catalog price before repairing the quote — GET /v1/prices/{monthly}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:261,950; Stripe catalog and saved Checkout recovery
- A workflow’s incomplete quote configuration requires a customer — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The quote refuses a deleted customer id — POST /v1/invoices/create_preview. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The workflow asks to include its customer’s pending items in a new draft — POST /v1/invoices. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- After launch week the code is switched off — POST /v1/promotion_codes/{promo}. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:294
- Rallly configures billing details and card updates — POST /v1/billing_portal/configurations. Rallly: apps/web/src/features/billing/mutations.ts:103
- Tallyforge lists the portal's configurations — GET /v1/billing_portal/configurations?active=true&limit=100. Rallly: apps/web/src/features/billing/mutations.ts:35
- Nordlicht opens the portal — POST /v1/billing_portal/sessions. Rallly: apps/web/src/features/billing/mutations.ts:22
- The portal page — GET {portal_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- Nordlicht adds a new card — POST https://billing.stripe.com/p/session/{portal}/payment_method. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)

### Monday 2 March: the monthly subscriptions renew

Elapsed: 40320m.


### Wednesday 1 April: the launch promotion closes

Elapsed: 43200m.

- The webinar long over, Femke switches LAUNCH20 off again — POST /v1/promotion_codes/{promo}. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:294

### Monday 4 May: a storage add-on and fraud investigation

Elapsed: 47520m.

- A storage add-on charged on the server at once, with Stripe's test card — POST /v1/payment_intents. Twin: apps/platform/src/sample.ts:47
- Kestrel reads the receipt for its storage add-on — GET /v1/charges/{shop_charge}. Dub: apps/web/app/(ee)/api/cron/payouts/charge-succeeded/utils.ts:78; spec:GetChargesCharge
- Postiz refunds the canceled storage add-on — POST /v1/refunds. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:1027 (refunds.create({charge}))
- Tallyforge lists Nordlicht's cards — GET /v1/payment_methods?customer={nordlicht}&type=card. Dub: apps/web/lib/stripe/create-payment-intent.ts:20
- Femke opens the Radar Lists page before entering the fraud lists — GET https://dashboard.stripe.com/radar/lists. Stripe: https://docs.stripe.com/radar/lists
- The fraud operator creates Fraud customers in Radar Lists — POST https://dashboard.stripe.com/radar/lists. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:3-7; https://docs.stripe.com/radar/lists#create-and-edit-lists
- The fraud operator creates Fraud emails in Radar Lists — POST https://dashboard.stripe.com/radar/lists. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:3-7; https://docs.stripe.com/radar/lists#create-and-edit-lists
- The fraud operator creates Fraud card fingerprints in Radar Lists — POST https://dashboard.stripe.com/radar/lists. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:3-7; https://docs.stripe.com/radar/lists#create-and-edit-lists
- Dub adds the flagged customer to its configured Radar list — POST /v1/radar/value_list_items. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:28
- Dub adds the flagged email to its configured Radar list — POST /v1/radar/value_list_items. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:28
- Dub adds the flagged fingerprint to its configured Radar list — POST /v1/radar/value_list_items. Dub: apps/web/app/(ee)/api/stripe/webhook/utils/add-to-stripe-fraud-value-lists.ts:28

### Wednesday 1 July: the partner program

Elapsed: 83520m.

- A partner agency: an Express account — POST /v1/accounts. Dub: apps/web/lib/stripe/create-connected-account.ts:13
- An onboarding link — POST /v1/account_links. Dub: apps/web/lib/actions/partners/generate-stripe-account-link.ts:71
- The partner opens it — GET {link_url}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- The onboarding page — GET {onb}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- and submits it — POST {onb}. World operator or vendor-hosted browser continuation of the application call named in this act (customer-life.outline.md)
- The account, read — GET /v1/accounts/{partner}. Dub: apps/web/lib/actions/partners/generate-stripe-account-link.ts:66
- its bank account — GET /v1/accounts/{partner}/external_accounts?object=bank_account. Dub: apps/web/lib/partners/get-partner-bank-account.ts:25
- a login link to its Express dashboard — POST /v1/accounts/{partner}/login_links. Dub: apps/web/lib/actions/partners/generate-stripe-account-link.ts:70
- Kestrel's balance — GET /v1/balance. Dub: apps/web/app/(ee)/api/cron/trigger-withdrawal/route.ts:14

### Monday 3 August: July commissions

Elapsed: 47520m.

- The partner's commission transferred — POST /v1/transfers. Dub: apps/web/lib/partners/create-stripe-transfer.ts:203
- Transfers to the partner — GET /v1/transfers?destination={partner}&limit=100. Dub: apps/web/app/(ee)/api/cron/payouts/balance-available/route.ts:151
- The partner is paid out from their balance — POST /v1/payouts. Dub: apps/web/app/(ee)/api/cron/payouts/balance-available/route.ts:134
- Dub checks when the platform's add-on charge settles — GET /v1/balance_transactions?source={shop_charge}. Dub: apps/web/app/(ee)/api/cron/payouts/charge-succeeded/utils.ts:78
- The partner program keeps its integration secret in the secret store — POST /v1/apps/secrets. Dub: packages/stripe-app/src/utils/secrets.ts:20
- and finds it — GET /v1/apps/secrets/find?name=dub_token&scope[type]=account&expand[]=payload. Dub: packages/stripe-app/src/utils/secrets.ts:36
- and deletes it at the rotation — POST /v1/apps/secrets/delete. Dub: packages/stripe-app/src/utils/secrets.ts:60

### Monday 31 August: a partner leaves

Elapsed: 40320m.

- A second partner, who leaves before onboarding — POST /v1/accounts. Dub: apps/web/lib/stripe/create-connected-account.ts:13
- is deleted — DELETE /v1/accounts/{partner2}. Dub: apps/web/app/(ee)/api/admin/partners/delete-account/route.ts:64

### Monday 2 November: cancellations

Elapsed: 90720m.

- Veldkamp cancels at once — DELETE /v1/subscriptions/{veld_sub}. Dub: apps/web/lib/stripe/cancel-subscription.ts:20
- The subscription, read — GET /v1/subscriptions/{veld_sub}. Dub: apps/web/lib/stripe/cancel-subscription.ts:18
- Products listed — GET /v1/products?active=true&expand[]=data.prices. Stripe operator catalog read-back: spec:GetProducts

### Monday 7 December: Kestrel's agents get a card rail

Elapsed: 50400m.

- The treasurer opens Stripe’s test Issuing balance page — GET https://dashboard.stripe.com/test/issuing/balance. Stripe: https://docs.stripe.com/issuing/testing
- The operator funds the sandbox Issuing balance for the domain purchase — POST https://dashboard.stripe.com/test/issuing/balance. https://docs.stripe.com/issuing/testing#fund-your-test-issuing-balance
- Kestrel's platform enrols its webhook endpoint for the Issuing events — POST /v1/webhook_endpoints. Open Autonomy: apps/platform/world.ts:46
- The rail's cardholder: the account the agents spend for — POST /v1/issuing/cardholders. Open Autonomy: packages/backend/src/rails.ts:35; apps/platform/world.ts:45
- The treasurer obtains a single-use virtual card for the domain, at most $2.50 — POST /v1/issuing/cards. Open Autonomy: packages/backend/src/rails.ts:40
- The agent reads the card's number and CVC — GET /v1/issuing/cards/{ic}?expand[]=number&expand[]=cvc. Open Autonomy: packages/backend/src/rails.ts:48
- The product World presents the domain purchase at Namecheap — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60-61; packages/backend/src/rails.ts:40 (no status); https://docs.stripe.com/api/issuing/cards/create#create_issuing_card-status (Defaults to inactive); spec:/components/schemas/issuing_authorization_request/properties/reason/enum (card_inactive)
- The rail retires the unused card when the issuer reports its decline — POST /v1/issuing/cards/{ic}. Open Autonomy: packages/backend/src/rails.ts:93-99
- Ravel’s admin reads its current monthly line before upgrading — GET /v1/subscriptions/{ravel_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- Ravel switches its existing line to the yearly price — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- The billing admin gives Ravel a second add-on line — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Ravel removes the extra editor line after consolidating workspaces — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- A negotiated yearly price is created inline on Ravel’s line — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- During a seasonal shutdown the admin pauses collection — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Ravel returns and the admin resumes collection — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- The admin renews Ravel’s launch discount using the existing coupon — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Ravel starts a two-day trial with a one-time onboarding fee — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- Checkout explains the trial and the fee due today — GET {trial_cs_url}. Stripe: https://docs.stripe.com/payments/checkout/free-trials
- The subscriber enters a card — POST {trial_cs_url}. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- The app reads the new trial subscription — GET /v1/checkout/sessions/{trial_cs}. Stripe: spec:GetCheckoutSessionsSession
- The customer’s double-click revisits its completed payment page — POST {trial_cs_url}. Stripe: spec:/components/schemas/checkout.session/properties/status
- Nordlicht tries a second project free for one day — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The hosted page shows when the recurring plan starts — GET {overdue_cs_url}. Stripe: https://docs.stripe.com/payments/checkout/free-trials
- The subscriber enters a card — POST {overdue_cs_url}. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- The app reads Nordlicht’s new trial — GET /v1/checkout/sessions/{overdue_cs}. Stripe: spec:GetCheckoutSessionsSession
- Nordlicht’s bank card is replaced before the trial ends — POST /v1/subscriptions/{overdue_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId

### Two days pass; the trial ends and its renewal is attempted

Elapsed: 2d.

- The subscription is overdue after its bank decline — GET /v1/subscriptions/{overdue_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- Nordlicht opens its billing portal to settle the invoice — POST /v1/billing_portal/sessions. Rallly: apps/web/src/features/billing/mutations.ts:22
- The portal shows the unpaid invoice — GET {overdue_portal_url}. Stripe: https://docs.stripe.com/customer-management
- Nordlicht tries its declined card on the unpaid invoice — POST https://billing.stripe.com/p/session/{overdue_portal}/pay. Stripe: https://docs.stripe.com/customer-management
- Nordlicht updates its billing card — POST https://billing.stripe.com/p/session/{overdue_portal}/payment_method. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- Nordlicht pays the overdue invoice with the new card — POST https://billing.stripe.com/p/session/{overdue_portal}/pay. Stripe: https://docs.stripe.com/customer-management
- Its subscription is active again — GET /v1/subscriptions/{overdue_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- A queued collection job reaches the invoice after the customer paid — POST /v1/invoices/{overdue_inv}/pay. Stripe: spec:PostInvoicesInvoicePay
- Nordlicht schedules the new project to end at renewal — POST https://billing.stripe.com/p/session/{overdue_portal}/cancel. Stripe: https://docs.stripe.com/customer-management
- The project is renewed after its owner changes their mind — POST https://billing.stripe.com/p/session/{overdue_portal}/renew. Stripe: https://docs.stripe.com/customer-management
- The owner schedules it to end after all — POST https://billing.stripe.com/p/session/{overdue_portal}/cancel. Stripe: https://docs.stripe.com/customer-management

### One billing period passes; the canceled project is not renewed

Elapsed: 32d.

- The scheduled cancellation has completed — GET /v1/subscriptions/{overdue_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- Ravel buys a lifetime upgrade in Checkout — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The subscriber enters a card — POST {lifetime_cs_url}. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- The completed lifetime checkout names its payment — GET /v1/checkout/sessions/{lifetime_cs}. Stripe: spec:GetCheckoutSessionsSession
- Femke reopens the launch promotion for an alumni webinar — POST /v1/promotion_codes/{promo}. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:294
- Ravel buys a third workspace with the reopened promotion — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The subscriber enters a card — POST {promo_cs_url}. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- The discounted checkout is complete — GET /v1/checkout/sessions/{promo_cs}. Stripe: spec:GetCheckoutSessionsSession
- Postiz verifies the customer’s card with a one-dollar manual authorization — POST /v1/payment_intents. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:115-123
- Postiz releases its card-verification authorization — POST /v1/payment_intents/{hold_pi}/cancel. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts:133 (cancel(id), no parameters)
- The collection job meets a bank account waiting for micro-deposits — POST /v1/payment_intents. Dub: apps/web/lib/stripe/microdeposits.ts:99; Stripe: spec:PostPaymentIntents
- A saved test card is declined during automatic collection — POST /v1/payment_intents. Stripe: https://docs.stripe.com/testing#declined-payments
- An admin creates a billing customer with a saved test card and launch coupon — POST /v1/customers. Stripe: spec:PostCustomers; https://docs.stripe.com/api/customers/create
- Ravel’s subscription falls back to its customer invoice default — POST /v1/subscriptions/{ravel_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Dub schedules Ravel’s cancellation at the end of its period — POST /v1/subscriptions/{ravel_sub}. Dub: apps/web/lib/stripe/cancel-subscription.ts:23
- Ravel changes its mind before the period ends — POST /v1/subscriptions/{ravel_sub}. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/cancel/route.ts:56
- Maren takes a one-day trial of a new workspace — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The subscriber enters a card — POST {draft_cs_url}. Stripe hosted continuation: https://docs.stripe.com/payments/checkout/how-checkout-works
- The app retains the trial subscription — GET /v1/checkout/sessions/{draft_cs}. Stripe: spec:GetCheckoutSessionsSession

### Exactly one day later, the subscription renews; its invoice is still a draft

Elapsed: 1d.

- Maren’s app reads the invoice awaiting collection — GET /v1/subscriptions/{draft_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- Maren chooses Pay now before automatic finalization but has no invoice default — POST /v1/invoices/{draft_invoice}/pay. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/retry-payment/route.ts:44
- Maren sets the saved test card as her invoice default — POST /v1/customers/{maren}. Stripe: spec:PostCustomersCustomer
- Her retry finalizes the draft and pays the receipt — POST /v1/invoices/{draft_invoice}/pay. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/retry-payment/route.ts:44
- The launch catalog upload omits the tier scheme — POST /v1/prices. Stripe: spec:PostPrices

### The catalog admin consults the tier-pricing instructions and fixes its scheme

Elapsed: 5m.

- Its corrected scheme still lacks the uploaded tiers — POST /v1/prices. Stripe: spec:PostPrices
- The catalog admin verifies the product that will own those tiers — GET /v1/products?active=true. Stripe: spec:GetProducts
- A tier with neither an amount nor a flat fee is refused — POST /v1/prices. Stripe: spec:PostPrices
- The admin publishes volume pricing with a flat fee and an unlimited final tier — POST /v1/prices. Stripe: spec:PostPrices
- Harness reviews one customer per page — GET /v1/customers?limit=1. Stripe: spec:GetCustomers
- The admin advances to the next billing customer — GET /v1/customers?limit=1&starting_after={newest_customer}. Stripe: spec:GetCustomers
- The admin pages back to the customer just reviewed — GET /v1/customers?limit=1&ending_before={next_customer}. Stripe: spec:GetCustomers
- Dub filters its active monthly subscriptions by price — GET /v1/subscriptions?price={monthly}&status=all. Stripe: spec:GetSubscriptions
- The bookkeeper limits invoice history to this billing year — GET /v1/invoices?created[gte]=1798761600&created[lt]=1830297600. Stripe: spec:GetInvoices
- Customer search accepts a campaign tag and a numeric date range — GET /v1/customers/search?query=metadata['campaign']:'none'%20OR%20created%3E1798761600. Stripe: https://docs.stripe.com/search#search-query-language
- The bookkeeper finds customer records created before the cutoff — GET /v1/customers/search?query=created%3C1830297600%20AND%20created%3C%3D1830297600. Stripe: https://docs.stripe.com/search#search-query-language
- The search panel refuses an empty query before finding customers — GET /v1/customers/search. Stripe: spec:GetCustomersCustomer
- The public key cannot read the billing customer list — GET /v1/customers. Stripe: https://docs.stripe.com/error-codes
- The worker’s restored server key reads its billing customers — GET /v1/customers?limit=1. Stripe: spec:GetCustomers
- A rotated secret key fails the dashboard’s customer read — GET /v1/customers. Stripe: https://docs.stripe.com/api/authentication

### The developer checks which key the worker actually loads

Elapsed: 5m.

- A missing API key is refused before billing data is read — GET /v1/customers. Stripe: https://docs.stripe.com/api/authentication
- Rallly’s operator enables immediate cancellation in a second portal configuration — POST /v1/billing_portal/configurations. Stripe: spec:PostBillingPortalConfigurations
- Ravel opens that portal to close its trial workspace — POST /v1/billing_portal/sessions. Stripe: spec:PostBillingPortalSessions
- Ravel cancels the trial workspace immediately — POST https://billing.stripe.com/p/session/{instant_portal}/cancel. Stripe: https://docs.stripe.com/customer-management
- Kestrel adds a company partner to its payout program — POST /v1/accounts. Stripe: spec:PostAccounts
- The company’s owner gets its onboarding link — POST /v1/account_links. Dub: apps/web/lib/actions/partners/generate-stripe-account-link.ts:71
- The owner opens its company onboarding — GET {company_link}. Stripe: https://docs.stripe.com/connect/hosted-onboarding
- The owner starts the company form but leaves required banking details blank — POST {company_onb}. Stripe: https://docs.stripe.com/connect/hosted-onboarding
- The owner supplies company, representative, owner and bank details — POST {company_onb}. Stripe: https://docs.stripe.com/connect/required-verification-information
- The treasurer replaces the retired agent card with an active sandbox card — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards
- The treasurer restricts the card to online purchases — POST /v1/issuing/cards/{replacement_card}. Open Autonomy card rail; Stripe: spec PostIssuingCardsCard spending_controls.allowed_card_presences
- The rail reads back the online-only policy and previous spending limits — GET /v1/issuing/cards/{replacement_card}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The treasurer changes the merchant country without clearing card presence — POST /v1/issuing/cards/{replacement_card}. Postiz: libraries/nestjs-libraries/src/services/stripe.service.ts; Stripe: pinned API and Stripe.js Checkout contract
- The treasurer pauses the replacement during a credential check — POST /v1/issuing/cards/{replacement_card}. Stripe: spec:PostIssuingCardsCard
- The check finishes and the card is active again — POST /v1/issuing/cards/{replacement_card}. Stripe: spec:PostIssuingCardsCard
- The merchant’s larger estimate exceeds the per-purchase limit — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- The merchant retries the $2 domain purchase — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- A duplicate decline callback arrives after that purchase was decided — POST /v1/issuing/authorizations/{replacement_auth}/decline. Open Autonomy: packages/backend/src/rails.ts:109; Stripe: spec:PostIssuingAuthorizationsAuthorizationDecline
- A duplicate approval arrives after the decision too — POST /v1/issuing/authorizations/{replacement_auth}/approve. Open Autonomy: packages/backend/src/rails.ts:109; Stripe: spec:PostIssuingAuthorizationsAuthorizationApprove
- Namecheap captures the first dollar and keeps the authorization open — POST /v1/test_helpers/issuing/authorizations/{replacement_auth}/capture. Stripe: spec:PostTestHelpersIssuingAuthorizationsAuthorizationCapture
- It captures the remaining dollar and closes the authorization — POST /v1/test_helpers/issuing/authorizations/{replacement_auth}/capture. Open Autonomy: world/model/scenario.ts:62
- A second purchase exceeds the remaining weekly allowance — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- Maren clears the subscription-specific card to use her invoice default — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- A backdated extension cannot start Maren’s new trial — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- The extension is corrected to a future trial — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Dub activates the paid plan early, changing its price at the same time — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- An unpriced add-on submitted by the admin is refused — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- The admin reads the subscription before correcting the add-on — GET /v1/subscriptions/{draft_sub}. Stripe: spec:GetSubscriptionsSubscriptionExposedId
- Maren’s bank card is declined before another trial would end — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Her activation asks Stripe to keep the trial if payment fails — POST /v1/subscriptions/{draft_sub}. Stripe: spec:PostSubscriptionsSubscriptionExposedId
- Harness pages through the newer subscription first — GET /v1/subscriptions?status=all&limit=1. Stripe: spec:GetSubscriptions
- The admin advances to an older subscription — GET /v1/subscriptions?status=all&limit=1&starting_after={last_subscription}. Stripe: spec:GetSubscriptions
- The admin returns to the newer subscription — GET /v1/subscriptions?status=all&limit=1&ending_before={previous_subscription}. Stripe: spec:GetSubscriptions
- Dub reconciles ledger entries created during this billing year — GET /v1/balance_transactions?created[gte]=1798761600&created[lt]=1830297600. Stripe: spec:GetBalanceTransactions
- A new plan cannot start Checkout before its price is entered — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The admin reads its published prices before repairing that plan — GET /v1/prices?lookup_keys[]=pro_monthly. Dub: apps/web/app/api/workspaces/[idOrSlug]/billing/upgrade/route.ts:37
- A partner charge template still names an account already deleted — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The configured trial interval must be at least a day — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- Ravel starts a project whose trial ends at a fixed campaign date — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- Checkout shows the fixed trial end to the customer — GET {dated_trial_cs_url}. Stripe: https://docs.stripe.com/payments/checkout/free-trials
- A European customer chooses SEPA for its first add-on collection — POST /v1/payment_intents. Stripe: spec:PostPaymentIntents
- Another customer chooses its Cash App wallet for an add-on — POST /v1/payment_intents. Stripe: spec:PostPaymentIntents
- The sample shop explicitly limits its confirmed card payment to cards — POST /v1/payment_intents. Stripe: spec:PostPaymentIntents
- An old Checkout method name in a deployed template is refused — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- The new API version refuses the removed method parameter — POST /v1/payment_intents. Stripe: https://docs.stripe.com/changelog/clover/2026-01-28/remove-payment-method-types
- The partner’s billable service pays the platform its agreed application fee — POST /v1/payment_intents. Stripe: spec:PostPaymentIntents; https://docs.stripe.com/connect/direct-charges
- A commission uses the settled add-on’s source transaction — POST /v1/transfers. Dub: apps/web/lib/partners/create-stripe-transfer.ts:203; https://docs.stripe.com/connect/separate-charges-and-transfers
- A payout template names euros before this partner adds a euro bank — POST /v1/payouts. Stripe: spec:PostPayouts
- A company chooses platform-collected onboarding instead of Express — POST /v1/accounts. Stripe: spec:PostAccounts
- A UK partner begins the program but its country’s onboarding requirements remain outside the authored hosted flow — POST /v1/accounts. Stripe: spec:PostAccounts
- The partner receives its onboarding link — POST /v1/account_links. Stripe: spec:PostAccountLinks
- The link redirects to its hosted setup page — GET {uk_link}. Stripe: https://docs.stripe.com/connect/hosted-onboarding
- The hosted page explains the documented coverage gap — GET {uk_onb}. Stripe: https://docs.stripe.com/connect/required-verification-information; manifest.todo hosted requirements scope

### A week passes before the next domain renewal purchase

Elapsed: 7d.

- Open Autonomy refuses a purchase its treasurer did not authorize — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- The imported card controls must be a dictionary — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- The imported category policy cannot both allow and block a category — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- The treasurer compares the stored card with the rejected import — GET /v1/issuing/cards/{replacement_card}. Stripe: spec:GetIssuingCardsCard
- The imported country policy cannot both allow and block a country — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- Every imported spending limit must be a dictionary — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- The treasurer compares the stored card with the rejected import — GET /v1/issuing/cards/{replacement_card}. Stripe: spec:GetIssuingCardsCard
- The imported zero-dollar limit must be positive — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- The imported fortnight interval must use Stripe’s named intervals — POST /v1/issuing/cards. Stripe: spec:PostIssuingCards; pinned SDK Issuing/Cards.d.ts SpendingControls
- The treasurer compares the stored card with the rejected import — GET /v1/issuing/cards/{replacement_card}. Stripe: spec:GetIssuingCardsCard
- An imported suspended status is replaced by Stripe’s inactive status — POST /v1/issuing/cards/{replacement_card}. Stripe: spec:PostIssuingCardsCard
- The issuer does not recognize the imported authorization method — POST /v1/test_helpers/issuing/authorizations. Stripe: spec:PostTestHelpersIssuingAuthorizations
- The treasurer reads the card after correcting the imported method name — GET /v1/issuing/cards/{replacement_card}. Stripe: spec:GetIssuingCardsCard
- A delayed product reply leaves a renewal request pending — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- The treasurer’s zero-dollar approval is refused — POST /v1/issuing/authorizations/{pending_partial}/approve. Stripe: spec:PostIssuingAuthorizationsAuthorizationApprove
- The treasurer approves only the $0.75 domain charge — POST /v1/issuing/authorizations/{pending_partial}/approve. Stripe: spec:PostIssuingAuthorizationsAuthorizationApprove
- A fixed-amount domain request waits on a delayed reply — POST /v1/test_helpers/issuing/authorizations. Open Autonomy: world/model/scenario.ts:60; Stripe: spec:PostTestHelpersIssuingAuthorizations
- The treasurer cannot override a fixed-amount request — POST /v1/issuing/authorizations/{pending_fixed}/approve. Stripe: spec:PostIssuingAuthorizationsAuthorizationApprove
- It approves the request’s fixed amount instead — POST /v1/issuing/authorizations/{pending_fixed}/approve. Open Autonomy: packages/backend/src/rails.ts:109
- A deployed payment template names an obsolete payment method — POST /v1/payment_intents. Stripe: spec:PostPaymentIntents
- Femke creates a fixed $5 alumni coupon for the next workspace — POST /v1/coupons. Dub: apps/web/lib/discounts/discount-provider-stripe.ts:136; Stripe: spec:PostCoupons
- Ravel starts its alumni workspace with $5 off the first month — POST /v1/checkout/sessions. Stripe: spec:PostCheckoutSessions
- Checkout deducts the fixed amount from the first bill — GET /v1/checkout/sessions/{alumni_cs}. Stripe: spec:GetCheckoutSessionsSession
- A new subscriber opens custom Checkout before a customer exists — POST /v1/checkout/sessions. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
- The new subscriber supplies its contact and card in PaymentElement — POST https://api.stripe.com/v1/payment_pages/{anonymous_cs}/confirm. Stripe: spec PostInvoicesCreatePreview and PostInvoices documented options of Twenty workflow and Postiz billing calls
