// What the stream and the engine share: the private transport a command travels on from the wire to the pack's
// fetch, so each command is a request with the World's instant.
import { privateTransportKey, type HandlerContext } from '@volter/world-core';
import { replicaHandshake, type SingleMemberHandshake } from '../engine/replica-handshake.ts';
import { NotServed, at, dateOf, identity, isWrapper, matches, numberOf, project, type Ejson } from '../engine/match.ts';
import { driverFields, inEnvelope } from '../engine/table.ts';

export type { HandlerContext };
export const wireKey = (): string => privateTransportKey('mongodb-wire');
export const WIRE_HEADER = 'x-volter-mongodb-wire';
export type { Ejson };

// What a command document means, over the World's tree. Commands and replies are canonical extended JSON, so every
// number carries its BSON kind from the wire to the tree and back. Each rule cites the recorded answer of the vendor's
// own server it was read from (spec/recordings/); a command this does not answer is the gap, and a field of a served
// command that this has no rule for is refused, never ignored. The computation it needs without the World is in
// ../engine/ (match.ts, table.ts, replica-handshake.ts).
const int = (n: number): Ejson => ({ $numberInt: String(n) });
const long = (n: number): Ejson => ({ $numberLong: String(n) });
const double = (n: number): Ejson => ({ $numberDouble: Number.isInteger(n) ? n.toFixed(1) : String(n) });
// source: recording:insert-two.json "$numberDouble"
const OK = double(1);
const FAILED = double(0);

/** The vendor's own refusal of a command: an error document. */
class Refusal extends Error { constructor(readonly document: Ejson) { super(String(document.errmsg)); } }
const refusal = (code: number, codeName: string, errmsg: string): Refusal => new Refusal({ ok: FAILED, errmsg, code: int(code), codeName });

// ── values ──────────────────────────────────────────────────────────────────────────────────────────────────
/** A key's value as the server writes it in a duplicate-key message. */
// source: recording:insert-unique-violation.json "E11000 duplicate key error collection: ask_insert_unique_violation.people index: email_1 dup key: { email:"
// source: recording:insert-duplicate-id.json "dup key: { _id: 1 }"
function shown(value: unknown): string {
  if (numberOf(value) !== undefined) { const kinds = value as Ejson; return String(kinds.$numberInt ?? kinds.$numberDouble ?? kinds.$numberLong); }
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return 'null';
  // where the recordings stop: an ObjectId, a date or a document as a key's value in this message
  throw new NotServed(`a duplicate-key message for a key of this kind (${JSON.stringify(value).slice(0, 60)})`);
}
/** The order of two values in a sort: a missing field and null are equal and come first, then numbers by value
 *  whatever their kind, then strings. */
// source: recording:find-sorted.json "firstBatch"
function compare(a: unknown, b: unknown): number {
  const rank = (value: unknown): number => {
    if (value === null || value === undefined) return 1;
    if (numberOf(value) !== undefined) return 2;
    if (typeof value === 'string') return 3;
    // ObjectIds among themselves, by their bytes; where the recordings stop: an ObjectId beside another kind
    // source: recording:distinct-basic.json "values"
    if (value !== null && typeof value === 'object' && typeof (value as Ejson).$oid === 'string') return 7;
    // dates among themselves, by their instant; where the recordings stop: a date beside another kind, which is
    // refused below instead of being given a place
    // source: recording:fam-sorted-ascending.json "value"
    // source: recording:fam-sorted-descending.json "value"
    if (dateOf(value) !== undefined) return 9;
    // where the recording stops: a document, an array or a boolean as a sort key
    throw new NotServed(`a sort over a value of this kind (${JSON.stringify(value).slice(0, 60)})`);
  };
  const ra = rank(a), rb = rank(b);
  if ((ra === 9) !== (rb === 9) && ra !== 1 && rb !== 1) throw new NotServed('a sort over a date beside a value of another kind');
  if (ra !== rb) return ra - rb;
  if (ra === 9) return dateOf(a)! - dateOf(b)!;
  if (ra === 2) return numberOf(a)! - numberOf(b)!;
  // where the recording stops: two strings were compared that differ in their first byte only
  if (ra === 3) return a === b ? 0 : (a as string) < (b as string) ? -1 : 1;
  if (ra === 7) { const x = String((a as Ejson).$oid), y = String((b as Ejson).$oid); return x === y ? 0 : x < y ? -1 : 1; }
  return 0;
}
// ── the tree ────────────────────────────────────────────────────────────────────────────────────────────────
type Index = { name: string; spec: Ejson };
const collectionId = (database: string, collection: string): string => `${database}.${collection}`;
const collectionExists = (ctx: HandlerContext, database: string, collection: string): boolean => ctx.row('collection', collectionId(database, collection)) !== undefined;
const ensureCollection = async (ctx: HandlerContext, database: string, collection: string, operation: string): Promise<boolean> => {
  if (collectionExists(ctx, database, collection)) return false;
  await ctx.write('collection', collectionId(database, collection), { database, name: collection }, operation);
  return true;
};
const documentRowId = (ctx: HandlerContext, database: string, collection: string, id: unknown): string => `${database}.${collection}:${ctx.crypto.sha256(identity(id))}`;
/** A collection's documents, in the order they were written. An index that expires documents is kept and listed
 *  with its option, which is recorded; no document is expired, since when the server removes one is not recorded. */
// source: recording:create-index-options.json "expireAfterSeconds"
const documentsOf = (ctx: HandlerContext, database: string, collection: string): Ejson[] =>
  ctx.rowsRaw('document').filter((row) => row.database === database && row.collection === collection).map((row) => JSON.parse(String(row.document)) as Ejson);
