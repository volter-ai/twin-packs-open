// What every lane of PostHog shares (the API, ingest): its projects with their project tokens, the personal API keys
// the API is read with, and what capture keeps: each event as the SDK sent it, and the persons its distinct ids make.
//
// A project (PostHog's team) has a numeric id and a project token (`phc_...`) its SDKs capture with; a personal API key
// (`phx_...`) reads the private API with the scopes it was made with. The World keeps a key by its SHA-256 and issues it
// through its one issuance door (ctx.issueKey), so no one computes it and a reset issues the same.
//
// Capture keeps each event in one write of the `event` resource, as the events API answers it (`id`, `distinct_id`,
// `properties`, `event`, `timestamp`, `elements`, `elements_chain`), with the event as the SDK sent it (`_payload`, its
// properties whole), the request's `sent_at` (`_sent_at`), its project (`_project`: the id of the `project` it is under, as a string, the one form a parent's id takes) and the person it was linked to
// (`_person`). A person is one `person` write per change: its distinct ids, properties and whether it is identified.
// Which person a distinct id names is a `_distinct_id` subject of its own, written when an id joins a person.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>;

/** A project (PostHog's team), the vendor's own record as its projects API answers it (ProjectBackwardCompat): its id,
 *  project_id, name, project token (`api_token`) and creation time; the World's private label it draws the token from. */
export const PROJECT = 'project';
export const KEY = '_personal_key';
export const EVENT = 'event';
export const PERSON = 'person';
/** A distinct ID's link to its person (PostHog's `posthog_persondistinctid`): the vendor's record, in the World's
 *  history, so a run's evidence joins a person's IDs (ADR 0036 §8). */
export const DISTINCT_ID = 'person_distinct_id';
export const EVENT_DELETION = '_event_deletion';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');
const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);

// ── the account: a project, its token, and personal API keys ─────────────────────────────────────

// source: https://posthog.com/docs/api "Personal API keys"
// Where the documentation stops: a token's opaque length is a World choice; PostHog's project tokens and personal keys
// are `phc_` and `phx_` followed by letters and digits.
export const PROJECT_TOKEN_FORMAT = { prefix: 'phc_', length: 47, alphabet: 'base62' } as const;
export const PERSONAL_KEY_FORMAT = { prefix: 'phx_', length: 47, alphabet: 'base62' } as const;
/** A project's numeric id (PostHog's team id). Where the documentation stops: its width is a World choice. */
export const PROJECT_ID_FORMAT = { prefix: '1', length: 6, alphabet: 'digits' } as const;

/** The account's project, made the first time with its project token, both from the World's issuance door (purpose
 *  `project`), the same at every boot and after every reset, and answered as it stands after. */
export async function makeProject(ctx: HandlerContext, name: string): Promise<{ project: Row; token: string }> {
  const held = ctx.rowsRaw(PROJECT).find((p) => p.name === name);
  if (held) return { project: held, token: String(held.api_token) };
  const id = await ctx.issueKeyId('project', PROJECT_ID_FORMAT), token = await ctx.issueKey('project', PROJECT_TOKEN_FORMAT);
  await ctx.write(PROJECT, id, { id: Number(id), project_id: Number(id), name, api_token: token, created_at: ctx.occurredAt }, 'project.create');
  return { project: ctx.row(PROJECT, id)!, token };
}

/** A personal API key of the project's organization, with its scopes, from the World's issuance door (purpose
 *  `personal-api-key:<name>`), shown once and answered again while held. */
export async function personalKey(ctx: HandlerContext, project: Row, name: string, scopes: string[]): Promise<string> {
  const key = await ctx.issueKey(`personal-api-key:${name}`, PERSONAL_KEY_FORMAT);
  if (!ctx.rowsRaw(KEY).some((k) => k.sha256 === sha256(ctx, key))) await ctx.record(KEY, { name, project: project.id, scopes, sha256: sha256(ctx, key), created_at: ctx.occurredAt }, undefined, 'personal_api_key.create');
  return key;
}

/** The personal API key a request's `Authorization: Bearer` names (the manifest's auth gate has checked it is held). */
export function bearerKey(ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto' | 'call'>): Row | undefined {
  const value = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!value) return undefined;
  const hash = sha256(ctx, value);
  return ctx.rowsRaw(KEY).find((k) => k.deleted !== true && k.sha256 === hash);
}

/** Whether a key's scopes cover one: the scope itself, or the same object's `:write` for a `:read` (`*` covers all). */
export function covers(key: Row, scope: string): boolean {
  const held = (key.scopes as string[] | undefined) ?? [];
  const [object] = scope.split(':');
  return held.includes('*') || held.includes(scope) || (scope.endsWith(':read') && held.includes(`${object}:write`));
}

