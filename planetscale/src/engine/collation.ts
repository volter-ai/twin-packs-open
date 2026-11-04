// MySQL 8 COLLATIONS — how two strings compare, sort, group and collide. Collation changes
// comparison only: stored bytes and returned values stay exactly as written.
//
// Reference: MySQL 8.0 Reference Manual, chapter 10 "Character Sets, Collations, Unicode":
//   10.3.1 Collation Naming Conventions (_ai/_as, _ci/_cs, _bin; the 0900 = UCA 9.0.0 collations),
//   10.8.4 Collation Coercibility in Expressions (derivations and the aggregation rules below),
//   10.8.5 The binary Collation Compared to _bin Collations,
//   10.10.1 Unicode Character Sets (utf8mb4_general_ci, utf8mb4_unicode_ci = UCA 4.0.0,
//           utf8mb4_0900_ai_ci = UCA 9.0.0; PAD SPACE for all but the 0900 family, which is NO PAD),
//   12.8.1 String Comparison Functions (LIKE compares per character under the collation).
// The weights are the published tables those collations are built from (collation-
// weights.gen.ts): DUCET 9.0.0 for utf8mb4_0900_*, DUCET 4.0.0 primaries for *_unicode_ci and the
// MySQL 8.0 `my_unicase_default` sort table for *_general_ci.
//
// WHAT IS MODELLED OF THE WEIGHT TABLES: the DUCET entries for U+0000..U+052F (Latin, IPA, Greek,
// Cyrillic, combining diacritics), U+1E00..U+1FFF, U+2000..U+206F, U+20A0..U+20CF, U+2100..U+218F,
// U+FB00..U+FB06 and U+FF01..U+FF5E, including DUCET's expansions (ß = ss, æ = ae, ﬁ = fi under
// utf8mb4_0900_ai_ci) and its contractions in those ranges. Every other character takes UCA's
// implicit weight derived from its code point, which is the weight MySQL gives an UNASSIGNED
// character: it equals only itself and sorts after the modelled ranges. For assigned characters
// outside the ranges (Arabic, Hebrew, Indic, kana, Hangul, emoji, …) that is not MySQL's answer —
// their case/width/accent equivalences and their order are not modelled
// (planetscale.collation.uca_full_weight_table).
import { GENERAL_CI, UCA_400, UCA_900 } from './collation-weights.gen.ts';

export type Charset = 'utf8mb4' | 'utf8mb3' | 'binary';

export type Collation = {
  name: string;
  /** MySQL's collation id (INFORMATION_SCHEMA.COLLATIONS.ID). */
  id: number;
  charset: Charset;
  /** PAD SPACE: trailing spaces are insignificant. The 0900 collations and `binary` are NO PAD. */
  pad: boolean;
  /** a `_bin` collation: wins a same-coercibility tie against a non-binary one (10.8.4). */
  binsort: boolean;
  /** a key two strings share exactly when the collation calls them equal. */
  key(s: string): string;
  compare(a: string, b: string): number;
  /** the key of ONE character, for LIKE's per-character matching. */
  charKey(cp: number): string;
};

// ── weight tables, parsed on first use (importing this module does no work) ──────────────────

type Ducet = { single: Map<number, number[]>; contractions: Map<number, Array<{ rest: number[]; ces: number[] }>> };
let ducet900: Ducet | undefined; // cache: the published table, parsed once
let uca400: Map<number, number[]> | undefined; // cache: the published table, parsed once
let general: Map<number, number> | undefined; // cache: the published table, parsed once

function loadDucet900(): Ducet {
  if (ducet900 !== undefined) return ducet900;
  const single = new Map<number, number[]>();
  const contractions = new Map<number, Array<{ rest: number[]; ces: number[] }>>();
  for (const entry of UCA_900.split(' ')) {
    const [keyText, body] = entry.split(':') as [string, string];
    const cps = keyText.split('+').map((h) => parseInt(h, 16));
    const ces: number[] = [];
    for (const ce of body === '' ? [] : body.split(',')) {
      const [p, s, t] = ce.split('.').map((h) => parseInt(h, 16));
      ces.push(p!, s ?? 0x20, t ?? 0x2);
    }
    if (cps.length === 1) single.set(cps[0]!, ces);
    else {
      const list = contractions.get(cps[0]!) ?? [];
      list.push({ rest: cps.slice(1), ces });
      list.sort((a, b) => b.rest.length - a.rest.length);
      contractions.set(cps[0]!, list);
    }
  }
  return (ducet900 = { single, contractions });
}

