// HyperDX's search over a source's rows (./columns.ts): its Lucene where clause, its select list and its ordering, as
// its query parser (packages/common-utils/src/queryParser.ts) and search config render them into ClickHouse SQL and
// ClickHouse runs them. Pure computation over rows already projected: nothing here takes a context or answers.
//
// The where clause, as the parser serializes each term:
//   field:value       an unquoted value is a case-insensitive substring of a string column (ILIKE %value%, a leading
//                     or trailing * taken off), equality on a number column; `field:*` is a non-empty field
//   field:"value"     a quoted value is equality
//   field:>N >=N <N <=N, field:[a TO b] / {a TO b}   comparisons and ranges
//   value, "a b"      a bare term searches the source's implicit column (Body, SpanName) by whole tokens
//   AND, OR, NOT, -field:value, ( ), field:(a b)     boolean structure; terms side by side are AND
// A field is a column, or a map column's key written after it (`SpanAttributes.http.route`), or an array column (any
// element). Any other name is no column of the table, which ClickHouse refuses.
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "If the term is quoted, we should search for the exact term in a property (ex. foo:"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "[SqlString.raw('ILIKE'), `%${escapeLikePattern(term)}%`],"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "return serializer.gt(field, term.slice(1), context);"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "return serializer.isNotNull(field, isNegatedField, context);"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "`(${isNegatedField ? 'NOT ' : ''}hasToken(lower(?), lower(?)))`,"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/queryParser.ts "// It might be an alias, let's just try the column"

import type { ColumnType } from './columns.ts';

type Row = Record<string, unknown>;

/** A query ClickHouse refuses: its error type (the search answers a user's mistake 400, any other 500) and message. */
export class QueryError extends Error {
  constructor(readonly type: string, message: string) { super(message); }
}

export type Node =
  | { kind: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'not'; node: Node }
  | { kind: 'term'; field: string | undefined; term: string; quoted: boolean }
  | { kind: 'range'; field: string; min: string; max: string; inclusive: [boolean, boolean] }
  | { kind: 'all' };

// ── parsing ──────────────────────────────────────────────────────────────────────────────────

type Token = { t: 'lp' | 'rp' | 'and' | 'or' | 'not' | 'word' | 'quoted'; v: string; neg?: boolean };

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { out.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp', v: c }); i++; continue; }
    if (c === '"') {
      let j = i + 1; let v = '';
      while (j < input.length && input[j] !== '"') { if (input[j] === '\\' && j + 1 < input.length) j++; v += input[j]; j++; }
      if (j >= input.length) throw new QueryError('SYNTAX_ERROR', 'Expected " but end of input found.');
      out.push({ t: 'quoted', v }); i = j + 1; continue;
    }
    // a word runs to whitespace or a parenthesis, a quoted value or a range after its field's colon kept with it
    let j = i; let v = '';
    while (j < input.length && !/\s/.test(input[j]!) && input[j] !== '(' && input[j] !== ')') {
      if (input[j] === '\\' && j + 1 < input.length) { v += input[j]! + input[j + 1]!; j += 2; continue; }
      if (input[j] === ':' && input[j + 1] === '"') {
        let k = j + 2; let q = '';
        while (k < input.length && input[k] !== '"') { if (input[k] === '\\' && k + 1 < input.length) k++; q += input[k]; k++; }
        if (k >= input.length) throw new QueryError('SYNTAX_ERROR', 'Expected " but end of input found.');
        v += `:"${q.replace(/"/g, '\\"')}"`; j = k + 1; break;
      }
      if (input[j] === ':' && (input[j + 1] === '[' || input[j + 1] === '{')) {
        const close = input[j + 1] === '[' ? ']' : '}';
        let k = j + 2; while (k < input.length && input[k] !== ']' && input[k] !== '}') k++;
        if (k >= input.length) throw new QueryError('SYNTAX_ERROR', `Expected ${close} but end of input found.`);
        v += input.slice(j, k + 1); j = k + 1; break;
      }
      v += input[j]; j++;
    }
    if (v === 'AND' || v === '&&') out.push({ t: 'and', v });
    else if (v === 'OR' || v === '||') out.push({ t: 'or', v });
    else if (v === 'NOT' || v === '!') out.push({ t: 'not', v });
    else out.push({ t: 'word', v });
    i = j;
  }
  return out;
}

const unescape = (s: string): string => s.replace(/\\(.)/g, '$1');

