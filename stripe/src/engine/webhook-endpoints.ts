// Webhook endpoint semantics: registering a URL and the events it subscribes to. Delivery reads
// the endpoints from the tree, signing each POST with the endpoint's own secret; a disabled one
// (the machine in ../manifest.ts) receives nothing. Endpoint list, retrieve and delete are the derived core's.
//
// The Events API lists and retrieves the stored events of the account a request acts for: an event of a connected
// account carries it ("Each event for a connected account contains a top-level `account` property that identifies the
// connected account. Because the connected account owns the object that triggered the event, you must make API
// requests for that object as the connected account", docs.stripe.com/connect/webhooks; the event's `account`: "The
// connected account that originates the event", spec/openapi.json.gz), so a request with the Stripe-Account header
// sees that account's events and one without it the platform's, those with no `account`. Where the documentation
// stops and the twin decides: a platform request does not see its connected accounts' events.

export const WE = 'webhook_endpoint';

