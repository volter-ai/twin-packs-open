// What Axiom's families share: the account's datasets and API tokens, and its error body.
//
// A dataset is the vendor's record as the dataset list answers it (DatasetSpec: `id`, the dataset's name, `name`,
// `description`, `who`, `created`). A basic API token ingests into the datasets it was given access to; the World keeps
// it by its SHA-256 (`_api_token`, the manifest's auth `held`) with those datasets, and draws its value from a secret it
// holds (ctx.secret), so no one computes it.
import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;
const DATASET = 'DatasetSpec';
export const EVENT = 'event';
const TOKEN = '_api_token';

const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// source: archive:https://registry.npmjs.org/@axiomhq/js/-/js-1.3.1.tgz#sha256=e19e60515bdda724bc4a2046a10dae35238dbb357d592c5448f65ea13dbfc193!/package/dist/esm/client.js "Please use an API token"
// An API token is `xaat-` and a UUID. Where the documentation stops: the SDK names the prefix only; the UUID's form is
// the World's choice, drawn from its secret for the token.
const tokenValue = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> => {
  const hex = ctx.crypto.digest('sha256', await ctx.secret(label), 'hex');
  return `xaat-${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** A dataset, made the first time its name is asked for (Datasets > New dataset). */
export async function makeDataset(ctx: HandlerContext, name: string, who: string): Promise<Row> {
  const held = datasetOf(ctx, name);
  if (held) return held;
  await ctx.write(DATASET, name, { id: name, name, description: '', who, created: ctx.occurredAt }, 'DatasetSpec.create');
  return ctx.row(DATASET, name)!;
}

/** A basic API token with ingest access to the datasets named (Settings > API tokens), its value shown once; the same
 *  token again while it is held under its name. */
export async function basicToken(ctx: HandlerContext, name: string, datasets: string[]): Promise<string> {
  const row = ctx.rowsRaw(TOKEN).find((t) => t.deleted !== true && t.name === name);
  if (row) {
    const again = await tokenValue(ctx, String(row.label));
    if (sha256(ctx, again) === row.sha256) return again;
  }
  const id = ctx.mint(TOKEN);
  const label = `axiom-api-token:${id}`;
  const token = await tokenValue(ctx, label);
  await ctx.record(TOKEN, { name, label, kind: 'basic', datasets, created: ctx.occurredAt, sha256: sha256(ctx, token) }, id);
  return token;
}

/** The held token a request's `Authorization: Bearer` names (the kernel's gate has already refused any other). */
export function tokenOf(ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto' | 'call'>): Row | undefined {
  const value = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!value) return undefined;
  const hash = sha256(ctx, value);
  return ctx.rowsRaw(TOKEN).find((t) => t.deleted !== true && t.sha256 === hash);
}

export const datasetOf = (ctx: Pick<HandlerContext, 'row'>, name: string): Row | undefined => {
  const row = ctx.row(DATASET, name);
  return row && row.deleted !== true ? row : undefined;
};

// source: spec:/components/schemas/ForbiddenError/example "Forbidden"
/** Axiom's error body: `{code, message}`, the code the HTTP status. */
export const axiomError = (status: number, message: string): Response => Response.json({ code: status, message }, { status });
