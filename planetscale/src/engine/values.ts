// MySQL 8.0 VALUES — the arithmetic, text forms and orderings of the types a cell can hold. The
// engine stores every cell as MySQL's text form of its value (`sql.ts`, `Cell`); this
// module is what makes that text a TYPED value again: exact decimals (manual 14.24 "Precision
// Math"), doubles printed the way the server prints them, temporals parsed from every literal form
// MySQL accepts and compared as points in time (13.2 "Date and Time Data Types"), and JSON
// documents parsed with exact integers, printed normalized and compared by MySQL's JSON ordering
// (13.5 "The JSON Data Type", "Comparison and Ordering of JSON Values").
//
// Pure: no clock, no I/O. Nothing here knows about tables or SQL syntax.

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EXACT DECIMALS
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** An exact decimal: `m / 10^s`. Integers are decimals of scale 0. */
export type Dec = { m: bigint; s: number };

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

const DECIMAL_TEXT = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/;

/** A plain decimal or exponent spelling (`12`, `-0.50`, `.5`, `1.5e3`) as an exact value; null for
 *  anything else. */
export function parseDec(text: string): Dec | null {
  const m = DECIMAL_TEXT.exec(text);
  if (m === null || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const frac = m[3] ?? '';
  let mant = BigInt(`${m[2] || '0'}${frac}`);
  let s = frac.length;
  const exp = m[4] === undefined ? 0 : Number(m[4]);
  if (Math.abs(exp) > 400) return null;
  if (exp > 0) { if (exp >= s) { mant *= pow10(exp - s); s = 0; } else s -= exp; } else if (exp < 0) s -= exp;
  return { m: m[1] === '-' ? -mant : mant, s };
}

/** A double as the exact decimal of its shortest round-trip spelling. */
export function decFromNumber(n: number): Dec {
  if (!Number.isFinite(n)) return { m: 0n, s: 0 };
  return parseDec(n.toExponential()) ?? { m: 0n, s: 0 };
}

export const decFromBigInt = (n: bigint): Dec => ({ m: n, s: 0 });

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.m * pow10(s - a.s), b.m * pow10(s - b.s), s];
}

export const decAdd = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { m: x + y, s }; };
export const decSub = (a: Dec, b: Dec): Dec => { const [x, y, s] = align(a, b); return { m: x - y, s }; };
export const decMul = (a: Dec, b: Dec): Dec => ({ m: a.m * b.m, s: a.s + b.s });
export const decNeg = (a: Dec): Dec => ({ m: -a.m, s: a.s });
export const decIsZero = (a: Dec): boolean => a.m === 0n;
export function decCmp(a: Dec, b: Dec): number { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; }

/** Round half away from zero to `scale` digits (MySQL's rounding for exact values). */
export function decRound(a: Dec, scale: number): Dec {
  if (a.s <= scale) return { m: a.m * pow10(scale - a.s), s: scale };
  const div = pow10(a.s - scale);
  const neg = a.m < 0n; const abs = neg ? -a.m : a.m;
  let q = abs / div; const r = abs % div;
  if (r * 2n >= div) q += 1n;
  return { m: neg ? -q : q, s: scale };
}

/** Truncate toward zero to an integer. */
export const decTrunc = (a: Dec): bigint => a.m / pow10(a.s);

/** `a / b` rounded half away from zero to `scale` digits; null on division by zero. */
export function decDiv(a: Dec, b: Dec, scale: number): Dec | null {
  if (b.m === 0n) return null;
  // a/b = (a.m / 10^a.s) / (b.m / 10^b.s); scale the numerator so the quotient carries scale+1 digits.
  const extra = scale + 1 + b.s - a.s;
  let num = a.m; let den = b.m;
  if (extra >= 0) num *= pow10(extra); else den *= pow10(-extra);
  const neg = (num < 0n) !== (den < 0n);
  const q = (num < 0n ? -num : num) / (den < 0n ? -den : den);
  return decRound({ m: neg ? -q : q, s: scale + 1 }, scale);
}

/** The remainder of `a / b` with the sign of `a` (MySQL MOD); null on division by zero. */
export function decMod(a: Dec, b: Dec): Dec | null {
  if (b.m === 0n) return null;
  const [x, y, s] = align(a, b);
  return { m: x % y, s };
}