export const projectById = (ctx: Reader, id: string): Row | undefined => live(ctx.row(PROJECT, id));
export const projectByToken = (ctx: Reader, token: string): Row | undefined =>
  ctx.rowsRaw(PROJECT).find((p) => p.deleted !== true && p.api_token === token);

// ── persons: distinct ids, properties and merges ─────────────────────────────────────────────

const mapKey = (project: Row, distinctId: string): string => `${String(project.id)}:${distinctId}`;

/** The live person a distinct id names in a project, if any. */
export function personOf(ctx: Reader, project: Row, distinctId: string): Row | undefined {
  const link = live(ctx.row(DISTINCT_ID, mapKey(project, distinctId)));
  return link ? live(ctx.row(PERSON, String(link.person))) : undefined;
}

/** A person's distinct ids, in the order they joined it. */
export const distinctIdsOf = (ctx: Reader, person: Row): string[] =>
  ctx.rowsRaw(DISTINCT_ID).filter((d) => d.deleted !== true && d.person === person.id).map((d) => String(d.distinct_id));

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/nodejs/src/common/persons/person-utils.ts "const BARE_CASE_INSENSITIVE_ILLEGAL_IDS = ["
const ILLEGAL_ANY_CASE = ['anonymous', 'guest', 'distinctid', 'distinct_id', 'id', 'not_authenticated', 'email', 'undefined', 'true', 'false'];
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/nodejs/src/common/persons/person-utils.ts "const BARE_CASE_SENSITIVE_ILLEGAL_IDS = ['[object Object]', 'NaN', 'None', 'none', 'null', '0', 'undefined']"
const ILLEGAL_CASED = ['[object Object]', 'NaN', 'None', 'none', 'null', '0', 'undefined'];
const quoted = (ids: string[]): string[] => ids.flatMap((id) => [id, `'${id}'`, `"${id}"`]);
/** A distinct id PostHog will not merge a person by. */
/** An event or person UUID as PostHog reads one: hex, dashes optional. */
export const uuidLike = (s: string): boolean => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(s);

const illegalId = (id: string): boolean =>
  id.trim() === '' || quoted(ILLEGAL_ANY_CASE).includes(id.toLowerCase()) || quoted(ILLEGAL_CASED).includes(id);

async function link(ctx: HandlerContext, project: Row, distinctId: string, person: Row): Promise<void> {
  await ctx.write(DISTINCT_ID, mapKey(project, distinctId), { _project: String(project.id), distinct_id: distinctId, person: person.id }, 'person_distinct_id.set');
}

async function newPerson(ctx: HandlerContext, project: Row, distinctIds: string[], at: string, identified: boolean): Promise<Row> {
  const id = ctx.mint(PERSON);
  const pk = Number(await ctx.issue('_seq_person'));
  const person = await ctx.write(PERSON, id, { id, uuid: id, _pk: pk, _project: String(project.id), properties: {}, is_identified: identified, created_at: at, _last_seen_at: at }, 'person.create');
  for (const d of distinctIds) await link(ctx, project, d, person);
  return ctx.row(PERSON, id)!;
}

/** The property operations an event carries: `$set`, `$set_once` and `$unset`. A `$set` event also sets its
 *  properties' `$set`; `$identify` its `$set` and `$set_once` likewise. */
// source: https://posthog.com/docs/product-analytics/person-properties "Using set replaces any property value that may have been set on a person profile. In contrast, set_once only sets the property if it has never been set before."
// source: https://posthog.com/docs/product-analytics/person-properties "In other SDKs, send an event with a $unset array of property keys."
function applyProperties(current: Row, properties: Row): Row {
  const next = { ...current };
  for (const [k, v] of Object.entries(obj(properties.$set_once))) if (!(k in next)) next[k] = v;
  Object.assign(next, obj(properties.$set));
  for (const k of Array.isArray(properties.$unset) ? properties.$unset : Object.keys(obj(properties.$unset))) delete next[String(k)];
  return next;
}