const indexesOf = (ctx: HandlerContext, database: string, collection: string): Index[] =>
  ctx.rowsRaw('index').filter((row) => row.database === database && row.collection === collection).map((row) => ({ name: String(row.name), spec: JSON.parse(String(row.spec)) as Ejson }));
// every collection has the index on _id, which the server lists first
// source: recording:create-collection.json "_id_"
const ID_INDEX: Ejson = { v: int(2), key: { _id: int(1) }, name: '_id_' };

// ── a command's fields ──────────────────────────────────────────────────────────────────────────────────────
// the envelope fields answered here: the database, and the session id a driver sends with every command and a
// standalone server accepts
const ENVELOPE_SERVED = new Set(['$db', 'lsid']);
// the name the server gives each command's request in its refusal of an unknown field
// source: recording:find-unknown-field.json "BSON field 'FindCommandRequest.noSuchField' is an unknown field."
// source: recording:insert-unknown-field.json "BSON field 'insert.noSuchField' is an unknown field."
const REQUEST_NAME: Record<string, string> = { find: 'FindCommandRequest', insert: 'insert' };
/** Every field of the command is one this engine has a rule for; a field the driver cannot send is refused as the
 *  server refuses it; a field the driver can send and this has no rule for stops the command as not served. */
function fields(command: Ejson, name: string, served: readonly string[]): void {
  // source: recording:transaction-standalone.json "Transaction numbers are only allowed on a replica set member or mongos"
  if (command.txnNumber !== undefined || command.startTransaction !== undefined || command.autocommit !== undefined) throw refusal(20, 'IllegalOperation', 'Transaction numbers are only allowed on a replica set member or mongos');
  const known = driverFields(name);
  for (const field of Object.keys(command)) {
    if (field === name || served.includes(field) || ENVELOPE_SERVED.has(field)) continue;
    if (known.has(field) || inEnvelope(field)) throw new NotServed(`${name}.${field}`);
    const request = REQUEST_NAME[name];
    if (!request) throw new NotServed(`the refusal of an unknown field on ${name} (its request's name is not recorded)`);
    throw refusal(40415, 'Location40415', `BSON field '${request}.${field}' is an unknown field.`);
  }
}

// ── the commands ────────────────────────────────────────────────────────────────────────────────────────────
type Command = (ctx: HandlerContext, database: string, command: Ejson) => Promise<Ejson> | Ejson;

// source: recording:hello.json "isWritablePrimary"
const hello: Command = (ctx) => ({
  isWritablePrimary: true,
  // a server's process id is random; a World's is derived, so two Worlds made alike answer alike
  topologyVersion: { processId: { $oid: ctx.crypto.sha256('mongodb:process').slice(0, 24) }, counter: long(0) },
  // source: recording:hello.json "maxBsonObjectSize"
  maxBsonObjectSize: int(16777216), maxMessageSizeBytes: int(48000000), maxWriteBatchSize: int(100000),
  // the World's instant, where the server gives the machine's
  localTime: { $date: { $numberLong: String(Date.parse(ctx.occurredAt)) } },
  logicalSessionTimeoutMinutes: int(30), connectionId: int(1), minWireVersion: int(0), maxWireVersion: int(21), readOnly: false, ok: OK,
});
// the legacy name a driver's first handshake uses; where the recording stops: the legacy reply's own fields
// (ismaster, helloOk) are the driver's expectation, read in its handshake, not recorded
const legacyHello: Command = async (ctx, database, command) => ({ ...(await hello(ctx, database, command)), ismaster: true, helloOk: true });

/** The options of an index the server keeps, in the order it lists them. */
// source: recording:create-index-options.json "\"background\":true,\"unique\":true,\"sparse\":true"
// where the recording stops: sparse, partialFilterExpression and expireAfterSeconds were not recorded together
const INDEX_OPTIONS = ['background', 'unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds'] as const;
function storedIndex(given: Ejson): Ejson {
  for (const option of Object.keys(given)) if (!['key', 'name', ...INDEX_OPTIONS].includes(option)) throw new NotServed(`an index's ${option}`);
  if (typeof given.name !== 'string' || given.key === null || typeof given.key !== 'object') throw new NotServed('an index with no name or key');
  const spec: Ejson = { v: int(2), key: given.key, name: given.name };
  for (const option of INDEX_OPTIONS) if (given[option] !== undefined && given[option] !== false) spec[option] = given[option];
  return spec;
}