function loadUca400(): Map<number, number[]> {
  if (uca400 !== undefined) return uca400;
  const map = new Map<number, number[]>();
  for (const entry of UCA_400.split(' ')) {
    const [cp, body] = entry.split(':') as [string, string];
    map.set(parseInt(cp, 16), body === '' ? [] : body.split(',').map((h) => parseInt(h, 16)));
  }
  return (uca400 = map);
}

function loadGeneral(): Map<number, number> {
  if (general !== undefined) return general;
  const map = new Map<number, number>();
  for (const entry of GENERAL_CI.split(' ')) {
    const [cp, sort] = entry.split(':') as [string, string];
    map.set(parseInt(cp, 16), parseInt(sort, 16));
  }
  return (general = map);
}

const codePoints = (s: string): number[] => { const out: number[] = []; for (const ch of s) out.push(ch.codePointAt(0)!); return out; };

/** The twelve CJK Compatibility Ideographs that are Unified_Ideograph (UCA "core Han"). */
const COMPAT_UNIFIED = new Set([0xfa0e, 0xfa0f, 0xfa11, 0xfa13, 0xfa14, 0xfa1f, 0xfa21, 0xfa23, 0xfa24, 0xfa27, 0xfa28, 0xfa29]);

/** UCA 9.0.0 implicit weights (UTS #10 §10.1.3): [AAAA.0020.0002][BBBB.0000.0000]. */
function implicit900(cp: number): number[] {
  if (cp >= 0x17000 && cp <= 0x18aff) return [0xfb00, 0x20, 0x2, (cp - 0x17000) | 0x8000, 0, 0];
  let base = 0xfbc0;
  if ((cp >= 0x4e00 && cp <= 0x9fd5) || COMPAT_UNIFIED.has(cp)) base = 0xfb40;
  else if ((cp >= 0x3400 && cp <= 0x4db5) || (cp >= 0x20000 && cp <= 0x2a6d6) || (cp >= 0x2a700 && cp <= 0x2b734)
    || (cp >= 0x2b740 && cp <= 0x2b81d) || (cp >= 0x2b820 && cp <= 0x2cea1)) base = 0xfb80;
  return [base + (cp >> 15), 0x20, 0x2, (cp & 0x7fff) | 0x8000, 0, 0];
}

/** The DUCET 9.0.0 collation elements of a string, flat [p, s, t, p, s, t, …]. */
function elements900(cps: number[]): number[] {
  const { single, contractions } = loadDucet900();
  const out: number[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    const candidates = contractions.get(cp);
    let matched = false;
    if (candidates !== undefined) {
      for (const c of candidates) {
        if (c.rest.every((r, k) => cps[i + 1 + k] === r)) { out.push(...c.ces); i += c.rest.length; matched = true; break; }
      }
    }
    if (matched) continue;
    out.push(...(single.get(cp) ?? implicit900(cp)));
  }
  return out;
}

/** A multi-level UCA sort key: each level's non-zero weights, levels separated by 0x0000. One
 *  weight is one UTF-16 code unit, so comparing keys as strings compares the weights. */
function ucaKey(ces: number[], levels: number): string {
  let key = '';
  for (let level = 0; level < levels; level++) {
    if (level > 0) key += '\u0000';
    for (let i = level; i < ces.length; i += 3) if (ces[i] !== 0) key += String.fromCharCode(ces[i]!);
  }
  return key;
}

/** utf8mb4_unicode_ci's primary weights (UCA 4.0.0). MySQL gives every supplementary character
 *  the weight of U+FFFD; unlisted BMP characters take the UCA 4.0.0 implicit weight. */
function weights400(cps: number[]): number[] {
  const table = loadUca400();
  const out: number[] = [];
  for (const cp of cps) {
    if (cp > 0xffff) { out.push(0xfffd); continue; }
    const w = table.get(cp);
    if (w !== undefined) { out.push(...w); continue; }
    const base = cp >= 0x3400 && cp <= 0x4db5 ? 0xfb80 : (cp >= 0x4e00 && cp <= 0x9fa5) || COMPAT_UNIFIED.has(cp) ? 0xfb40 : 0xfbc0;
    out.push(base + (cp >> 15), (cp & 0x7fff) | 0x8000);
  }
  return out;
}