/** The text of an exact value at its own scale, or at `scale` when given (padded or rounded). */
export function decText(a: Dec, scale?: number): string {
  const v = scale === undefined ? a : decRound(a, scale);
  const neg = v.m < 0n; const digits = (neg ? -v.m : v.m).toString().padStart(v.s + 1, '0');
  const text = v.s === 0 ? digits : `${digits.slice(0, -v.s)}.${digits.slice(-v.s)}`;
  return neg && v.m !== 0n ? `-${text}` : text;
}

/** The canonical key of a value: trailing fractional zeros removed, so 1.50 and 1.5 meet. */
export function decKey(a: Dec): string {
  let { m, s } = a;
  while (s > 0 && m % TEN === 0n) { m /= TEN; s--; }
  return decText({ m, s });
}

/** Digits before the decimal point (0 for a pure fraction). */
export function decIntDigits(a: Dec): number {
  const i = decTrunc(a); const abs = i < 0n ? -i : i;
  return abs === 0n ? 0 : abs.toString().length;
}

export const decToNumber = (a: Dec): number => Number(decText(a));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DOUBLES
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A double as MySQL prints one: the shortest digits that round-trip, in positional notation while
 * the decimal exponent stays within DBL_DIG (15) digits, else `d.ddde±x` without a plus sign
 * (`1e20`, `1.2345678901234568e17`, `1e-7`).
 */
export function formatDouble(n: number): string {
  if (Object.is(n, -0)) return '-0';
  if (n === 0) return '0';
  const [mant, expText] = n.toExponential().split('e') as [string, string];
  const exp = Number(expText);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  const decpt = exp + 1;
  let out: string;
  if (decpt > 15 || decpt < -5) {
    out = `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${exp}`;
  } else if (decpt <= 0) {
    out = `0.${'0'.repeat(-decpt)}${digits}`;
  } else if (decpt >= digits.length) {
    out = digits + '0'.repeat(decpt - digits.length);
  } else {
    out = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }
  return neg ? `-${out}` : out;
}

/** A FLOAT (single precision) as MySQL prints it: the shortest digits that round-trip as float32. */
export function formatFloat(n: number): string {
  const f = Math.fround(n);
  if (f === 0) return Object.is(f, -0) ? '-0' : '0';
  for (let p = 1; p <= 9; p++) {
    const text = f.toPrecision(p);
    if (Math.fround(Number(text)) === f) return formatDouble(Number(text));
  }
  return formatDouble(f);
}

/** MySQL's string → number conversion: the longest numeric prefix after leading spaces (`'1abc'`
 *  is 1, `'abc'` is 0), with `complete` saying whether the whole string was that number. */
export function stringNumberPrefix(text: string): { value: number; text: string; complete: boolean } {
  const m = /^[ \t\n\r]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text);
  if (m === null) return { value: 0, text: '0', complete: false };
  const rest = text.slice(m[0].length);
  return { value: Number(m[1]), text: m[1]!, complete: /^[ \t\n\r]*$/.test(rest) };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TEMPORALS
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type TemporalKind = 'DATE' | 'DATETIME' | 'TIMESTAMP' | 'TIME';

/** A temporal value's parts. A TIME uses `h` for its whole hours (up to 838) and `neg` for its sign. */
export type Temporal = { y: number; mo: number; d: number; h: number; mi: number; s: number; us: number; neg: boolean };

/** How a parse went: `truncated` when trailing text was ignored (a warning, an error on a strict
 *  write), `zero` for a date with a zero part (refused on a strict write by NO_ZERO_DATE and
 *  NO_ZERO_IN_DATE). */
export type TemporalParse = { t: Temporal; truncated: boolean; zero: boolean };

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, mo: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
const twoDigitYear = (y: number): number => (y < 70 ? 2000 + y : 1900 + y);

/** Microseconds from a fraction's digits, rounded to six digits (a seventh digit rounds). */
function fractionMicros(digits: string): { us: number; carry: boolean } {
  if (digits === '') return { us: 0, carry: false };
  let us = Number(digits.slice(0, 6).padEnd(6, '0'));
  if (digits.length > 6 && digits[6]! >= '5') us += 1;
  return us >= 1_000_000 ? { us: 0, carry: true } : { us, carry: false };
}

/** A date MySQL reads: a real date, or an incomplete one with a zero month or day ("MySQL permits the storing of
 *  incomplete dates such as '2014-00-00'", manual 14.7, DATE_FORMAT), which the `zero` flag carries to a strict write. */