/** The index a document would break, by the server's rule for a unique key; undefined when it breaks none. */
function violated(candidate: Ejson, others: Ejson[], indexes: Index[]): Index | undefined {
  for (const index of [{ name: '_id_', spec: ID_INDEX }, ...indexes.filter((held) => held.spec.unique === true)]) {
    const keyFields = Object.keys(index.spec.key as Ejson);
    /** Whether the index holds the document at all. */
    const holds = (document: Ejson): boolean => {
      // a sparse index holds no document that lacks its field, so two such documents never meet in it
      // source: recording:sparse-unique-missing-twice.json "writeErrors"
      if (index.spec.sparse === true) {
        // where the recording stops: a sparse index over several fields
        if (keyFields.length !== 1) throw new NotServed('a sparse unique index over several fields');
        if (at(document, keyFields[0]!) === undefined) return false;
      }
      // a partial index holds only the documents its filter matches
      // source: recording:partial-unique.json "writeErrors"
      // (the filter is a filter: the rules a find matches by; recorded for "the field exists", and LibreChat's
      // other partial filters are equalities and their conjunctions, which the filter recordings cover)
      if (index.spec.partialFilterExpression !== undefined && !matches(document, index.spec.partialFilterExpression as Ejson)) return false;
      return true;
    };
    if (!holds(candidate)) continue;
    // a field the document lacks is null in its key, so under a plain unique index two documents lacking it meet
    // source: recording:unique-missing-twice.json "dup key: { g: null }"
    const key = (document: Ejson): string => keyFields.map((field) => identity(at(document, field))).join('|');
    const mine = key(candidate);
    if (others.some((other) => holds(other) && key(other) === mine)) return index;
  }
  return undefined;
}
// source: recording:insert-duplicate-id.json "E11000 duplicate key error collection: ask_insert_duplicate_id.people index: _id_ dup key: { _id: 1 }"
function duplicateKey(position: number, database: string, collection: string, index: Index, document: Ejson): Ejson {
  const keyFields = Object.keys(index.spec.key as Ejson);
  return {
    index: int(position), code: int(11000),
    errmsg: `E11000 duplicate key error collection: ${database}.${collection} index: ${index.name} dup key: { ${keyFields.map((field) => `${field}: ${shown(at(document, field))}`).join(', ')} }`,
    keyPattern: index.spec.key, keyValue: Object.fromEntries(keyFields.map((field) => [field, at(document, field) ?? null])),
  };
}

/** The ObjectId a World gives a document sent with none: the request's instant, a value derived for the World, and
 *  the count of documents it has written, where a server's is its clock, a value random per process and a counter. */
// source: recording:insert-no-id.json "$oid"
const madeId = (ctx: HandlerContext, nth: number): Ejson => ({ $oid: `${Math.floor(Date.parse(ctx.occurredAt) / 1000).toString(16).padStart(8, '0')}${ctx.crypto.sha256('mongodb:process').slice(0, 10)}${(nth & 0xffffff).toString(16).padStart(6, '0')}` });

const UPDATE_OPERATORS = ['$set', '$setOnInsert', '$unset', '$addToSet', '$inc'];
/** A document after an update's operators. A field that is there is changed where it stands; the fields that are new
 *  are added after the document's own, in the alphabetical order of their names, whichever operator made them. */
// source: recording:update-set-new-fields-order.json "alpha"
// source: recording:update-upsert-insert.json "upserted"
function updated(document: Ejson, spec: Ejson, inserting: boolean): Ejson {
  if (Array.isArray(spec)) throw new NotServed('an update that is a pipeline');
  const operators = Object.keys(spec);
  if (!operators.length || operators.some((operator) => !operator.startsWith('$'))) throw new NotServed('an update that is a replacement document');
  for (const operator of operators) if (!UPDATE_OPERATORS.includes(operator)) throw new NotServed(`the update operator ${operator}`);
  const next: Ejson = { ...document }, added: Ejson = {};
  const put = (field: string, value: unknown): void => {
    if (field.includes('.') || field.includes('$')) throw new NotServed(`an update of a dotted or positional path (${field})`);
    if (field in next) next[field] = value; else added[field] = value;
  };
  for (const [field, value] of Object.entries((spec.$set ?? {}) as Ejson)) put(field, value);
  // source: recording:update-upsert-existing.json "nModified"
  if (inserting) for (const [field, value] of Object.entries((spec.$setOnInsert ?? {}) as Ejson)) put(field, value);
  // source: recording:update-unset.json "nModified"
  for (const field of Object.keys((spec.$unset ?? {}) as Ejson)) { if (field.includes('.')) throw new NotServed(`an $unset of a dotted path (${field})`); delete next[field]; delete added[field]; }
  // source: recording:update-addtoset-each.json "nModified"
  for (const [field, value] of Object.entries((spec.$addToSet ?? {}) as Ejson)) {
    // one value added to the set is the set of that one value (LibreChat adds each message's ObjectId so)
    // source: recording:librechat-story.json "$addToSet"
    const each = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && Array.isArray((value as Ejson).$each) ? (value as Ejson).$each as unknown[] : [value];
    const held = field in next ? next[field] : added[field];
    if (held !== undefined && !Array.isArray(held)) throw new NotServed('$addToSet on a field that is not an array');
    const set = [...((held as unknown[] | undefined) ?? [])];
    for (const item of each) if (!set.some((have) => identity(have) === identity(item))) set.push(item);
    put(field, set);
  }
  // the sum keeps the wider of the two number types (int, long, double), and an int that overflows becomes a long;
  // a field not there is set to the increment (LibreChat charges a balance so)
  // source: recording:librechat-story.json "$inc"
  for (const [field, by] of Object.entries((spec.$inc ?? {}) as Ejson)) {
    const held = field in next ? next[field] : added[field];
    const step = numberOf(by), have = held === undefined ? 0 : numberOf(held);
    if (step === undefined || have === undefined) throw new NotServed(`an $inc of ${field} that is not a number`);
    const kind = (value: unknown): number => value && typeof value === 'object' ? ('$numberDouble' in value ? 2 : '$numberLong' in value ? 1 : 0) : 0;
    const wider = Math.max(held === undefined ? 0 : kind(held), kind(by)), sum = have + step;
    put(field, wider === 2 ? { $numberDouble: String(sum) } : wider === 1 || sum > 2147483647 || sum < -2147483648 ? { $numberLong: String(sum) } : { $numberInt: String(sum) });
  }
  for (const field of Object.keys(added).sort()) next[field] = added[field];
  return next;
}
/** The document an upsert writes when its filter matches nothing: the filter's equalities, in the filter's order,
 *  then the update. Its _id is the filter's or the update's, else one the World makes; it comes first. */
