// Webhook endpoints: where Polar sends the organization's events, each signed with its endpoint's secret.
import type { HandlerContext } from '@volter/world-core';
import { bodyOf, environment, ENDPOINT, invalid, missing, newId, orgId, secret } from './shared.ts';

const FORMATS = ['raw', 'discord', 'slack'];

/** `POST /v1/webhooks/endpoints`: an endpoint for the events named, its signing secret drawn from the World
 *  (`polar_whs_`, ctx.secret) and answered. */
// source: spec:webhooks:create_webhook_endpoint "Create a webhook endpoint."
export async function webhooks_create_webhook_endpoint(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  // source: spec:/components/schemas/WebhookEndpointCreate "The URL where the webhook events will be sent."
  if (typeof body.url !== 'string' || body.url === '') return missing('url');
  if (!/^https?:\/\/[^\s]+$/.test(body.url)) return invalid(['url'], 'Input should be a valid URL', 'url_parsing');
  // source: spec:/components/schemas/WebhookFormat "WebhookFormat"
  if (body.format === undefined) return missing('format');
  if (!FORMATS.includes(String(body.format))) return invalid(['format'], "Input should be 'raw', 'discord' or 'slack'", 'enum');
  // source: spec:/components/schemas/WebhookEndpointCreate "The events that will trigger the webhook."
  if (!Array.isArray(body.events)) return missing('events');
  const id = newId(ctx, ENDPOINT);
  const signing = await secret(ctx, 'polar_whs_', `endpoint:${id}`);
  const endpoint = {
    created_at: ctx.occurredAt, modified_at: null, id, url: body.url, name: body.name ?? null, format: body.format, secret: signing,
    organization_id: orgId(ctx), events: body.events, enabled: true,
  };
  await ctx.write(ENDPOINT, id, { ...endpoint, _environment: environment(ctx) }, 'webhook_endpoint.create');
  // source: spec:/components/schemas/WebhookEndpoint "The secret used to sign the webhook events."
  return Response.json(endpoint, { status: 201 });
}