function validDate(t: Temporal): boolean {
  if (t.y > 9999 || t.mo < 0 || t.mo > 12 || t.d < 0) return false;
  if (t.mo === 0 || t.d === 0) return t.d <= 31;
  return t.d <= daysIn(t.y, t.mo);
}
function validClock(t: Temporal): boolean { return t.h >= 0 && t.h <= 23 && t.mi >= 0 && t.mi <= 59 && t.s >= 0 && t.s <= 59; }

/**
 * A DATE / DATETIME / TIMESTAMP string in any form MySQL accepts (manual 11.1.3 "Date and Time
 * Literals"): delimited `YYYY-MM-DD[ hh:mm:ss[.fraction]]` with any punctuation as the delimiter
 * and a space or `T` between date and time (the `T` form is what @planetscale/database sends for a
 * `Date`), two-digit years (70–99 → 19xx, 00–69 → 20xx), the undelimited `YYYYMMDD[hhmmss]` and
 * `YYMMDD[hhmmss]` forms, and a trailing `+hh:mm`/`-hh:mm` offset (8.0.19+), converted to UTC, the
 * session time zone. Null when the text is not a date.
 */
export function parseDateTimeText(text: string): TemporalParse | null {
  const src = text.replace(/^\s+/, '');
  const m = /^(\d{1,4})[^\d\sT](\d{1,2})[^\d\sT](\d{1,2})/.exec(src);
  let t: Temporal; let rest: string;
  if (m !== null) {
    const y = m[1]!.length <= 2 ? twoDigitYear(Number(m[1])) : Number(m[1]);
    t = { y, mo: Number(m[2]), d: Number(m[3]), h: 0, mi: 0, s: 0, us: 0, neg: false };
    rest = src.slice(m[0].length);
    const time = /^(?:[T ]|\s+)(\d{1,2})[^\d\s](\d{1,2})(?:[^\d\s](\d{1,2}))?(?:\.(\d*))?/.exec(rest);
    if (time !== null) {
      t.h = Number(time[1]); t.mi = Number(time[2]); t.s = Number(time[3] ?? 0);
      const f = fractionMicros(time[4] ?? '');
      t.us = f.us; if (f.carry) addMicros(t, 1_000_000);
      rest = rest.slice(time[0].length);
    }
  } else {
    // Undelimited: all digits, optionally with a fraction.
    const d = /^(\d{14}|\d{12}|\d{8}|\d{6})(?:\.(\d*))?/.exec(src);
    if (d === null) return null;
    const s = d[1]!;
    const long = s.length === 14 || s.length === 8;
    const yLen = long ? 4 : 2;
    const y = long ? Number(s.slice(0, 4)) : twoDigitYear(Number(s.slice(0, 2)));
    t = { y, mo: Number(s.slice(yLen, yLen + 2)), d: Number(s.slice(yLen + 2, yLen + 4)), h: 0, mi: 0, s: 0, us: 0, neg: false };
    if (s.length === 14 || s.length === 12) {
      const at = yLen + 4;
      t.h = Number(s.slice(at, at + 2)); t.mi = Number(s.slice(at + 2, at + 4)); t.s = Number(s.slice(at + 4, at + 6));
    }
    const f = fractionMicros(d[2] ?? ''); t.us = f.us; if (f.carry) addMicros(t, 1_000_000);
    rest = src.slice(d[0].length);
  }
  if (!validDate(t) || !validClock(t)) return null;
  // a trailing offset, `+hh:mm` (one or two hour digits, as the manual's own '2020-07-28 14:50:15+1:00' writes it)
  const offset = /^([+-])(\d{1,2}):(\d{2})/.exec(rest);
  if (offset !== null) {
    const minutes = Number(offset[2]) * 60 + Number(offset[3]);
    if (minutes > 14 * 60 || (offset[1] === '-' && minutes > 13 * 60 + 59)) return null;
    addMicros(t, (offset[1] === '-' ? 1 : -1) * minutes * 60_000_000);
    rest = rest.slice(offset[0].length);
  }
  const zero = t.y === 0 || t.mo === 0 || t.d === 0;
  return { t, truncated: !/^\s*$/.test(rest), zero };
}