// source: recording:update-upsert-insert.json "upserted"
// source: recording:update-upsert-own-id.json "upserted"
function upsertDocument(ctx: HandlerContext, filter: Ejson, spec: Ejson, nth: number): Ejson {
  const seed: Ejson = {};
  for (const [field, condition] of Object.entries(filter)) {
    if (field.startsWith('$')) throw new NotServed(`an upsert whose filter has ${field}`);
    const operators = condition !== null && typeof condition === 'object' && !Array.isArray(condition) && numberOf(condition) === undefined && Object.keys(condition).some((key) => key.startsWith('$') && !['$oid', '$date'].includes(key));
    if (!operators) seed[field] = condition;
  }
  const set = (spec.$set ?? {}) as Ejson, onInsert = (spec.$setOnInsert ?? {}) as Ejson;
  for (const named of [set._id, onInsert._id]) {
    if (named === undefined) continue;
    if (seed._id !== undefined && identity(seed._id) !== identity(named)) throw new NotServed('an upsert whose update names another _id than its filter');
    seed._id = named;
  }
  const { _id: _a, ...restSet } = set, { _id: _b, ...restOnInsert } = onInsert;
  const body = updated(seed, { ...spec, ...(spec.$set ? { $set: restSet } : {}), ...(spec.$setOnInsert ? { $setOnInsert: restOnInsert } : {}) }, true);
  const { _id, ...rest } = body;
  return { _id: _id ?? madeId(ctx, nth), ...rest };
}

