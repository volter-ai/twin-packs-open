// What every family of Cohere's API shares: its API keys (made on the dashboard's API Keys page) and its error body.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// Where the documentation stops: the key's opaque length is a World choice, not a vendor guarantee.
// A World key is 40 letters and digits; the World keeps it by its SHA-256 (the row's id is minted) and draws it from a secret it holds.
const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
export async function makeKey(ctx: HandlerContext, name: string, organization: Row): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `cohere-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, label, organization_id: organization.id, owner_id: organization.owner_id,
    key_type: 'trial', created: ctx.occurredAt, sha256: sha256(ctx, key) }, id);
  return id;
}
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true || row.revoked === true) return undefined;
  const key = await keyValue(ctx, String(row.label));
  return sha256(ctx, key) === row.sha256 ? key : undefined;
}
// source: spec:/components/responses/BadRequest "This error is returned when the request is not well formed."
/** Cohere's error body: `{id, message}`. */
export const cohereError = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, status: number, message: string): Response =>
  Response.json({ id: ctx.crypto.uuidFrom(`cohere-error:${ctx.occurredAt}:${message}`), message }, { status });

// The vendor's currently documented rerank catalogue; release dates are vendor facts. No unknown prefix is accepted.
// source: https://docs.cohere.com/changelog/advanced-retrieval-launch "April 9, 2024"
// source: https://docs.cohere.com/changelog/rerank-v3.5 "December 2, 2024"
// source: https://docs.cohere.com/changelog/rerank-v4.0 "December 11, 2025"
// source: https://docs.cohere.com/docs/rerank "rerank-english-v3.0"
// source: https://docs.cohere.com/docs/rerank "rerank-multilingual-v3.0"
const MODEL_RELEASES: Record<string, string> = {
  'rerank-english-v3.0': '2024-04-09T00:00:00.000Z',
  'rerank-multilingual-v3.0': '2024-04-09T00:00:00.000Z',
  'rerank-v3.5': '2024-12-02T00:00:00.000Z',
  'rerank-v4.0-pro': '2025-12-11T00:00:00.000Z',
  'rerank-v4.0-fast': '2025-12-11T00:00:00.000Z',
};

// source: https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/35f6d97b834974daa7dde160f7ad942a8b0c2b12/fern/pages/changelog/2024-09-26-api-v2.mdx "Thurs Sept 26 2024"
// The sources give release dates, not per-region rollout instants: the World uses UTC start-of-day.
export function modelAvailable(model: string, at: string): boolean {
  const released = MODEL_RELEASES[model];
  return released !== undefined && at >= released;
}