/** A TIME string (manual 11.1.3): `[-][D ]hh:mm[:ss][.fraction]`, `hh:mm`, or undelimited
 *  `[-]hhmmss`/`mmss`/`ss`. A full DATETIME string is taken as its time of day. Range ±838:59:59. */
export function parseTimeText(text: string): TemporalParse | null {
  const src = text.trim();
  const full = /^\d{4}-\d{1,2}-\d{1,2}[T ]/.test(src) ? parseDateTimeText(src) : null;
  if (full !== null) return { t: { ...full.t, y: 0, mo: 0, d: 0 }, truncated: full.truncated, zero: false };
  let m = /^(-)?(?:(\d+)\s+)?(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d*))?/.exec(src);
  let t: Temporal; let consumed: number;
  if (m !== null) {
    const hours = Number(m[2] ?? 0) * 24 + Number(m[3]);
    t = { y: 0, mo: 0, d: 0, h: hours, mi: Number(m[4]), s: Number(m[5] ?? 0), us: 0, neg: m[1] === '-' };
    const f = fractionMicros(m[6] ?? ''); t.us = f.us; if (f.carry) t.s += 1;
    consumed = m[0].length;
  } else {
    m = /^(-)?(\d+)(?:\.(\d*))?/.exec(src);
    if (m === null) return null;
    const digits = m[2]!.padStart(6, '0');
    t = { y: 0, mo: 0, d: 0, h: Number(digits.slice(0, -4)), mi: Number(digits.slice(-4, -2)), s: Number(digits.slice(-2)), us: 0, neg: m[1] === '-' };
    const f = fractionMicros(m[3] ?? ''); t.us = f.us; if (f.carry) t.s += 1;
    consumed = m[0].length;
  }
  if (t.mi > 59 || t.s > 59) return null;
  if (t.h > 838 || (t.h === 838 && (t.mi > 59 || t.s > 59))) return null;
  return { t, truncated: !/^\s*$/.test(src.slice(consumed)), zero: false };
}

/** A number used as a temporal (`20240101`, `20240101103000.5`, `103000` for a TIME). */
export function parseTemporalNumber(text: string, kind: TemporalKind): TemporalParse | null {
  const m = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/.exec(text);
  if (m === null) return null;
  if (kind === 'TIME') return parseTimeText(text);
  const digits = m[2]!;
  if (m[1] === '-') return null;
  if (digits === '0') return { t: { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0, us: 0, neg: false }, truncated: false, zero: true };
  const padded = digits.length <= 6 ? digits.padStart(6, '0') : digits.length <= 8 ? digits.padStart(8, '0')
    : digits.length <= 12 ? digits.padStart(12, '0') : digits.padStart(14, '0');
  return parseDateTimeText(`${padded}${m[3] !== undefined ? `.${m[3]}` : ''}`);
}

/** The UTC instant of a proleptic Gregorian wall time (years 0–99 included, which `Date.UTC` maps to 19xx). */
function utcMs(t: Temporal): number {
  const at = new Date(0);
  at.setUTCFullYear(t.y, t.mo - 1, t.d);
  at.setUTCHours(t.h, t.mi, t.s, 0);
  return at.getTime();
}

/** Add microseconds to a date-time, carrying through days, months and years. */
function addMicros(t: Temporal, micros: number): void {
  const total = t.us + micros;
  const carrySeconds = Math.floor(total / 1_000_000);
  t.us = total - carrySeconds * 1_000_000;
  const at = new Date(utcMs(t) + carrySeconds * 1000);
  t.y = at.getUTCFullYear(); t.mo = at.getUTCMonth() + 1; t.d = at.getUTCDate();
  t.h = at.getUTCHours(); t.mi = at.getUTCMinutes(); t.s = at.getUTCSeconds();
}

/** The instant (ms) a DATETIME's wall time names in UTC, and the reverse; CONVERT_TZ's arithmetic. */
export const temporalUtcMs = (t: Temporal): number => utcMs(t);
export function temporalFromUtcMs(ms: number, us: number): Temporal {
  const at = new Date(ms);
  return { y: at.getUTCFullYear(), mo: at.getUTCMonth() + 1, d: at.getUTCDate(), h: at.getUTCHours(), mi: at.getUTCMinutes(), s: at.getUTCSeconds(), us, neg: false };
}