const commands: Record<string, Command> = {
  hello, ismaster: legacyHello, isMaster: legacyHello,

  // source: recording:create-collection.json "ok"
  // source: recording:create-collection-again.json "ok"
  async create(ctx, database, command) {
    fields(command, 'create', []);
    // made a second time with the same (no) options, the server answers ok again
    await ensureCollection(ctx, database, String(command.create), 'create');
    return { ok: OK };
  },

  // source: recording:create-index-unique.json "createdCollectionAutomatically"
  // source: recording:create-index-again.json "all indexes already exist"
  async createIndexes(ctx, database, command) {
    fields(command, 'createIndexes', ['indexes']);
    const collection = String(command.createIndexes);
    const made = await ensureCollection(ctx, database, collection, 'createIndexes');
    const held = indexesOf(ctx, database, collection), before = held.length + 1;
    let after = before;
    for (const given of (command.indexes ?? []) as Ejson[]) {
      const spec = storedIndex(given);
      if (held.some((index) => index.name === spec.name)) continue;
      await ctx.write('index', `${collectionId(database, collection)}:${String(spec.name)}`, { database, collection, name: spec.name, spec: JSON.stringify(spec) }, 'createIndexes');
      held.push({ name: String(spec.name), spec }); after += 1;
    }
    if (after === before) return { numIndexesBefore: int(before), numIndexesAfter: int(after), note: 'all indexes already exist', ok: OK };
    // source: recording:create-index-on-existing.json "createdCollectionAutomatically"
    return { numIndexesBefore: int(before), numIndexesAfter: int(after), createdCollectionAutomatically: made, ok: OK };
  },

  // source: recording:list-indexes.json "firstBatch"
  // source: recording:list-indexes-missing.json "ns does not exist: ask_list_indexes_missing.nobody"
  listIndexes(ctx, database, command) {
    fields(command, 'listIndexes', ['cursor']);
    // source: recording:list-indexes-cursor.json "firstBatch"
    if (command.cursor !== undefined && Object.keys(command.cursor as Ejson).length) throw new NotServed('listIndexes with cursor options');
    const collection = String(command.listIndexes);
    if (!collectionExists(ctx, database, collection)) throw refusal(26, 'NamespaceNotFound', `ns does not exist: ${database}.${collection}`);
    return { cursor: { id: long(0), ns: `${database}.${collection}`, firstBatch: [ID_INDEX, ...indexesOf(ctx, database, collection).map((index) => index.spec)] }, ok: OK };
  },

  // source: recording:insert-two.json "n"
  // source: recording:insert-duplicate-id.json "writeErrors"
  async insert(ctx, database, command) {
    fields(command, 'insert', ['documents', 'ordered']);
    const collection = String(command.insert), given = (command.documents ?? []) as Ejson[];
    if (command.ordered === false) throw new NotServed('an unordered insert');
    await ensureCollection(ctx, database, collection, 'insert');
    const held = documentsOf(ctx, database, collection), indexes = indexesOf(ctx, database, collection), writeErrors: Ejson[] = [];
    let n = 0;
    const minted = ctx.rowsRaw('document').length;
    for (const [position, sent] of given.entries()) {
      // a document sent with no _id is given one by the server, an ObjectId, put first in the document. A server's
      // is its clock, a value random per process and a counter; a World's is the request's instant, a value derived
      // for the World and the count of documents it has written, so two Worlds given the same history answer alike.
      // source: recording:insert-no-id.json "$oid"
      const document: Ejson = '_id' in sent ? sent : { _id: madeId(ctx, minted + position + 1), ...sent };
      const broken = violated(document, held, indexes);
      // an ordered insert stops at its first refused document; the ones before it stay written
      if (broken) { writeErrors.push(duplicateKey(position, database, collection, broken, document)); break; }
      await ctx.write('document', documentRowId(ctx, database, collection, document._id), { database, collection, document: JSON.stringify(document) }, 'insert');
      held.push(document); n += 1;
    }
    return { n: int(n), ...(writeErrors.length ? { writeErrors } : {}), ok: OK };
  },

  // source: recording:update-set.json "nModified"
  // source: recording:update-multi.json "nModified"
  // source: recording:update-first-of-two.json "nModified"
  // source: recording:update-no-match.json "nModified"
  async update(ctx, database, command) {
    fields(command, 'update', ['updates', 'ordered']);
    const collection = String(command.update);
    // an ordered update stops at the first statement the server refuses; an unordered one goes on to the rest
    // source: recording:update-ordered-stops.json "upserted"
    // source: recording:update-unordered.json "upserted"
    const stops = command.ordered !== false;
    await ensureCollection(ctx, database, collection, 'update');
    const indexes = indexesOf(ctx, database, collection), upserted: Ejson[] = [], writeErrors: Ejson[] = [];
    let n = 0, nModified = 0;
    for (const [position, statement] of ((command.updates ?? []) as Ejson[]).entries()) {
      for (const key of Object.keys(statement)) if (!['q', 'u', 'upsert', 'multi'].includes(key)) throw new NotServed(`an update statement's ${key}`);
      const held = documentsOf(ctx, database, collection), filter = (statement.q ?? {}) as Ejson, spec = statement.u as Ejson;
      const found = held.filter((document) => matches(document, filter));
      // without multi, the first the filter matches, in the order they were written
      const targets = statement.multi === true ? found : found.slice(0, 1);
      if (!targets.length) {
        if (statement.upsert !== true) continue;
        const document = upsertDocument(ctx, filter, spec, ctx.rowsRaw('document').length + 1);
        const broken = violated(document, held, indexes);
        // source: recording:update-upsert-duplicate.json "writeErrors"
        if (broken) { writeErrors.push(duplicateKey(position, database, collection, broken, document)); if (stops) break; continue; }
        await ctx.write('document', documentRowId(ctx, database, collection, document._id), { database, collection, document: JSON.stringify(document) }, 'update');
        upserted.push({ index: int(position), _id: document._id }); n += 1;
        continue;
      }
      let refused = false;
      for (const target of targets) {
        const next = updated(target, spec, false);
        // source: recording:update-set-same.json "nModified"
        if (JSON.stringify(next) === JSON.stringify(target)) { n += 1; continue; }
        const broken = violated(next, held.filter((other) => other !== target), indexes);
        // a document the statement matched and the server refused to change is not counted
        // source: recording:update-unordered.json "writeErrors"
        if (broken) { writeErrors.push(duplicateKey(position, database, collection, broken, next)); refused = true; break; }
        await ctx.write('document', documentRowId(ctx, database, collection, target._id), { database, collection, document: JSON.stringify(next) }, 'update');
        n += 1; nModified += 1;
      }
      if (refused && stops) break;
    }
    // the refusals are named before the documents made
    // source: recording:update-unordered.json "writeErrors"
    return { n: int(n), ...(writeErrors.length ? { writeErrors } : {}), ...(upserted.length ? { upserted } : {}), nModified: int(nModified), ok: OK };
  },

  // source: recording:fam-existing-new.json "lastErrorObject"
  // source: recording:fam-existing-old.json "lastErrorObject"
  // source: recording:fam-no-match.json "lastErrorObject"
  // source: recording:fam-upsert-new.json "lastErrorObject"
  async findAndModify(ctx, database, command) {
    fields(command, 'findAndModify', ['query', 'update', 'new', 'upsert', 'fields', 'remove', 'sort']);
    // source: recording:fam-remove-false.json "lastErrorObject"
    if (command.remove !== undefined && command.remove !== false) throw new NotServed('a findAndModify that removes');
    const collection = String(command.findAndModify), filter = (command.query ?? {}) as Ejson, spec = command.update as Ejson;
    if (spec === undefined) throw new NotServed('a findAndModify with no update');
    await ensureCollection(ctx, database, collection, 'findAndModify');
    const held = documentsOf(ctx, database, collection), indexes = indexesOf(ctx, database, collection);
    // source: recording:fam-existing-fields.json "value"
    // source: recording:fam-upsert-fields.json "value"
    const shownAs = (document: Ejson): Ejson => (command.fields === undefined ? document : project(document, command.fields as Ejson));
    // Of the documents the query matches, the one it changes is the first by the sort where one is given (the
    // demand: LibreChat's scheduler leases the schedule with the earliest nextRunAt), else the first written.
    // Documents equal under every key stay in the order they were written; a sort that matches nothing answers
    // as an unsorted one does.
    // source: recording:fam-sorted-ascending.json "value"
    // source: recording:fam-sorted-descending.json "value"
    // source: recording:fam-sorted-none.json "lastErrorObject"
    const famOrder = Object.entries((command.sort ?? {}) as Ejson).map(([field, direction]) => {
      const sign = numberOf(direction);
      if (sign !== 1 && sign !== -1) throw new NotServed(`a sort direction other than 1 or -1 on ${field}`);
      return { field, sign };
    });
    const candidates = held.filter((document) => matches(document, filter));
    if (famOrder.length) candidates.sort((a, b) => { for (const { field, sign } of famOrder) { const c = compare(at(a, field), at(b, field)); if (c !== 0) return c * sign; } return 0; });
    const target = candidates[0];
    if (!target) {
      if (command.upsert !== true) return { lastErrorObject: { n: int(0), updatedExisting: false }, value: null, ok: OK };
      const document = upsertDocument(ctx, filter, spec, ctx.rowsRaw('document').length + 1);
      // where the recordings stop: a findAndModify whose upsert breaks a unique index
      if (violated(document, held, indexes)) throw new NotServed('a findAndModify whose upsert breaks a unique index');
      await ctx.write('document', documentRowId(ctx, database, collection, document._id), { database, collection, document: JSON.stringify(document) }, 'findAndModify');
      if (command.new !== true) throw new NotServed('a findAndModify that upserts and does not ask for the document after');
      return { lastErrorObject: { n: int(1), updatedExisting: false, upserted: document._id }, value: shownAs(document), ok: OK };
    }
    const next = updated(target, spec, false);
    if (JSON.stringify(next) !== JSON.stringify(target)) {
      if (violated(next, held.filter((other) => other !== target), indexes)) throw new NotServed('a findAndModify whose update breaks a unique index');
      await ctx.write('document', documentRowId(ctx, database, collection, target._id), { database, collection, document: JSON.stringify(next) }, 'findAndModify');
    }
    return { lastErrorObject: { n: int(1), updatedExisting: true }, value: shownAs(command.new === true ? next : target), ok: OK };
  },

  // source: recording:find-all.json "firstBatch"
  // source: recording:find-missing-collection.json "firstBatch"
  find(ctx, database, command) {
    fields(command, 'find', ['filter', 'sort', 'projection', 'limit', 'singleBatch', 'hint', 'batchSize']);
    // a hint that names an index the collection has changes nothing in the answer; one that names none is refused
    // by the server with its planner's own words, which are not served
    // source: recording:find-hint-single-batch.json "firstBatch"
    if (command.hint !== undefined && command.hint !== '_id_' && !indexesOf(ctx, database, String(command.find)).some((index) => index.name === command.hint)) throw new NotServed('a find hinting an index the collection does not have');
    const collection = String(command.find), filter = (command.filter ?? {}) as Ejson;
    let batch = documentsOf(ctx, database, collection).filter((document) => matches(document, filter));
    const ns = `${database}.${collection}`;
    // source: recording:find-sorted.json "firstBatch"
    const order = Object.entries((command.sort ?? {}) as Ejson).map(([field, direction]) => {
      const sign = numberOf(direction);
      if (sign !== 1 && sign !== -1) throw new NotServed(`a sort direction other than 1 or -1 on ${field}`);
      return { field, sign };
    });
    // a stable sort: documents equal under every key stay in the order they were written
    if (order.length) batch.sort((a, b) => { for (const { field, sign } of order) { const c = compare(at(a, field), at(b, field)); if (c !== 0) return c * sign; } return 0; });
    // source: recording:filter-projection-limit.json "firstBatch"
    const limit = command.limit === undefined ? undefined : numberOf(command.limit);
    if (command.limit !== undefined && (limit === undefined || limit < 0)) throw new NotServed('a limit that is not a number of documents');
    if (limit) batch = batch.slice(0, limit);
    // a batch size the answer fits in, or a single batch, leaves no cursor open (a cursor's next batches are not served)
    // source: recording:librechat-story.json "batchSize"
    const batchSize = command.batchSize === undefined ? undefined : numberOf(command.batchSize);
    if (command.batchSize !== undefined && (batchSize === undefined || batchSize < 0)) throw new NotServed('a batchSize that is not a number of documents');
    if (batchSize && batch.length > batchSize) { if (command.singleBatch !== true) throw new NotServed('a find whose batchSize leaves a cursor open'); batch = batch.slice(0, batchSize); }
    if (command.projection !== undefined) batch = batch.map((document) => project(document, command.projection as Ejson));
    // the server names the cursor's fields in one order for a collection that exists, whatever the find matched, and
    // in another for a collection that was never made (three recordings: documents found; a collection never made;
    // a collection that exists and nothing matched, which an earlier rule here had wrong as "no documents")
    // source: recording:filter-in-empty.json "firstBatch"
    return collectionExists(ctx, database, collection) ? { cursor: { firstBatch: batch, id: long(0), ns }, ok: OK } : { cursor: { id: long(0), ns, firstBatch: [] }, ok: OK };
  },
};

