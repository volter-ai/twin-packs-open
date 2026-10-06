// Stripe's webhook_endpoints operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { asBool } from '../engine/stripe.ts';
import { WE } from '../engine/webhook-endpoints.ts';
import { created, fail } from './shared.ts';
// an endpoint is enabled at once and signs each event with a secret of its own, answered by this create alone (the
// around answers no other read of it)
export async function PostWebhookEndpoints(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  // source: spec:PostWebhookEndpoints "The URL of the webhook endpoint."
  if (typeof params.url !== 'string' || params.url === '') return fail(ctx, 'Missing required param: url.', 400, 'parameter_missing');
  // source: spec:PostWebhookEndpoints "The list of events to enable for this endpoint."
  if (params.enabled_events === undefined || params.enabled_events === '' || (Array.isArray(params.enabled_events) && !params.enabled_events.length)) return fail(ctx, 'Missing required param: enabled_events.', 400, 'parameter_missing');
  const id = ctx.mint(WE);
  // source: spec:/components/schemas/webhook_endpoint/properties/secret/description "The endpoint's secret, used to generate"
  const secret = `whsec_${(await ctx.secret(`webhook-endpoint-secret:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
  return ctx.reply(await created(ctx, WE, { ...params, id }, {
    url: params.url, enabled_events: Array.isArray(params.enabled_events) ? params.enabled_events.map(String) : [String(params.enabled_events)],
    // source: spec:/components/schemas/webhook_endpoint/properties/status/description "The status of the webhook."
    status: 'enabled', livemode: false, metadata: {}, application: null,
    api_version: typeof params.api_version === 'string' ? params.api_version : null,
    description: typeof params.description === 'string' ? params.description : null,
    // source: spec:PostWebhookEndpoints "Whether this endpoint should receive events from connected accounts"
    connect: asBool(params.connect), secret,
  }));
}
