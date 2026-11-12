// Which documents a filter matches, and what a projection keeps: the query rules, each read from a recorded answer
// of the vendor's server over one fixed set of documents (spec/recordings/filter-*.json). Values are canonical
// extended JSON, so a number's kind, a date and an ObjectId are what they were written as. The operators here are
// the ones the demand sends; any other is not served, and says so.
/** A command or reply in canonical extended JSON: every number with its BSON kind, an ObjectId and a date as they are. */
export type Ejson = Record<string, unknown>;

export class NotServed extends Error { constructor(what: string) { super(`mongodb: ${what} is not served yet`); } }

const NUMBER = ['$numberInt', '$numberLong', '$numberDouble'] as const;
const isObject = (value: unknown): value is Ejson => value !== null && typeof value === 'object' && !Array.isArray(value);
/** A value the wire writes as a one-key document: a number with its kind, a date, an ObjectId. */
export const isWrapper = (value: unknown): value is Ejson => isObject(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => key.startsWith('$')) && ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$date', '$oid', '$binary', '$regularExpression', '$timestamp', '$minKey', '$maxKey', '$undefined'].includes(Object.keys(value)[0]!);
export const numberOf = (value: unknown): number | undefined => {
  if (!isWrapper(value)) return undefined;
  for (const kind of NUMBER) if (typeof value[kind] === 'string') return Number(value[kind]);
  return undefined;
};
export const dateOf = (value: unknown): number | undefined => {
  if (!isWrapper(value) || value.$date === undefined) return undefined;
  const inner = value.$date;
  return isObject(inner) && typeof inner.$numberLong === 'string' ? Number(inner.$numberLong) : typeof inner === 'string' ? Date.parse(inner) : undefined;
};
/** What makes two values the same: a number is its value whatever its kind. */
// source: recording:insert-number-kinds.json "dup key: { _id: 1.0 }"
// source: recording:filter-equal-number-kinds.json "firstBatch"
export function identity(value: unknown): string {
  const n = numberOf(value);
  if (n !== undefined) return `n:${n}`;
  if (value === null || value === undefined) return 'z';
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(identity).join(',')}]`;
  return `{${Object.entries(value).map(([key, inner]) => `${JSON.stringify(key)}:${identity(inner)}`).join(',')}}`;
}
/** A field of a document by its dotted path; a path does not go into a value the wire writes as one. */
export const at = (document: Ejson, path: string): unknown => {
  let value: unknown = document;
  for (const part of path.split('.')) {
    if (Array.isArray(value)) throw new NotServed(`a path through an array (${path})`);
    if (!isObject(value) || isWrapper(value)) return undefined;
    value = value[part];
  }
  return value;
};

/** A field equal to a value. Null is equal to a null and to a missing field; a value is equal to an array that
 *  holds it, and to itself. */
// source: recording:filter-equal-null.json "firstBatch"
// source: recording:filter-equal-in-array.json "firstBatch"
function equal(held: unknown, wanted: unknown): boolean {
  if (wanted === null) return held === null || held === undefined || (Array.isArray(held) && held.includes(null));
  if (held === undefined) return false;
  if (Array.isArray(held) && !Array.isArray(wanted)) return held.some((item) => identity(item) === identity(wanted));
  return identity(held) === identity(wanted);
}
/** Order within one kind; undefined when the two are of different kinds, which no comparison matches. */
// source: recording:filter-date-range.json "firstBatch"
function ordered(held: unknown, wanted: unknown): number | undefined {
  if (Array.isArray(held)) throw new NotServed('a comparison against an array field');
  const hn = numberOf(held), wn = numberOf(wanted);
  if (hn !== undefined && wn !== undefined) return hn - wn;
  const hd = dateOf(held), wd = dateOf(wanted);
  if (hd !== undefined && wd !== undefined) return hd - wd;
  if (typeof held === 'string' && typeof wanted === 'string') return held === wanted ? 0 : held < wanted ? -1 : 1;
  return undefined;
}

const OPERATORS: Record<string, (held: unknown, operand: unknown) => boolean> = {
  $eq: equal,
  // source: recording:filter-ne-boolean.json "firstBatch"
  // source: recording:filter-ne-empty-array.json "firstBatch"
  $ne: (held, operand) => !equal(held, operand),
  // source: recording:filter-exists-true.json "firstBatch"
  // source: recording:filter-exists-false.json "firstBatch"
  $exists: (held, operand) => { if (typeof operand !== 'boolean') throw new NotServed('$exists with a value that is not true or false'); return (held !== undefined) === operand; },
  // source: recording:filter-in.json "firstBatch"
  // source: recording:filter-in-empty.json "firstBatch"
  $in: (held, operand) => { if (!Array.isArray(operand)) throw new NotServed('$in with a value that is not a list'); return operand.some((wanted) => equal(held, wanted)); },
  // source: recording:filter-nin-empty.json "firstBatch"
  $nin: (held, operand) => { if (!Array.isArray(operand)) throw new NotServed('$nin with a value that is not a list'); return !operand.some((wanted) => equal(held, wanted)); },
  // source: recording:filter-date-range.json "firstBatch"
  $gt: (held, operand) => { if (operand === null) throw new NotServed('$gt null'); const c = ordered(held, operand); return c !== undefined && c > 0; },
  $gte: (held, operand) => { if (operand === null) throw new NotServed('$gte null'); const c = ordered(held, operand); return c !== undefined && c >= 0; },
  $lt: (held, operand) => { if (operand === null) throw new NotServed('$lt null'); const c = ordered(held, operand); return c !== undefined && c < 0; },
  // at most null is what equals null: a null and a missing field
  // source: recording:filter-lte-null.json "firstBatch"
  $lte: (held, operand) => { if (operand === null) return equal(held, null); const c = ordered(held, operand); return c !== undefined && c <= 0; },
  // source: recording:aggregate-antijoin.json "firstBatch"
  $size: (held, operand) => { const n = numberOf(operand); if (n === undefined) throw new NotServed('$size with a value that is not a number'); return Array.isArray(held) && held.length === n; },
  // source: recording:filter-type-string.json "firstBatch"
  $type: (held, operand) => { if (operand !== 'string') throw new NotServed(`$type ${JSON.stringify(operand)}`); return typeof held === 'string'; },
};

/** Whether a document matches a filter. */
// source: recording:filter-or-and.json "firstBatch"
// source: recording:filter-equal-string.json "firstBatch"
export function matches(document: Ejson, filter: Ejson): boolean {
  for (const [field, condition] of Object.entries(filter)) {
    if (field === '$and' || field === '$or') {
      if (!Array.isArray(condition) || !condition.length) throw new NotServed(`${field} with no branches`);
      const results = condition.map((branch) => matches(document, branch as Ejson));
      if (field === '$and' ? !results.every(Boolean) : !results.some(Boolean)) return false;
      continue;
    }
    if (field.startsWith('$')) throw new NotServed(`the top-level operator ${field}`);
    const held = at(document, field);
    if (isObject(condition) && !isWrapper(condition) && Object.keys(condition).some((key) => key.startsWith('$'))) {
      for (const [operator, operand] of Object.entries(condition)) {
        const test = Object.hasOwn(OPERATORS, operator) ? OPERATORS[operator] : undefined;
        if (!test) throw new NotServed(`the operator ${operator}`);
        if (!test(held, operand)) return false;
      }
    } else if (!equal(held, condition)) return false;
  }
  return true;
}

/** A document as a projection keeps it: the named fields in the document's own order, with _id unless it is turned
 *  off; or the document without the fields turned off. A dotted path reaches into embedded documents and through
 *  arrays of them, as the server does: excluding one removes that field from each document it reaches and leaves
 *  every other value as it is (an array element that is no document, a field that is no document); including one
 *  keeps only the paths named, an array keeping its documents (each with what of the path it holds, or empty) and
 *  losing its other elements, and a field that is no document where the path goes on being left out. */
// source: recording:filter-projection-limit.json "firstBatch"
// source: recording:filter-projection-exclude.json "firstBatch"
// source: recording:filter-projection-dotted-exclude.json "firstBatch"
// source: recording:filter-projection-dotted-include.json "firstBatch"
export function project(document: Ejson, projection: Ejson): Ejson {
  const entries = Object.entries(projection);
  if (!entries.length) return document;
  const on = (value: unknown): boolean => { const n = numberOf(value); if (n === 1 || value === true) return true; if (n === 0 || value === false) return false; throw new NotServed('a projection value that is not 1 or 0'); };
  const others = entries.filter(([field]) => field !== '_id'), id = entries.find(([field]) => field === '_id');
  const including = others.length ? on(others[0]![1]) : !on(id![1]) ? false : true;
  if (others.some(([, value]) => on(value) !== including)) throw new NotServed('a projection that both includes and excludes');
  // The paths as a tree: a leaf (true) is a whole field; a branch is the fields named under it.
  type Tree = { [field: string]: Tree | true };
  const tree: Tree = {};
  for (const [path] of others) {
    const parts = path.split('.');
    let node = tree;
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1) { node[part] = true; break; }
      const next = node[part];
      if (next === true) break;
      node = (node[part] = next ?? {}) as Tree;
    }
  }
  const excluded = (value: unknown, under: Tree): unknown => {
    if (Array.isArray(value)) return value.map((item) => excluded(item, under));
    if (!isObject(value) || isWrapper(value)) return value;
    const out: Ejson = {};
    for (const [field, inner] of Object.entries(value)) {
      const rule = under[field];
      if (rule === true) continue;
      out[field] = rule === undefined ? inner : excluded(inner, rule);
    }
    return out;
  };
  // Undefined where nothing of the value is kept: a field that is no document where the path goes on.
  const included = (value: unknown, under: Tree): unknown => {
    if (Array.isArray(value)) return value.filter((item) => Array.isArray(item) || (isObject(item) && !isWrapper(item))).map((item) => included(item, under) ?? {});
    if (!isObject(value) || isWrapper(value)) return undefined;
    const out: Ejson = {};
    for (const [field, inner] of Object.entries(value)) {
      const rule = under[field];
      if (rule === undefined) continue;
      if (rule === true) { out[field] = inner; continue; }
      const kept = included(inner, rule);
      if (kept !== undefined) out[field] = kept;
    }
    return out;
  };
  if (including) {
    const kept = included(document, tree) as Ejson;
    if (!id || on(id[1])) return '_id' in document ? Object.fromEntries(Object.entries(document).filter(([field]) => field === '_id' || field in kept).map(([field, value]) => [field, field === '_id' ? value : kept[field]])) : kept;
    return kept;
  }
  const out = excluded(document, tree) as Ejson;
  if (id && !on(id[1])) delete out['_id'];
  return out;
}