/** The stages of a pipeline this serves, in the forms the demand sends. */
// source: recording:aggregate-antijoin.json "firstBatch"
// source: recording:aggregate-count.json "firstBatch"
function piped(ctx: HandlerContext, database: string, input: Ejson[], pipeline: Ejson[]): Ejson[] {
  let rows = input;
  for (const stage of pipeline) {
    const [name, body] = Object.entries(stage)[0] ?? [];
    if (Object.keys(stage).length !== 1 || name === undefined) throw new NotServed('a pipeline stage that is not one operator');
    if (name === '$match') rows = rows.filter((row) => matches(row, body as Ejson));
    else if (name === '$sort') {
      const order = Object.entries(body as Ejson).map(([field, direction]) => ({ field, sign: numberOf(direction) }));
      if (order.some(({ sign }) => sign !== 1 && sign !== -1)) throw new NotServed('a $sort direction other than 1 or -1');
      rows = [...rows].sort((a, b) => { for (const { field, sign } of order) { const c = compare(at(a, field), at(b, field)); if (c !== 0) return c * sign!; } return 0; });
    } else if (name === '$limit') { const n = numberOf(body); if (n === undefined || n < 1) throw new NotServed('a $limit that is not a positive number'); rows = rows.slice(0, n); }
    else if (name === '$project') rows = rows.map((row) => project(row, body as Ejson));
    else if (name === '$lookup') {
      const spec = body as Ejson;
      for (const key of Object.keys(spec)) if (!['from', 'localField', 'foreignField', 'as'].includes(key)) throw new NotServed(`a $lookup with ${key}`);
      const foreign = documentsOf(ctx, database, String(spec.from));
      // a local field that is an array is looked up by each of its elements; one that is missing by null
      rows = rows.map((row) => {
        const local = at(row, String(spec.localField)), wanted = Array.isArray(local) ? local : [local ?? null];
        return { ...row, [String(spec.as)]: foreign.filter((other) => wanted.some((value) => matches(other, { [String(spec.foreignField)]: value }))) };
      });
    } else if (name === '$group') {
      const spec = body as Ejson, sums = Object.entries(spec).filter(([field]) => field !== '_id');
      for (const [field, accumulator] of sums) if (Object.keys(accumulator as Ejson).length !== 1 || numberOf((accumulator as Ejson).$sum) === undefined) throw new NotServed(`a $group accumulator on ${field} that is not a sum of a constant`);
      // One group a distinct key, each other field a sum of a constant over the group's documents. A constant key
      // is one group for all.
      // source: recording:aggregate-count.json "firstBatch"
      // no document in, no group out
      // source: recording:aggregate-count-empty.json "firstBatch"
      // A key read from the document (the demand: LibreChat's start groups its deliveries by a field's value and
      // its queued turns by a document of four). A group's sum of an int is an int, and a document with no such
      // field has the key null:
      // source: recording:group-by-field.json "firstBatch"
      // the same for a dotted path one document lacks:
      // source: recording:group-by-missing-field.json "firstBatch"
      // a key that is a document leaves out a member whose field is missing:
      // source: recording:group-by-document-all.json "firstBatch"
      // source: recording:group-by-document.json "firstBatch"
      // where the recordings stop: THE ORDER OF THE GROUPS. The server's is not the order their first documents
      // came in and not a sort (group-by-field answers null, a, b for documents a, b, a, none, b;
      // group-by-missing-field answers y, null, x for x, y, x, y, none): it is its hash table's, which nothing
      // recorded derives. Groups here come in the order their first documents came, so the three all-groups
      // recordings above hold as SETS, not as lists; a sender that needs an order sorts. Also not recorded: a key
      // whose document has every member missing.
      const keyOf = groupKey(spec._id);
      const groups = new Map<string, { key: unknown; count: number }>();
      for (const row of rows) {
        const key = keyOf(row), name = identity(key), held = groups.get(name);
        if (held) held.count += 1; else groups.set(name, { key, count: 1 });
      }
      rows = [...groups.values()].map(({ key, count }) => ({ _id: key, ...Object.fromEntries(sums.map(([field, accumulator]) => [field, int(numberOf((accumulator as Ejson).$sum)! * count)])) })) as Ejson[];
    // A stage this does not serve. The server's answer to a stage IT does not know is recorded
    // (refused-unknown-stage.json: code 40324, "Unrecognized pipeline stage name"), but which stages the server
    // knows is not, so this cannot tell the two apart and says its own words, never the server's code.
    } else throw new NotServed(`the pipeline stage ${name}`);
  }
  return rows;
}

