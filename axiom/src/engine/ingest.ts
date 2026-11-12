// Pure reading of an ingest body: its events from JSON, NDJSON or CSV, a timestamp in a Go reference layout, and the
// field limits Axiom applies to what it stores. No state, no answer: ../semantics/datasets.ts uses these.

export type Fields = Record<string, unknown>;

/** The events of a JSON body: an array of objects, one object, or (sent as JSON) NDJSON; undefined when it is none. */
export function jsonEvents(text: string): Fields[] | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  try {
    const v = JSON.parse(trimmed) as unknown;
    if (Array.isArray(v)) return v.every(isObject) ? v as Fields[] : undefined;
    if (isObject(v)) return [v];
    return undefined;
  } catch {
    return ndjsonEvents(trimmed);
  }
}

/** The events of an NDJSON body, one object a line (blank lines skipped); undefined when a line is not an object. */
export function ndjsonEvents(text: string): Fields[] | undefined {
  const out: Fields[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const v = objectOf(line);
    if (!v) return undefined;
    out.push(v);
  }
  return out;
}

/** The JSON object a text holds, or undefined when it holds none (not JSON, or JSON of another kind). */
export function objectOf(text: string): Fields | undefined {
  let v: unknown;
  try { v = JSON.parse(text); } catch { v = undefined; }
  return isObject(v) ? v : undefined;
}

/** The events of a CSV body: each row an event, named by `fields` or else by the first row. A quoted value may hold
 *  the delimiter, a newline or a doubled quote (RFC 4180). */
export function csvEvents(text: string, delimiter: string, fields: string[] | undefined): Fields[] {
  const rows = csvRows(text, delimiter).filter((r) => !(r.length === 1 && r[0] === ''));
  const names = fields && fields.length ? fields : rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ''])));
}

function csvRows(text: string, d: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (text.startsWith(d, i)) { row.push(cell); cell = ''; i += d.length - 1; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** An instant in milliseconds from a timestamp value: a number of seconds, milliseconds, microseconds or nanoseconds
 *  since the epoch (by its magnitude), or a date string (RFC 3339, ISO 8601, or one a Go reference `layout` names). */
export function instantOf(value: unknown, layout?: string): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return epochMs(value);
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const s = value.trim();
  if (layout) return goParse(s, layout);
  if (/^-?\d+(\.\d+)?$/.test(s)) return epochMs(Number(s));
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

const epochMs = (n: number): number => {
  const a = Math.abs(n);
  return a < 1e11 ? n * 1000 : a < 1e14 ? n : a < 1e17 ? n / 1e3 : n / 1e6;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A time in Go's reference layout (Mon Jan 2 15:04:05 -0700 MST 2006): each element of the layout read where it
 *  stands; a zone abbreviation names no offset (UTC, as Go reads an unknown one). */
export function goParse(value: string, layout: string): number | undefined {
  const tokens: Array<[string, string, string | undefined]> = [
    ['January', `(${MONTHS.join('|')})`, 'month'], ['Monday', `(${DAYS.join('|')})`, undefined], ['2006', '(\\d{4})', 'year'],
    ['Jan', `(${MONTHS.map((m) => m.slice(0, 3)).join('|')})`, 'mon'], ['Mon', `(${DAYS.map((d) => d.slice(0, 3)).join('|')})`, undefined],
    ['MST', '([A-Z]{3,5})', undefined], ['Z07:00', '(Z|[+-]\\d{2}:\\d{2})', 'zone'], ['-07:00', '([+-]\\d{2}:\\d{2})', 'zone'],
    ['Z0700', '(Z|[+-]\\d{4})', 'zone'], ['-0700', '([+-]\\d{4})', 'zone'], ['-07', '([+-]\\d{2})', 'zone'],
    ['.000000000', '\\.(\\d{9})', 'frac'], ['.000000', '\\.(\\d{6})', 'frac'], ['.000', '\\.(\\d{3})', 'frac'],
    ['.999999999', '(?:\\.(\\d{1,9}))?', 'frac'], ['.999999', '(?:\\.(\\d{1,6}))?', 'frac'], ['.999', '(?:\\.(\\d{1,3}))?', 'frac'],
    ['15', '(\\d{2})', 'hour'], ['01', '(\\d{2})', 'month#'], ['02', '(\\d{2})', 'day'], ['_2', '\\s?(\\d{1,2})', 'day'],
    ['03', '(\\d{2})', 'hour12'], ['04', '(\\d{2})', 'minute'], ['05', '(\\d{2})', 'second'], ['06', '(\\d{2})', 'year2'],
    ['PM', '(AM|PM)', 'ampm'], ['pm', '(am|pm)', 'ampm'], ['1', '(\\d{1,2})', 'month#'], ['2', '(\\d{1,2})', 'day'],
    ['3', '(\\d{1,2})', 'hour12'], ['4', '(\\d{1,2})', 'minute'], ['5', '(\\d{1,2})', 'second'],
  ];
  let pattern = '';
  const roles: string[] = [];
  for (let i = 0; i < layout.length;) {
    const hit = tokens.find(([t]) => layout.startsWith(t, i));
    if (hit) { pattern += hit[1]; roles.push(hit[2] ?? '-'); i += hit[0].length; } else { pattern += layout[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
  }
  const m = new RegExp(`^${pattern}$`).exec(value);
  if (!m) return undefined;
  const p: Record<string, string | undefined> = {};
  roles.forEach((r, i) => { if (r !== '-') p[r] = m[i + 1]; });
  const year = p.year ? Number(p.year) : p.year2 ? 2000 + Number(p.year2) : 0;
  const month = p.month ? MONTHS.indexOf(p.month) : p.mon ? MONTHS.findIndex((x) => x.startsWith(p.mon!)) : p['month#'] ? Number(p['month#']) - 1 : 0;
  let hour = p.hour ? Number(p.hour) : p.hour12 ? Number(p.hour12) % 12 : 0;
  if (p.ampm && /pm/i.test(p.ampm)) hour += 12;
  const ms = Date.UTC(year, month, p.day ? Number(p.day) : 1, hour, Number(p.minute ?? 0), Number(p.second ?? 0)) + (p.frac ? Number(`0.${p.frac}`) * 1000 : 0);
  const zone = p.zone && p.zone !== 'Z' ? /^([+-])(\d{2}):?(\d{2})?$/.exec(p.zone) : null;
  const offset = zone ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0)) * 60000 : 0;
  return ms - offset;
}

/** An event's fields as Axiom stores them: a string longer than a field may hold replaced, and a map or list nested
 *  deeper than Axiom keeps cut to null at the cut-off level. */
export function limitFields(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return new TextEncoder().encode(v).length > MAX_FIELD_BYTES ? TOO_LONG : v;
  if (v === null || typeof v !== 'object') return v;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(v)) return v.map((x) => limitFields(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Fields).map(([k, x]) => [k, limitFields(x, depth + 1)]));
}

export const MAX_FIELD_BYTES = 1024 * 1024;
export const MAX_DEPTH = 100;
export const TOO_LONG = '<invalid string: too long>';

const isObject = (v: unknown): v is Fields => !!v && typeof v === 'object' && !Array.isArray(v);
