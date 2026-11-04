import { placeholderPng, type HandlerContext, type PackScenario } from '@volter/world-core';

export function accountFor(ctx: HandlerContext): Promise<Record<string, unknown>> {
  return ctx.tenant('_account', (organization) => ctx.record('_account', { name: organization.label, owner: organization.members[0]!, members: organization.members }));
}

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
export const IMAGE = '_image';

// source: https://fal.ai/docs/api-reference/platform-apis/authentication.md "Authorization: Key YOUR_API_KEY"
// The credential door stands in for the dashboard; opaque key material comes from the World's secret custody.
const keyValue = async (ctx: HandlerContext, label: string): Promise<string> =>
  `${ctx.crypto.uuidFrom(`fal-key-id:${label}`)}:${ctx.crypto.digest('sha256', await ctx.secret(label), 'hex').slice(0, 32)}`;
export async function makeKey(ctx: HandlerContext, name: string, owner: string): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `fal-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, label, _account: owner, created: ctx.occurredAt, sha256: ctx.crypto.digest('sha256', key, 'hex') }, id);
  return id;
}
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (typeof row.label !== 'string') return undefined;
  const key = await keyValue(ctx, row.label);
  return ctx.crypto.digest('sha256', key, 'hex') === row.sha256 ? key : undefined;
}
// source: https://fal.ai/docs/documentation/model-apis/errors.md "These errors tell you exactly what went wrong with your input and how to fix it."
export const falError = (status: number, detail: unknown): Response => Response.json({ detail }, { status });
// source: https://fal.ai/docs/platform-apis/v1/models/pricing.md "Standard error response format"
// This helper is also used by the Platform lane, whose spec defines this envelope.
export const platformError = (status: number, type: string, message: string): Response => Response.json({ error: { type, message } }, { status });

// Placeholder dimensions are a deterministic stub choice, not a promise of the model's exact pixel dimensions.
export function sizeOf(aspect: string): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number);
  const ratio = w! / h!;
  const width = Math.round(Math.sqrt(1048576 * ratio) / 16) * 16;
  return { width, height: Math.round(width / ratio / 16) * 16 };
}
export async function keepImage(ctx: HandlerContext, prompt: string, seed: number, aspect: string): Promise<{ id: string; bytes: Uint8Array }> {
  const id = await ctx.issue(IMAGE);
  const blob = `${id}.png`;
  const bytes = placeholderPng(sizeOf(aspect), `fal-ai/ideogram/v2:${seed}:${prompt}`, `placeholder from fal twin; no model runs: ${prompt.slice(0, 200)}`);
  await ctx.blobs.put(blob, bytes);
  await ctx.record(IMAGE, { blob }, id);
  return { id, bytes };
}
// source: spec:/components/schemas/IdeogramV2Input "the media will be returned as a data URI"
export const imageUrl = (ctx: HandlerContext, id: string, bytes: Uint8Array, sync: boolean): string =>
  sync ? `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` : `${ctx.publicBase.replace(/\/$/, '')}/_twin/media/${id}.png`;

// Stateless prices can be scripted; stored mutations are never accepted through this adapter.
// source: https://fal.ai/docs/platform-apis/v1/models/pricing.md "Pricing information for requested endpoints"
export function validatePrices(respond: unknown): string | null {
  if (!respond || typeof respond !== 'object' || Array.isArray(respond)) return 'Pricing response is an object.';
  const r = respond as Row;
  if (!Array.isArray(r.prices) || typeof r.has_more !== 'boolean' || !(r.next_cursor === null || typeof r.next_cursor === 'string')) return 'Pricing requires prices, has_more and next_cursor.';
  return r.prices.every((p) => p && typeof p === 'object' && !Array.isArray(p)
    && typeof p.endpoint_id === 'string' && typeof p.unit_price === 'number' && Number.isFinite(p.unit_price) && p.unit_price >= 0
    && typeof p.unit === 'string' && typeof p.currency === 'string' && p.currency.length === 3) ? null : 'Malformed pricing item.';
}
// source: https://fal.ai/docs/platform-apis/v1/models/pricing.md "Standard error response format"
export function pricingFault(status: number): { type: string; message: string } {
  const defaults: Record<number, { type: string; message: string }> = {
    400: { type: 'validation_error', message: 'Invalid request parameters' },
    401: { type: 'authorization_error', message: 'Authentication required' },
    403: { type: 'authorization_error', message: 'Access denied' },
    404: { type: 'not_found', message: 'Resource not found' },
    429: { type: 'rate_limited', message: 'Rate limit exceeded' },
  };
  // The spec gives categories rather than a message for every status; unknown failures use server_error.
  return defaults[status] ?? { type: 'server_error', message: 'Server error' };
}
export const pricingScenario: PackScenario = {
  operations: ['getPricing'],
  request: (ctx) => ({ operation: ctx.call.operation.id }),
  adapter: {
    vendor: 'fal', features: (r) => ({ operation: r.operation }),
    matchers: { operation: (r, v) => r.operation === v },
    validateRespond: validatePrices,
    // source: https://fal.ai/docs/platform-apis/v1/models/pricing.md "Rate limit exceeded"
    renderFault: (f) => {
      const defaults = pricingFault(f.status);
      return { body: { error: { type: f.errorType ?? defaults.type, message: f.message ?? defaults.message } } };
    },
  },
};