/** A value that is not there: a field path that names nothing, told apart from a null that is held. */
const MISSING = Symbol('missing');
/**
 * What a $group's _id reads from each document: a constant (a number, null, a string that is not a path, a value
 * the wire writes as one), a field by its path (`"$a.b"`), or a document whose members are each one of these.
 * Anything computed by an operator, and a variable (`"$$ROOT"`), is said as not served.
 */
function groupKey(expression: unknown): (row: Ejson) => unknown {
  const read = (inner: unknown): ((row: Ejson) => unknown) => {
    if (typeof inner === 'string' && inner.startsWith('$')) {
      if (inner.startsWith('$$')) throw new NotServed(`a $group _id that reads the variable ${inner}`);
      const path = inner.slice(1);
      return (row) => { const value = at(row, path); return value === undefined ? MISSING : value; };
    }
    if (inner === null || typeof inner !== 'object' || numberOf(inner) !== undefined || isWrapper(inner)) return () => inner;
    if (Array.isArray(inner)) throw new NotServed('a $group _id that is a list');
    const members = Object.entries(inner as Ejson).map(([field, value]) => {
      if (field.startsWith('$')) throw new NotServed(`a $group _id computed by ${field}`);
      return [field, read(value)] as const;
    });
    // a member whose field is missing is left out of the key's document
    return (row) => Object.fromEntries(members.map(([field, member]) => [field, member(row)] as const).filter(([, value]) => value !== MISSING));
  };
  const whole = read(expression);
  // the key itself, where its field is missing, is null
  return (row) => { const key = whole(row); return key === MISSING ? null : key; };
}