/** Round a value's fraction to `fsp` digits, as MySQL does on store (a half rounds up and carries). */
export function roundFsp(t: Temporal, fsp: number, kind: TemporalKind): Temporal {
  const unit = 10 ** (6 - fsp);
  const rounded = Math.round(t.us / unit) * unit;
  const out = { ...t };
  if (rounded === t.us) return out;
  if (kind === 'TIME') {
    out.us = rounded;
    if (out.us >= 1_000_000) { out.us -= 1_000_000; out.s += 1; if (out.s === 60) { out.s = 0; out.mi += 1; if (out.mi === 60) { out.mi = 0; out.h += 1; } } }
    return out;
  }
  if (t.y === 0 || t.mo === 0 || t.d === 0) { out.us = Math.min(rounded, 999_999); return out; }
  addMicros(out, rounded - t.us);
  return out;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** The canonical text MySQL returns for a value of `kind` with `fsp` fractional digits. */
export function formatTemporal(t: Temporal, kind: TemporalKind, fsp: number): string {
  const frac = fsp > 0 ? `.${String(t.us).padStart(6, '0').slice(0, fsp)}` : '';
  if (kind === 'TIME') return `${t.neg && (t.h || t.mi || t.s || t.us) ? '-' : ''}${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}${frac}`;
  const date = `${String(t.y).padStart(4, '0')}-${p2(t.mo)}-${p2(t.d)}`;
  if (kind === 'DATE') return date;
  return `${date} ${p2(t.h)}:${p2(t.mi)}:${p2(t.s)}${frac}`;
}

/** A totally ordered key of a temporal value: DATE/DATETIME/TIMESTAMP as their packed
 *  `YYYYMMDDhhmmss.ffffff`, a TIME as its signed microseconds. */
export function packTemporal(t: Temporal, kind: TemporalKind): bigint {
  if (kind === 'TIME') {
    const v = ((BigInt(t.h) * 60n + BigInt(t.mi)) * 60n + BigInt(t.s)) * 1_000_000n + BigInt(t.us);
    return t.neg ? -v : v;
  }
  const ymd = BigInt(t.y) * 10000n + BigInt(t.mo) * 100n + BigInt(t.d);
  const hms = BigInt(t.h) * 10000n + BigInt(t.mi) * 100n + BigInt(t.s);
  return (ymd * 1_000_000n + hms) * 1_000_000n + BigInt(t.us);
}

/** A temporal in numeric context: DATE → YYYYMMDD, DATETIME → YYYYMMDDhhmmss[.f], TIME → hhmmss[.f]. */
export function temporalNumberText(t: Temporal, kind: TemporalKind, fsp: number): string {
  const frac = fsp > 0 ? `.${String(t.us).padStart(6, '0').slice(0, fsp)}` : '';
  if (kind === 'TIME') return `${t.neg ? '-' : ''}${t.h}${p2(t.mi)}${p2(t.s)}${frac}`.replace(/^(-?)0+(?=\d)/, '$1');
  const ymd = `${t.y}${p2(t.mo)}${p2(t.d)}`;
  if (kind === 'DATE') return String(Number(ymd));
  return `${ymd}${p2(t.h)}${p2(t.mi)}${p2(t.s)}`.replace(/^0+(?=\d)/, '') + frac;
}

/** TIMESTAMP's range: '1970-01-01 00:00:01.000000' to '2038-01-19 03:14:07.999999' UTC. */
export function inTimestampRange(t: Temporal): boolean {
  const k = packTemporal(t, 'DATETIME');
  return k >= packTemporal({ y: 1970, mo: 1, d: 1, h: 0, mi: 0, s: 1, us: 0, neg: false }, 'DATETIME')
    && k <= packTemporal({ y: 2038, mo: 1, d: 19, h: 3, mi: 14, s: 7, us: 999_999, neg: false }, 'DATETIME');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// JSON
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A JSON number. Integers are exact (MySQL keeps int64/uint64); a number with a fraction or an
 *  exponent, or beyond uint64, is a DOUBLE; a DECIMAL comes only from SQL (JSON_OBJECT('k', 1.50)). */
export class JNum {
  private constructor(readonly kind: 'int' | 'double' | 'decimal', readonly int: bigint, readonly dbl: number, readonly dec: Dec | null) {}
  static int(n: bigint): JNum { return new JNum('int', n, Number(n), null); }
  static double(n: number): JNum { return new JNum('double', 0n, n, null); }
  static decimal(d: Dec): JNum { return new JNum('decimal', 0n, decToNumber(d), d); }
  exact(): Dec { return this.kind === 'int' ? { m: this.int, s: 0 } : this.kind === 'decimal' ? this.dec! : decFromNumber(this.dbl); }
}
/** A JSON object: members in MySQL's normalized order (shorter keys first, then byte order). */
export class JObj { constructor(readonly members: Map<string, JV>) {} }
export type JV = null | boolean | string | JNum | JV[] | JObj;

export class JsonTextError extends Error { constructor(readonly reason: string, readonly position: number) { super(reason); } }

const INT64_MIN = -(2n ** 63n); const UINT64_MAX = 2n ** 64n - 1n;

/** Parse JSON text (RFC 8259, what MySQL accepts). Throws `JsonTextError` with MySQL's reason. */
export function parseJson(text: string): JV {
  let i = 0;
  const ws = (): void => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const fail = (reason = 'Invalid value.'): never => { throw new JsonTextError(reason, i); };
  const value = (depth: number): JV => {
    if (depth > 100) fail('The JSON document exceeds the maximum depth.');
    ws();
    const c = text[i];
    if (c === undefined) fail('The document is empty.');
    if (c === '{') {
      i++; const members = new Map<string, JV>(); ws();
      if (text[i] === '}') { i++; return obj(members); }
      for (;;) {
        ws(); if (text[i] !== '"') fail('Missing a name for object member.');
        const k = str(); ws();
        if (text[i] !== ':') fail('Missing a colon after a name of object member.');
        i++; members.set(k, value(depth + 1)); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return obj(members); }
        fail('Missing a comma or \'}\' after an object member.');
      }
    }
    if (c === '[') {
      i++; const items: JV[] = []; ws();
      if (text[i] === ']') { i++; return items; }
      for (;;) {
        items.push(value(depth + 1)); ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return items; }
        fail('Missing a comma or \']\' after an array element.');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?(?:0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (m === null) fail();
    i += m![0].length;
    return numberFromText(m![0], m![1] !== undefined || m![2] !== undefined);
  };
  const str = (): string => {
    i++; let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined) fail('Missing a closing quotation mark in string.');
      if (c === '"') { i++; return out; }
      if (c === '\\') {
        const e = text[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e !== undefined && map[e] !== undefined) { out += map[e]; i += 2; continue; }
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue; }
        fail('Invalid escape character in string.');
      }
      if (c.charCodeAt(0) < 0x20) fail('Invalid encoding in string.');
      out += c; i++;
    }
  };
  const result = value(0);
  ws();
  if (i < text.length) fail('The document root must not be followed by other values.');
  return result;
}

