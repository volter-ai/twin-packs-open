// What the console makes and the pack's other units read: a Redis database (its endpoint, password and two REST
// tokens) and an account's QStash (its token and signing keys). Its pages (../screens) and the World's doors make them.
import { digest, type HandlerContext } from '@volter/world-core';
// what every lane of upstash shares (architecture, "Pack layout"): the vendor's src/semantics/shared.ts
export * from '../../../src/semantics/shared.ts';

export type Row = Record<string, unknown>;

export const DATABASE = 'database';
export const QSTASH_USER = 'qstash_user';

// Where the documentation stops: Upstash names an endpoint as an adjective, an animal and five digits
// (`beloved-stallion-58500`, the Database schema's example); the twin draws them from the minted id.
const ADJECTIVES = ['beloved', 'merry', 'brave', 'calm', 'eager', 'fancy', 'gentle', 'honest', 'jolly', 'lucky', 'noble', 'proud', 'quiet', 'rapid', 'sunny', 'tidy'];
const ANIMALS = ['stallion', 'cat', 'otter', 'heron', 'badger', 'falcon', 'lynx', 'marmot', 'newt', 'osprey', 'panda', 'quail', 'raven', 'seal', 'tapir', 'walrus'];
function endpointFor(id: string): string {
  const h = digest('sha256', `endpoint:${id}`);
  return `${ADJECTIVES[Number.parseInt(h.slice(0, 2), 16) % ADJECTIVES.length]}-${ANIMALS[Number.parseInt(h.slice(2, 4), 16) % ANIMALS.length]}-${10000 + (Number.parseInt(h.slice(4, 10), 16) % 90000)}`;
}

/** The free plan's limits (https://upstash.com/pricing/redis: 256 MB of data, 500K commands a month, 10 MB requests). */
// source: https://upstash.com/docs/redis/overall/pricing "500K"
const FREE = { db_disk_threshold: 268435456, db_request_limit: 500000, db_max_request_size: 10485760, db_max_entry_size: 104857600, db_max_commands_per_second: 10000, db_max_clients: 10000, db_memory_threshold: 268435456 };

/** A Redis database, as the console's Create Database makes it: active at once, its endpoint, a password and the REST
 *  tokens derived from it. Where the documentation stops: a token is `A` and base64 of the database and its password (the
 *  shape of the page's examples); the twin draws it from the minted id. */