const more: Record<string, Command> = {
  // the distinct values of a field: an array's elements each count, a missing field does not, and they come in the
  // order a sort gives them
  // source: recording:distinct-basic.json "values"
  // source: recording:distinct-order.json "values"
  // source: recording:distinct-none.json "values"
  distinct(ctx, database, command) {
    fields(command, 'distinct', ['key', 'query']);
    const seen = new Map<string, unknown>();
    for (const document of documentsOf(ctx, database, String(command.distinct)).filter((row) => matches(row, (command.query ?? {}) as Ejson))) {
      const held = at(document, String(command.key));
      for (const value of Array.isArray(held) ? held : held === undefined ? [] : [held]) seen.set(identity(value), value);
    }
    return { values: [...seen.values()].sort(compare), ok: OK };
  },
  // source: recording:delete-one.json "n"
  // source: recording:delete-many.json "n"
  // source: recording:delete-none.json "n"
  async delete(ctx, database, command) {
    fields(command, 'delete', ['deletes', 'ordered']);
    const collection = String(command.delete);
    let n = 0;
    for (const statement of (command.deletes ?? []) as Ejson[]) {
      for (const key of Object.keys(statement)) if (!['q', 'limit'].includes(key)) throw new NotServed(`a delete statement's ${key}`);
      const limit = numberOf(statement.limit);
      if (limit !== 0 && limit !== 1) throw new NotServed('a delete whose limit is not 0 or 1');
      const found = documentsOf(ctx, database, collection).filter((document) => matches(document, (statement.q ?? {}) as Ejson));
      for (const document of limit === 1 ? found.slice(0, 1) : found) { await ctx.remove('document', documentRowId(ctx, database, collection, document._id), 'delete'); n += 1; }
    }
    return { n: int(n), ok: OK };
  },
  // an aggregate names its cursor's fields in one order, whether or not the collection exists
  // source: recording:aggregate-count-empty.json "firstBatch"
  aggregate(ctx, database, command) {
    fields(command, 'aggregate', ['pipeline', 'cursor']);
    if (typeof command.aggregate !== 'string') throw new NotServed('an aggregate on a database');
    if (command.cursor !== undefined && Object.keys(command.cursor as Ejson).length) throw new NotServed('an aggregate with cursor options');
    const batch = piped(ctx, database, documentsOf(ctx, database, command.aggregate), (command.pipeline ?? []) as Ejson[]);
    return { cursor: { firstBatch: batch, id: long(0), ns: `${database}.${command.aggregate}` }, ok: OK };
  },
  // every collection of the database, or the one a filter names; by name only, or in full. A collection's uuid is the
  // server's own random value for each collection it makes; a World's is derived from the collection's name, so two
  // Worlds made alike answer alike.
  // source: recording:list-collections.json "firstBatch"
  // source: recording:list-collections-full-named.json "idIndex"
  // source: recording:list-collections-full-absent.json "firstBatch"
  listCollections(ctx, database, command) {
    fields(command, 'listCollections', ['filter', 'nameOnly', 'cursor', 'authorizedCollections']);
    const filter = (command.filter ?? {}) as Ejson, wanted = Object.keys(filter);
    if (command.authorizedCollections !== undefined && command.authorizedCollections !== false) throw new NotServed('listCollections of authorized collections only');
    if (Object.keys((command.cursor ?? {}) as Ejson).length) throw new NotServed('listCollections with cursor options');
    if (wanted.some((key) => key !== 'name') || (filter.name !== undefined && typeof filter.name !== 'string')) throw new NotServed('listCollections filtered by other than a name');
    // where the recording stops: two collections were listed, in the order of their names, which was not the order
    // they were made in
    const names = ctx.rowsRaw('collection').filter((row) => row.database === database).map((row) => String(row.name)).filter((name) => filter.name === undefined || name === filter.name).sort();
    const uuid = (name: string): Ejson => {
      const bytes = (ctx.crypto.sha256(`mongodb:collection:${database}.${name}`).slice(0, 32).match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
      bytes[6] = (bytes[6]! & 0x0f) | 0x40; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      return { $binary: { base64: btoa(String.fromCharCode(...bytes)), subType: '04' } };
    };
    // where the recording stops: a collection made with options, and a view
    const full = (name: string): Ejson => ({ name, type: 'collection', options: {}, info: { readOnly: false, uuid: uuid(name) }, idIndex: { v: int(2), key: { _id: int(1) }, name: '_id_' } });
    return { cursor: { id: long(0), ns: `${database}.$cmd.listCollections`, firstBatch: names.map((name) => (command.nameOnly === true ? { name, type: 'collection' } : full(name))) }, ok: OK };
  },
  // source: recording:end-sessions.json "ok"
  endSessions: () => ({ ok: OK }),
  // source: recording:ping.json "ok"
  ping: () => ({ ok: OK }),
};
Object.assign(commands, more);

/** The reply document to one command. */
export async function answer(ctx: HandlerContext, database: string, command: Ejson, replicaSet?: SingleMemberHandshake): Promise<Ejson> {
  const name = Object.keys(command)[0] ?? '';
  const serve = Object.hasOwn(commands, name) ? commands[name] : undefined;
  // source: recording:unknown-command.json "no such command: 'noSuchCommand'"
  if (!serve) return { ok: FAILED, errmsg: `no such command: '${name}'`, code: int(59), codeName: 'CommandNotFound' };
  try {
    if (replicaSet && ['lsid', 'txnNumber', 'startTransaction', 'autocommit'].some(field => command[field] !== undefined)) {
      throw new NotServed('sessions, retryable writes or transactions in the single-member handshake');
    }
    const reply = await serve(ctx, database, command);
    return replicaSet && ['hello', 'ismaster', 'isMaster'].includes(name) ? replicaHandshake(reply, replicaSet) : reply;
  }
  catch (error) {
    if (error instanceof Refusal) return error.document;
    // What this does not serve inside a command it has is answered as a failed command, and the connection stays,
    // as it does after a command the server fails:
    // source: recording:refused-unknown-stage.json "state"
    // The message is the twin's own and there is NO code or codeName: the server would have served these, so any
    // code of its own here would say something false about it.
    if (error instanceof NotServed) return { ok: FAILED, errmsg: error.message };
    throw error;
  }
}