function obj(members: Map<string, JV>): JObj {
  const sorted = [...members.keys()].sort(compareKeys);
  return new JObj(new Map(sorted.map((k) => [k, members.get(k)!])));
}
const utf8Len = (s: string): number => new TextEncoder().encode(s).length;
function compareKeys(a: string, b: string): number {
  const la = utf8Len(a); const lb = utf8Len(b);
  if (la !== lb) return la - lb;
  return compareUtf8(a, b);
}
function compareUtf8(a: string, b: string): number {
  const x = new TextEncoder().encode(a); const y = new TextEncoder().encode(b);
  for (let k = 0; k < Math.min(x.length, y.length); k++) if (x[k] !== y[k]) return x[k]! - y[k]!;
  return x.length - y.length;
}

/** A JSON object built from members in any order (JSON_OBJECT), normalized as MySQL stores it. */
export const jsonObject = (members: Map<string, JV>): JObj => obj(members);

function numberFromText(text: string, fractional: boolean): JNum {
  if (!fractional) {
    const n = BigInt(text);
    if (n >= INT64_MIN && n <= UINT64_MAX) return JNum.int(n);
  }
  return JNum.double(Number(text));
}

/** A JSON value printed as MySQL prints one: `", "` and `": "` separators, normalized member order,
 *  doubles with a `.0` when they would otherwise read as integers. */
export function printJson(v: JV): string {
  if (v === null) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof JNum) {
    if (v.kind === 'int') return v.int.toString();
    if (v.kind === 'decimal') return decText(v.dec!);
    const text = formatDouble(v.dbl);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
  }
  if (Array.isArray(v)) return `[${v.map(printJson).join(', ')}]`;
  return `{${[...v.members].map(([k, x]) => `${JSON.stringify(k)}: ${printJson(x)}`).join(', ')}}`;
}