/** A where clause as its tree; an empty one matches every row. */
export function parseWhere(where: string): Node {
  const tokens = tokenize(where);
  if (!tokens.length) return { kind: 'all' };
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const fail = (): never => { throw new QueryError('SYNTAX_ERROR', `Unexpected ${peek() ? `"${peek()!.v}"` : 'end of input'} in the search`); };

  function or(field?: string): Node {
    let left = and(field);
    while (peek()?.t === 'or') { at++; left = { kind: 'or', left, right: and(field) }; }
    return left;
  }
  function and(field?: string): Node {
    let left = unary(field);
    for (;;) {
      const p = peek();
      if (!p || p.t === 'rp' || p.t === 'or') return left;
      if (p.t === 'and') at++;
      left = { kind: 'and', left, right: unary(field) };
    }
  }
  function unary(field?: string): Node {
    if (peek()?.t === 'not') { at++; return { kind: 'not', node: unary(field) }; }
    return primary(field);
  }
  function primary(field?: string): Node {
    const p = peek();
    if (!p) return fail();
    if (p.t === 'lp') { at++; const n = or(field); if (peek()?.t !== 'rp') fail(); at++; return n; }
    if (p.t === 'quoted') { at++; return { kind: 'term', field, term: p.v, quoted: true }; }
    if (p.t !== 'word') return fail();
    at++;
    let word = p.v;
    let negated = false;
    if (word.startsWith('-') && word.length > 1) { negated = true; word = word.slice(1); }
    const colon = /^((?:[^:\\]|\\.)+):(.*)$/s.exec(word);
    let node: Node;
    if (colon) {
      const name = unescape(colon[1]!);
      const value = colon[2]!;
      if (value === '' && peek()?.t === 'lp') {
        // field:(a b): the group's bare terms search the field
        at++; node = or(name); if (peek()?.t !== 'rp') fail(); at++;
      } else if (value === '' && peek()?.t === 'quoted') {
        node = { kind: 'term', field: name, term: tokens[at++]!.v, quoted: true };
      } else if (/^"(.*)"$/s.test(value)) {
        node = { kind: 'term', field: name, term: value.slice(1, -1).replace(/\\"/g, '"'), quoted: true };
      } else if (/^[[{].* TO .*[\]}]$/s.test(value) || /^[[{]/.test(value)) {
        const m = /^([[{])\s*(\S+)\s+TO\s+(\S+)\s*([\]}])$/.exec(value);
        if (!m) return fail();
        node = { kind: 'range', field: name, min: m[2]!, max: m[3]!, inclusive: [m[1] === '[', m[4] === ']'] };
      } else node = { kind: 'term', field: name, term: unescape(value), quoted: false };
    } else {
      // a bare term searches the field a group names, else the implicit column; a leading - negates it
      node = { kind: 'term', field, term: unescape(word), quoted: false };
    }
    return negated ? { kind: 'not', node } : node;
  }

  const tree = or();
  if (at < tokens.length) fail();
  return tree;
}

// ── evaluating ───────────────────────────────────────────────────────────────────────────────

export type Table = { columns: Record<string, ColumnType>; implicit: string };

type Resolved = { type: ColumnType; read: (row: Row) => unknown };

/** A field as the parser resolves it: the column of that name, else the map column it begins with and the key after it. */
export function resolveField(table: Table, field: string): Resolved {
  const type = table.columns[field];
  if (type) return { type, read: (row) => row[field] };
  const prefix = Object.keys(table.columns).filter((c) => field.startsWith(`${c}.`)).sort((a, b) => b.length - a.length)[0];
  if (prefix && table.columns[prefix] === 'map') {
    const key = field.slice(prefix.length + 1);
    return { type: 'string', read: (row) => (row[prefix] as Record<string, string> | undefined)?.[key] ?? '' };
  }
  throw new QueryError('UNKNOWN_IDENTIFIER', `Unknown expression identifier \`${field}\` in scope SELECT`);
}

const lower = (s: string): string => s.toLowerCase();
/** ClickHouse's tokens: runs of ASCII letters and digits (and any non-ASCII character), lowercased. */
const tokensOf = (s: string): string[] => lower(s).split(/[^a-z0-9\u0080-￿]+/).filter(Boolean);
const hasSeparators = (s: string): boolean => /[^A-Za-z0-9\u0080-￿]/.test(s);

function asNumber(term: string, type: ColumnType): number {
  const n = Number(term);
  if (term.trim() === '' || Number.isNaN(n)) throw new QueryError('CANNOT_PARSE_TEXT', `Cannot parse string '${term}' as ${type === 'datetime' ? 'DateTime64' : 'UInt64'}`);
  return n;
}

/** Compare a row's value with a term in the column's own order: numbers as numbers, instants as instants, else text. */
function compare(type: ColumnType, value: unknown, term: string): number {
  if (type === 'number') { const a = Number(value); const b = asNumber(term, type); return a < b ? -1 : a > b ? 1 : 0; }
  if (type === 'datetime') {
    const b = Date.parse(term);
    if (Number.isNaN(b)) throw new QueryError('CANNOT_PARSE_DATETIME', `Cannot parse string '${term}' as DateTime64(9)`);
    const a = Date.parse(String(value));
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = String(value ?? '');
  return a < term ? -1 : a > term ? 1 : 0;
}

function termMatches(table: Table, node: Extract<Node, { kind: 'term' }>, row: Row): boolean {
  const implicit = node.field === undefined;
  const { type, read } = resolveField(table, implicit ? table.implicit : node.field!);
  const value = read(row);
  let term = node.term;
  if (type === 'array') {
    const items = (value as unknown[]).map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v)));
    return node.quoted ? items.includes(term) : items.some((v) => lower(v).includes(lower(term.replace(/^\*|\*$/g, ''))));
  }
  if (type === 'map') throw new QueryError('ILLEGAL_TYPE_OF_ARGUMENT', `Illegal type Map(LowCardinality(String), String) of argument of function ilike`);
  // a quoted value of a named field is equality; a bare quoted phrase is still a search of the implicit column
  if (node.quoted && !implicit) return type === 'number' ? Number(value) === asNumber(term, type) : String(value ?? '') === term;
  if (!node.quoted) {
    if (term === '*') return String(value ?? '') !== '';
    for (const [op, test] of [['>=', (c: number) => c >= 0], ['<=', (c: number) => c <= 0], ['>', (c: number) => c > 0], ['<', (c: number) => c < 0]] as const) {
      if (term.startsWith(op)) return test(compare(type, value, term.slice(op.length)));
    }
  }
  if (type === 'number') return Number(value) === asNumber(term, type);
  const prefix = !node.quoted && term.startsWith('*');
  const suffix = !node.quoted && term.endsWith('*') && term.length > 1;
  if (prefix) term = term.slice(1);
  if (suffix) term = term.slice(0, -1);
  const text = String(value ?? '');
  if (!implicit) return lower(text).includes(lower(term));
  if (term === '') return true;
  if (prefix || suffix) {
    const t = lower(term), v = lower(text);
    return prefix && suffix ? v.includes(t) : prefix ? v.endsWith(t) : v.startsWith(t);
  }
  const held = new Set(tokensOf(text));
  const wanted = tokensOf(term);
  return wanted.every((t) => held.has(t)) && (!hasSeparators(term) || lower(text).includes(lower(term)));
}

/** Whether a row holds for a where clause's tree. */
export function matches(table: Table, node: Node, row: Row): boolean {
  switch (node.kind) {
    case 'all': return true;
    case 'and': return matches(table, node.left, row) && matches(table, node.right, row);
    case 'or': return matches(table, node.left, row) || matches(table, node.right, row);
    case 'not': return !matches(table, node.node, row);
    case 'range': {
      const { type, read } = resolveField(table, node.field);
      const v = read(row);
      const lo = node.min === '*' ? true : node.inclusive[0] ? compare(type, v, node.min) >= 0 : compare(type, v, node.min) > 0;
      const hi = node.max === '*' ? true : node.inclusive[1] ? compare(type, v, node.max) <= 0 : compare(type, v, node.max) < 0;
      return lo && hi;
    }
    case 'term': return termMatches(table, node, row);
  }
}

// ── select and order ─────────────────────────────────────────────────────────────────────────

/** A comma-separated list split where no bracket, parenthesis or quote is open (HyperDX's splitAndTrimWithBracket). */
export function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0; let quote = ''; let cur = '';
  for (const c of list) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** One select expression as ClickHouse names its column and reads its value: a column, a map column's key
 *  (`SpanAttributes['http.route']`), or a duration in milliseconds as the Traces source's default select reads it
 *  (`round(Duration/1e6)`, named as ClickHouse formats it). */
export function selector(table: Table, expression: string): { name: string; read: (row: Row) => unknown } {
  const e = expression.replace(/^`(.*)`$/, '$1');
  if (table.columns[e]) return { name: e, read: (row) => row[e] };
  const lookup = /^(\w+)\['([^']*)'\]$/.exec(e);
  if (lookup && table.columns[lookup[1]!] === 'map') return { name: expression, read: (row) => (row[lookup[1]!] as Record<string, string>)[lookup[2]!] ?? '' };
  const ms = /^round\(\s*(\w+)\s*\/\s*1e6\s*\)$/.exec(e);
  if (ms && table.columns[ms[1]!] === 'number') return { name: `round(divide(${ms[1]}, 1000000.))`, read: (row) => Math.round(Number(row[ms[1]!]) / 1e6) };
  const field = resolveField(table, e);
  return { name: e, read: field.read };
}

/** The rows' order: each `expression [ASC|DESC]` of the list in turn. */
export function orderBy(table: Table, list: string): (a: Row, b: Row) => number {
  const keys = splitList(list.replace(/^\((.*)\)\s+(ASC|DESC)$/i, (_m, inner: string, dir: string) => inner.split(',').map((k) => `${k.trim()} ${dir}`).join(','))).map((part) => {
    const m = /^(.*?)\s+(ASC|DESC)$/i.exec(part);
    const expression = m ? m[1]!.trim() : part;
    const desc = m ? m[2]!.toUpperCase() === 'DESC' : false;
    const type = table.columns[expression] ?? 'string';
    return { read: selector(table, expression).read, type, desc };
  });
  return (a, b) => {
    for (const k of keys) {
      const x = k.read(a); const y = k.read(b);
      const c = k.type === 'number' ? Number(x) - Number(y) : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
      if (c !== 0) return k.desc ? -c : c;
    }
    return 0;
  };
}