/** utf8mb4_general_ci: one weight per character from `my_unicase_default`; U+FFFD for supplementary. */
function weightsGeneral(cps: number[]): number[] {
  const table = loadGeneral();
  return cps.map((cp) => (cp > 0xffff ? 0xfffd : table.get(cp) ?? cp));
}

/** PAD SPACE comparison of single-level weights: the shorter string is extended with spaces
 *  (MySQL's strnncollsp), so trailing spaces never matter and a trailing weight below the space
 *  weight (a TAB) sorts BEFORE the unpadded string. */
function padCompare(a: number[], b: number[], space: number): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  if (a.length === b.length) return 0;
  const longer = a.length > b.length ? a : b; const sign = a.length > b.length ? 1 : -1;
  for (let i = n; i < longer.length; i++) if (longer[i] !== space) return longer[i]! < space ? -sign : sign;
  return 0;
}

const padKey = (w: number[], space: number): string => {
  let end = w.length;
  while (end > 0 && w[end - 1] === space) end--;
  let key = '';
  for (let i = 0; i < end; i++) key += String.fromCodePoint(w[i]!);
  return key;
};

function codePointCompare(a: string, b: string): number {
  if (a === b) return 0;
  const x = codePoints(a); const y = codePoints(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** Bounded per-collation memo of sort keys: sorts and group-bys key the same strings repeatedly. */
function memo<T>(fn: (s: string) => T): (s: string) => T {
  const cache = new Map<string, T>();
  return (s) => {
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const k = fn(s);
    if (cache.size >= 50_000) cache.clear();
    cache.set(s, k);
    return k;
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function uca900(name: string, id: number, levels: number): Collation {
  const key = memo((s) => ucaKey(elements900(codePoints(s)), levels));
  return { name, id, charset: 'utf8mb4', pad: false, binsort: false, key, compare: (a, b) => cmp(key(a), key(b)), charKey: (cp) => key(String.fromCodePoint(cp)) };
}

function padded(name: string, id: number, charset: Charset, weights: (cps: number[]) => number[], space: number, binsort: boolean): Collation {
  const w = memo((s) => weights(codePoints(s)));
  const key = memo((s) => padKey(w(s), space));
  return {
    name, id, charset, pad: true, binsort, key,
    compare: (a, b) => (a === b ? 0 : padCompare(w(a), w(b), space)),
    charKey: (cp) => weights([cp]).map((w) => String.fromCodePoint(w)).join(''),
  };
}

const identity = (cps: number[]): number[] => cps;

/** The byte-wise `binary` collation of binary strings. Operands are byte strings (one char per byte). */
export const BINARY_COLLATION: Collation = {
  name: 'binary', id: 63, charset: 'binary', pad: false, binsort: true,
  key: (s) => s, compare: cmp, charKey: (cp) => String.fromCharCode(cp),
};

const COLLATIONS: Collation[] = [
  BINARY_COLLATION,
  uca900('utf8mb4_0900_ai_ci', 255, 1),
  uca900('utf8mb4_0900_as_ci', 305, 2),
  uca900('utf8mb4_0900_as_cs', 278, 3),
  { name: 'utf8mb4_0900_bin', id: 309, charset: 'utf8mb4', pad: false, binsort: true, key: (s) => s, compare: codePointCompare, charKey: (cp) => String.fromCodePoint(cp) },
  padded('utf8mb4_bin', 46, 'utf8mb4', identity, 0x20, true),
  padded('utf8mb4_general_ci', 45, 'utf8mb4', weightsGeneral, 0x20, false),
  padded('utf8mb4_unicode_ci', 224, 'utf8mb4', weights400, 0x209, false),
  padded('utf8mb3_general_ci', 33, 'utf8mb3', weightsGeneral, 0x20, false),
  padded('utf8mb3_bin', 83, 'utf8mb3', identity, 0x20, true),
  padded('utf8mb3_unicode_ci', 192, 'utf8mb3', weights400, 0x209, false),
];
const BY_NAME = new Map(COLLATIONS.map((c) => [c.name, c]));
/** Every collation the engine models (INFORMATION_SCHEMA.COLLATIONS lists them). */
export const modelledCollations = (): readonly Collation[] => COLLATIONS;
const BY_ID = new Map(COLLATIONS.map((c) => [c.id, c]));

/** MySQL 8's default collation per character set (SHOW CHARACTER SET). */
export const DEFAULT_COLLATION_OF: Record<Charset, string> = { utf8mb4: 'utf8mb4_0900_ai_ci', utf8mb3: 'utf8mb3_general_ci', binary: 'binary' };
/** The database default, and the connection collation string literals take (`SET NAMES utf8mb4`
 *  selects utf8mb4's default collation, `default_collation_for_utf8mb4` = utf8mb4_0900_ai_ci). */
export const DATABASE_COLLATION = 'utf8mb4_0900_ai_ci';

/** The character sets MySQL 8 ships (SHOW CHARACTER SET). Names here that are not modelled are
 *  refused as unmodelled surface; any other name is MySQL's unknown charset/collation error. */
const MYSQL_CHARSETS = new Set(['armscii8', 'ascii', 'big5', 'binary', 'cp1250', 'cp1251', 'cp1256', 'cp1257', 'cp850', 'cp852', 'cp866', 'cp932',
  'dec8', 'eucjpms', 'euckr', 'gb18030', 'gb2312', 'gbk', 'geostd8', 'greek', 'hebrew', 'hp8', 'keybcs2', 'koi8r', 'koi8u', 'latin1', 'latin2',
  'latin5', 'latin7', 'macce', 'macroman', 'sjis', 'swe7', 'tis620', 'ucs2', 'ujis', 'utf16', 'utf16le', 'utf32', 'utf8', 'utf8mb3', 'utf8mb4']);

/** `utf8` is MySQL 8.0's alias for utf8mb3, in charset and collation names alike. */
const canonicalName = (name: string): string => {
  const n = name.toLowerCase();
  return n === 'utf8' ? 'utf8mb3' : n.startsWith('utf8_') ? `utf8mb3_${n.slice(5)}` : n;
};

export type Lookup<T> = { found: T } | { unmodelled: string } | { unknown: string };

export function lookupCollation(name: string): Lookup<Collation> {
  const n = canonicalName(name);
  const c = BY_NAME.get(n);
  return c !== undefined ? { found: c } : notModelled(n, name);
}

/** A collation name the twin does not model: one of MySQL's (named for a MySQL character set) or no collation at all. */
function notModelled(n: string, name: string): Lookup<Collation> {
  const charset = n.split('_')[0]!;
  return MYSQL_CHARSETS.has(charset) && n.includes('_') ? { unmodelled: n } : { unknown: name };
}

export function lookupCharset(name: string): Lookup<Charset> {
  const n = canonicalName(name);
  if (n === 'utf8mb4' || n === 'utf8mb3' || n === 'binary') return { found: n };
  return MYSQL_CHARSETS.has(n) ? { unmodelled: n } : { unknown: name };
}

/** A modelled collation by name (canonical names only), or undefined. */
export const collationNamed = (name: string | undefined): Collation | undefined => (name === undefined ? undefined : BY_NAME.get(canonicalName(name)));
export const collationById = (id: number | undefined): Collation | undefined => (id === undefined ? undefined : BY_ID.get(id));
export const defaultCollation = (charset: Charset): Collation => BY_NAME.get(DEFAULT_COLLATION_OF[charset])!;
export const databaseCollation = (): Collation => BY_NAME.get(DATABASE_COLLATION)!;
/** The `_bin` collation of a charset (a column's `BINARY` attribute). */
export const binCollation = (charset: Charset): Collation => (charset === 'binary' ? BINARY_COLLATION : BY_NAME.get(`${charset}_bin`)!);

// ── coercibility (10.8.4) ─────────────────────────────────────────────────────────────────────

export const EXPLICIT = 0;
export const NONE = 1;
export const IMPLICIT = 2;
export const SYSCONST = 3;
export const COERCIBLE = 4;
export const NUMERIC = 5;
export const IGNORABLE = 6;
export const DERIVATION_NAMES = ['EXPLICIT', 'NONE', 'IMPLICIT', 'SYSCONST', 'COERCIBLE', 'NUMERIC', 'IGNORABLE'];

/** A string operand's collation and derivation (MySQL's DTCollation). */
export type DT = { collation: Collation; derivation: number };

const unicode = (c: Collation): boolean => c.charset !== 'binary';

/** utf8mb4 is a superset of utf8mb3; a Unicode operand of lower derivation absorbs the other. */
function leftIsSuperset(l: DT, r: DT): boolean {
  return unicode(l.collation) && (l.derivation < r.derivation
    || (l.derivation === r.derivation && (!unicode(r.collation) || (l.collation.charset === 'utf8mb4' && r.collation.charset === 'utf8mb3'))));
}

/**
 * The collation two operands are compared under — MySQL's DTCollation::aggregate with the
 * comparison flags (superset and coercible conversion allowed). A result of derivation NONE is
 * "Illegal mix of collations": two different non-binary collations of equal derivation, or two
 * different EXPLICIT ones. A binary string wins over a character string of equal or higher
 * derivation, and a `_bin` collation wins a tie against a `_ci`/`_cs` one of the same charset.
 */
export function aggregate(a: DT, b: DT): DT {
  if (a.collation.charset !== b.collation.charset) return binaryOperand(a, b) ?? acrossCharsets(a, b);
  if (a.derivation < b.derivation) return a;
  if (b.derivation < a.derivation) return b;
  return a.collation === b.collation ? a : collationTie(a, b);
}

/** Of two operands of different character sets, the binary one: it wins over a character string of equal or higher derivation. */
const binaryOperand = (a: DT, b: DT): DT | undefined =>
  (a.collation.charset === 'binary' ? (a.derivation <= b.derivation ? a : b) : b.collation.charset === 'binary' ? (b.derivation <= a.derivation ? b : a) : undefined);

/** Two different collations of one character set at equal derivation: `_bin` wins, two EXPLICIT ones are an illegal mix. */
function collationTie(a: DT, b: DT): DT {
  if (a.derivation === EXPLICIT) return { collation: a.collation, derivation: NONE };
  if (a.collation.binsort) return a;
  if (b.collation.binsort) return b;
  return { collation: binCollation(a.collation.charset), derivation: NONE };
}

/** Two character strings of different character sets: the superset, else the coercible side gives way. */
function acrossCharsets(a: DT, b: DT): DT {
  // The admitted nonbinary character sets are Unicode (utf8mb3 and utf8mb4): the lower derivation
  // wins; at a tie utf8mb4 is the superset. The binary-operand rule is settled before this call.
  return leftIsSuperset(a, b) ? a : b;
}

/**
 * LIKE under a collation: `%` matches any run of characters, `_` exactly one, `\` escapes, and
 * every other pattern character matches one character of equal collation weight. Per character,
 * so under utf8mb4_0900_ai_ci `'é' LIKE 'e'` holds while `'ß' LIKE 'ss'` does not (MySQL 8
 * manual, 12.8.1: LIKE performs matching on a per-character basis). Trailing spaces are
 * significant in LIKE whatever the collation's pad attribute.
 */
export function likeMatch(value: string, pattern: string, collation: Collation): boolean {
  type Tok = { any: true } | { one: true } | { key: string };
  const toks: Tok[] = [];
  const p = collation.charset === 'binary' ? [...pattern].map((c) => c.charCodeAt(0)) : codePoints(pattern);
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === 0x5c && i + 1 < p.length) { toks.push({ key: collation.charKey(p[++i]!) }); continue; }
    if (c === 0x25) { if (!('any' in (toks[toks.length - 1] ?? {}))) toks.push({ any: true }); continue; }
    if (c === 0x5f) { toks.push({ one: true }); continue; }
    toks.push({ key: collation.charKey(c) });
  }
  const v = (collation.charset === 'binary' ? [...value].map((c) => c.charCodeAt(0)) : codePoints(value)).map((c) => collation.charKey(c));
  // Iterative wildcard match with single-star backtracking (each `%` resets the anchor).
  let vi = 0; let ti = 0; let starTi = -1; let starVi = 0;
  while (vi < v.length) {
    const t = toks[ti];
    if (t !== undefined && 'one' in t) { vi++; ti++; continue; }
    if (t !== undefined && 'key' in t && t.key === v[vi]) { vi++; ti++; continue; }
    if (t !== undefined && 'any' in t) { starTi = ti++; starVi = vi; continue; }
    if (starTi >= 0) { ti = starTi + 1; vi = ++starVi; continue; }
    return false;
  }
  while (ti < toks.length && 'any' in toks[ti]!) ti++;
  return ti === toks.length;
}