/** Merge `other`'s person into `into`'s: the identify and alias rules. Answers the person the event is linked to. */
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/nodejs/src/ingestion/common/persons/person-merge-service.ts "the merge is blocked if the other distinct id"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/nodejs/src/ingestion/common/persons/person-merge-service.ts "if person property was defined for both we'll use"
// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/nodejs/src/ingestion/common/persons/person-merge-postgres.ts "$merge_dangerously has no restrictions; $create_alias and $identify"
async function merge(ctx: HandlerContext, project: Row, otherId: string, intoId: string, at: string, dangerously: boolean): Promise<Row | undefined> {
  // "No reason to alias person against itself." (person-merge-service.ts)
  if (otherId === intoId || illegalId(otherId) || illegalId(intoId)) return personOf(ctx, project, intoId);
  const into = personOf(ctx, project, intoId);
  const other = personOf(ctx, project, otherId);
  if (!into && !other) {
    const made = await newPerson(ctx, project, [intoId, otherId], at, true);
    return made;
  }
  if (into && !other) {
    await link(ctx, project, otherId, into);
    return await ctx.write(PERSON, String(into.id), { is_identified: true }, 'person.update');
  }
  if (!into && other) {
    await link(ctx, project, intoId, other);
    return await ctx.write(PERSON, String(other.id), { is_identified: true }, 'person.update');
  }
  if (into!.id === other!.id) return await ctx.write(PERSON, String(into!.id), { is_identified: true }, 'person.update');
  // an identified person is not merged into another, but by $merge_dangerously: the event stays with `into`
  if (other!.is_identified === true && !dangerously) return into;
  for (const d of distinctIdsOf(ctx, other!)) await link(ctx, project, d, into!);
  const created = String(other!.created_at) < String(into!.created_at) ? other!.created_at : into!.created_at;
  await ctx.write(PERSON, String(into!.id), { properties: { ...obj(other!.properties), ...obj(into!.properties) }, is_identified: true, created_at: created }, 'person.merge');
  await ctx.remove(PERSON, String(other!.id), 'person.merge');
  return ctx.row(PERSON, String(into!.id));
}

/** The person effects of one captured event, as PostHog's ingestion makes them: an identify or alias merges, and the
 *  event's property operations change the person; an event sent with `$process_person_profile: false` makes and
 *  changes no person, but is still linked to the one its distinct id already names. */
// source: https://posthog.com/docs/api/capture "If the ID already belongs to a person, the event is still linked to that person and counts as an identified event."
export async function personEffects(ctx: HandlerContext, project: Row, e: Row, at: string): Promise<Row | undefined> {
  const distinctId = String(e.distinct_id);
  const properties = obj(e.properties);
  const personless = properties.$process_person_profile === false;
  if (personless) return personOf(ctx, project, distinctId);
  let person: Row | undefined;
  if ((e.event === '$create_alias' || e.event === '$merge_dangerously') && properties.alias !== undefined && properties.alias !== null) {
    person = await merge(ctx, project, String(properties.alias), distinctId, at, e.event === '$merge_dangerously');
  } else if (e.event === '$identify' && properties.$anon_distinct_id !== undefined && properties.$anon_distinct_id !== null) {
    person = await merge(ctx, project, String(properties.$anon_distinct_id), distinctId, at, false);
  }
  person ??= personOf(ctx, project, distinctId) ?? await newPerson(ctx, project, [distinctId], at, false);
  const ops = e.event === '$set' ? { ...properties, $set: { ...obj(properties.$set) } } : properties;
  const next = applyProperties(obj(person.properties), ops);
  const seen = String(person._last_seen_at ?? '') > at ? person._last_seen_at : at;
  return await ctx.write(PERSON, String(person.id), { properties: next, _last_seen_at: seen }, 'person.update');
}

// ── answers ─────────────────────────────────────────────────────────────────────────────────

/** A time as Django REST framework writes a UTC datetime (Python's isoformat): `+00:00`, microseconds when not zero. */
export function pyIso(t: unknown): string {
  const d = new Date(String(t));
  if (Number.isNaN(d.getTime())) return String(t);
  const base = d.toISOString().slice(0, 19);
  const ms = d.getUTCMilliseconds();
  return `${base}${ms ? `.${String(ms * 1000).padStart(6, '0')}` : ''}+00:00`;
}

// source: https://raw.githubusercontent.com/PostHog/posthog/80d277a5cd28d8d7bb4f8a44fc20b756d14a48c4/posthog/api/person.py "Prefer non-UUID distinct IDs (presumably from user identification) over UUIDs"
// Where the documentation stops: the default display-name properties are PostHog's constant; email, name and username
// are the ones its event serializer names (posthog/models/event/util.py).
export function personName(person: Row, distinctIds: string[]): string {
  const p = obj(person.properties);
  for (const k of ['email', 'name', 'username']) if (p[k]) return String(p[k]);
  return [...distinctIds].sort((a, b) => Number(uuidLike(a)) - Number(uuidLike(b)))[0] ?? String(person._pk);
}