export function jsonTypeName(v: JV): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return 'BOOLEAN';
  if (typeof v === 'string') return 'STRING';
  if (v instanceof JNum) return v.kind === 'int' ? (v.int > 2n ** 63n - 1n ? 'UNSIGNED INTEGER' : 'INTEGER') : v.kind === 'decimal' ? 'DECIMAL' : 'DOUBLE';
  return Array.isArray(v) ? 'ARRAY' : 'OBJECT';
}

/** MySQL's JSON type precedence for ordering values of different types (higher sorts later):
 *  BOOLEAN > ARRAY > OBJECT > STRING > numbers > NULL (the BLOB/BIT/OPAQUE/temporal types above
 *  BOOLEAN are never produced by parsing JSON text). */
function precedence(v: JV): number {
  if (v === null) return 0;
  if (v instanceof JNum) return 1;
  if (typeof v === 'string') return 2;
  if (v instanceof JObj) return 3;
  if (Array.isArray(v)) return 4;
  return 5;
}

/** Compare two JSON values (manual 13.5, "Comparison and Ordering of JSON Values"). Values of
 *  different types order by type precedence; numbers compare by value whatever their kind; strings
 *  by their utf8mb4 bytes; arrays element by element, the shorter first on a tie; booleans false
 *  first; objects are equal when they have the same members, otherwise ordered deterministically. */
export function compareJson(a: JV, b: JV): number {
  const pa = precedence(a); const pb = precedence(b);
  if (pa !== pb) return pa - pb;
  if (a === null) return 0;
  if (a instanceof JNum) {
    const x = a; const y = b as JNum;
    if (x.kind === 'double' && y.kind === 'double') return x.dbl < y.dbl ? -1 : x.dbl > y.dbl ? 1 : 0;
    return decCmp(x.exact(), y.exact());
  }
  if (typeof a === 'string') return compareUtf8(a, b as string);
  if (typeof a === 'boolean') return (a ? 1 : 0) - ((b as boolean) ? 1 : 0);
  if (Array.isArray(a)) {
    const y = b as JV[];
    for (let k = 0; k < Math.min(a.length, y.length); k++) { const c = compareJson(a[k]!, y[k]!); if (c !== 0) return c; }
    return a.length - y.length;
  }
  const x = (a as JObj).members; const y = (b as JObj).members;
  if (x.size === y.size && [...x].every(([k, v]) => y.has(k) && compareJson(v, y.get(k)!) === 0)) return 0;
  const tx = printJson(a); const ty = printJson(b);
  return tx < ty ? -1 : tx > ty ? 1 : 0;
}

/** A key under which JSON values that compare equal meet (numbers by value, objects by members). */
export function jsonKey(v: JV): string {
  if (v instanceof JNum) return `n${decKey(v.exact())}`;
  if (Array.isArray(v)) return `a[${v.map(jsonKey).join(',')}]`;
  if (v instanceof JObj) return `o{${[...v.members].map(([k, x]) => `${JSON.stringify(k)}:${jsonKey(x)}`).join(',')}}`;
  return `v${JSON.stringify(v)}`;
}

/** JSON_CONTAINS (manual 14.17.3): a scalar contains an equal scalar; an array contains every
 *  element of a candidate array, or a candidate non-array equal to one of its elements; an object
 *  contains a candidate object whose every member it contains. */
export function jsonContains(target: JV, candidate: JV): boolean {
  if (Array.isArray(target)) {
    if (Array.isArray(candidate)) return candidate.every((c) => target.some((t) => jsonContains(t, c)));
    return target.some((t) => jsonContains(t, candidate));
  }
  if (target instanceof JObj) {
    if (!(candidate instanceof JObj)) return false;
    return [...candidate.members].every(([k, v]) => target.members.has(k) && jsonContains(target.members.get(k)!, v));
  }
  if (Array.isArray(candidate) || candidate instanceof JObj) return false;
  return compareJson(target, candidate) === 0;
}

export function jsonDepth(v: JV): number {
  if (Array.isArray(v)) return 1 + Math.max(0, ...v.map(jsonDepth));
  if (v instanceof JObj) return 1 + Math.max(0, ...[...v.members.values()].map(jsonDepth));
  return 1;
}