// source: https://upstash.com/docs/redis/features/restapi "Upstash by default provides two separate access tokens per database"
export async function makeDatabase(ctx: HandlerContext, input: { owner: string; name: string; region: string }): Promise<Row> {
  const id = ctx.mint('Database');
  // drawn from a secret the World holds (ctx.secret), so no one computes a database's password or tokens from its id
  const password = (await ctx.secret(`upstash-db-password:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
  // p3: keyed by the password drawn from ctx.secret above
  const token = (kind: string): string => Buffer.from(`${kind}${id.replace(/-/g, '').slice(0, 12)}:${digest('sha256', `${kind}:${password}`).slice(0, 32)}`).toString('base64');
  return ctx.write(DATABASE, id, {
    database_id: id, database_name: input.name, region: 'global', primary_region: input.region, primary_members: [input.region], all_members: [input.region], read_regions: [],
    port: 6379, creation_time: Math.floor(Date.parse(ctx.occurredAt) / 1000), state: 'active', endpoint: endpointFor(id), tls: true, type: 'free', ...FREE,
    eviction: false, auto_upgrade: false, consistent: false, modifying_state: '', db_type: 'pebble', db_resource_size: 'S', db_acl_enabled: 'false', db_acl_default_user_status: 'true',
    daily_backup_enabled: false, customer_id: input.owner, user_email: input.owner, password, rest_token: `A${token('rw')}`, read_only_rest_token: `Ag${token('ro')}`, deleted: false,
  }, 'database.create');
}

/** The URL an account's QStash is reached at: its region's (`https://qstash-us-east-1.upstash.io`), or the first
 *  region's own `https://qstash.upstash.io` for eu-central-1. */
// source: https://upstash.com/docs/qstash/howto/multi-region "qstash-us-east-1.upstash.io"
export const qstashUrl = (region: string): string => (region === 'eu-central-1' ? 'https://qstash.upstash.io' : `https://qstash-${region}.upstash.io`);

/** QStash's token for an account: base64 of its email and a secret (the QStashUser schema's example is
 *  `example@upstash.com:…`), the secret drawn from the account's QStash and how many resets it has had. */
const qstashToken = async (ctx: Pick<HandlerContext, 'secret'>, id: string, owner: string, n: number, kind: string): Promise<string> => Buffer.from(`${owner}:${(await ctx.secret(`qstash-${kind}:${id}:${n}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`).toString('base64');
/** A signing key: `sig_` and 28 characters (the console's keys' shape), the n-th the account's QStash made. */
const signingKey = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, id: string, n: number): Promise<string> => `sig_${ctx.crypto.base62From(await ctx.secret(`qstash-signing:${id}:${n}`), 28)}`;

/** An account's QStash, as its owner's first visit to the QStash page makes it in the region picked: its token, and the
 *  current and next signing keys (bookkeeping `_current_signing_key`, `_next_signing_key`). It is on the Pay as you go
 *  plan (`type: 'paid'`): a year's delay (`max_delay`) and two hours for a destination's answer (`timeout`, seconds). */
// source: https://upstash.com/pricing/qstash "Pay as you go"
// source: https://upstash.com/pricing/qstash "Max HTTP Response Duration"
// source: https://upstash.com/pricing/qstash "Max HTTP response duration: 2 hours"
// source: https://upstash.com/pricing/qstash "Max delay: 1 year"
// source: spec:/components/schemas/QStashUser "Request timeout in seconds"
const PAY_AS_YOU_GO = { type: 'paid', max_retries: 999, max_delay: 31536000, timeout: 7200 } as const;
export async function openQStash(ctx: HandlerContext, input: { owner: string; region: string }): Promise<Row> {
  const held = ctx.rowsRaw(QSTASH_USER).find((q) => q.customer_id === input.owner && q.deleted !== true);
  if (held) return held;
  const id = ctx.mint('QStashUser');
  await ctx.write(QSTASH_USER, id, {
    id, customer_id: input.owner, created_by: input.owner, token: await qstashToken(ctx, id, input.owner, 0, 'rw'), read_only_token: await qstashToken(ctx, id, input.owner, 0, 'ro'),
    active: true, state: 'active', ...PAY_AS_YOU_GO, region: input.region, creation_time: Math.floor(Date.parse(ctx.occurredAt) / 1000),
    _url: qstashUrl(input.region), _current_signing_key: await signingKey(ctx, id, 1), _next_signing_key: await signingKey(ctx, id, 2), deleted: false,
  }, 'qstash_user.create');
  return ctx.rowsRaw(QSTASH_USER).find((q) => q.id === id)!;
}

/** How many times an account's QStash has had its token reset, or its keys rolled: its history's writes of each. */
const times = (ctx: HandlerContext, q: Row, operation: string): number => ctx.history(QSTASH_USER, String(q.id)).filter((w) => w.operation === operation).length;

/** Reset token: a new token, the old one refused from then on ("the old token will be invalidated"). */
// source: https://upstash.com/docs/qstash/howto/reset-token "Reset token"
export async function resetQStashToken(ctx: HandlerContext, q: Row): Promise<void> {
  const n = times(ctx, q, 'qstash_user.reset_token') + 1;
  await ctx.write(QSTASH_USER, String(q.id), { token: await qstashToken(ctx, String(q.id), String(q.customer_id), n, 'rw'), read_only_token: await qstashToken(ctx, String(q.id), String(q.customer_id), n, 'ro') }, 'qstash_user.reset_token');
}

/** Roll keys: "currentKey = nextKey", and a new next key made (the account's third key on its first roll). */
// source: https://upstash.com/docs/qstash/howto/roll-signing-keys "currentKey = nextKey"
export async function rollSigningKeys(ctx: HandlerContext, q: Row): Promise<void> {
  const n = times(ctx, q, 'qstash_user.roll_keys') + 3;
  await ctx.write(QSTASH_USER, String(q.id), { _current_signing_key: q._next_signing_key, _next_signing_key: await signingKey(ctx, String(q.id), n) }, 'qstash_user.roll_keys');
}
