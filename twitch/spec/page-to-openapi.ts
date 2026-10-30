// Writes an OpenAPI 3.1 document of the Twitch API (Helix) from its reference page, https://dev.twitch.tv/docs/api/reference/,
// read as HTML (SOURCE.md names the bytes it read). Usage:
//   gunzip -c spec/reference.html.gz > page.html; bun spec/page-to-openapi.ts page.html openapi.json; gzip -n -9 openapi.json
//
// The page documents each endpoint in a section of its own: an h2 naming it (its anchor the operation's id), its
// Authorization (the token type and the scopes it names in bold), its URL ("GET https://api.twitch.tv/helix/users"), the
// Request Query Parameters (Parameter, Type, Required?, Description), the Request Body (Field, Type, Required?,
// Description), the Response Body (Field, Type, Description) and the Response Codes (Code, Description). A field nested
// in an object is written with its name indented by non-breaking spaces under the object's row; the indentation is read
// as nesting. The page's first table (Resource, Endpoint, Description) gives each endpoint its resource, the operation's tag.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
const html = readFileSync(inPath!, 'utf8');

const decode = (s: string): string => s
  .replace(/&nbsp;/g, '\xa0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');
/** A cell's text: its tags taken out, its entities read, its whitespace one space (a list item's end a space too). */
const text = (s: string): string => decode(s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?(?:li|ul|ol|p)(?=[\s>])[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/[\s\p{Cf}]+/gu, ' ').trim();

// ── the page's sections ───────────────────────────────────────────────────────────────────────────────────────────

/** The resource each endpoint is documented under, by its anchor (the page's first table). */
const resourceOf = new Map<string, string>();
{
  const toc = html.slice(html.indexOf('<table>'), html.indexOf('</table>', html.indexOf('<table>')));
  for (const row of toc.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td><a href="#([^"]+)">/g)) resourceOf.set(row[2]!, text(row[1]!));
}

type Cell = string;
type Table = { head: string[]; rows: Cell[][] };
function tableAfter(block: string): Table | undefined {
  const t = block.match(/<table>([\s\S]*?)<\/table>/);
  if (!t) return undefined;
  const head = [...(t[1]!.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '').matchAll(/<th>([\s\S]*?)<\/th>/g)].map((c) => text(c[1]!));
  const body = t[1]!.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]!));
  return { head, rows };
}

/** The blocks of a section's left column, by their h3 heading (its zero-width characters taken out). */
function blocks(left: string): Map<string, string> {
  const out = new Map<string, string>();
  const heads = [...left.matchAll(/<h3>([\s\S]*?)<\/h3>/g)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!;
    const end = i + 1 < heads.length ? heads[i + 1]!.index! : left.length;
    out.set(text(h[1]!), left.slice(h.index! + h[0].length, end));
  }
  return out;
}
const blockNamed = (b: Map<string, string>, names: string[]): string | undefined => names.map((n) => b.get(n)).find((x) => x !== undefined);

// ── types ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A Type cell as a schema: String, Integer, Int64, Boolean, Float, Object, a named object type (MediaSettings, Guest),
 *  `X[]`, `map[string]X` / `map[string,string]`; a row whose children are nested under it is an object (or an array of
 *  them). A cell the page leaves empty, or names no type of these, is left untyped. */
function scalar(cell: string): Record<string, unknown> | undefined {
  const t = cell.trim();
  if (/^string$/i.test(t)) return { type: 'string' };
  if (/^(integer|int)$/i.test(t)) return { type: 'integer' };
  if (/^int64$/i.test(t)) return { type: 'integer', format: 'int64' };
  if (/^(boolean|bool)$/i.test(t)) return { type: 'boolean' };
  if (/^(float|number|double)$/i.test(t)) return { type: 'number' };
  return undefined;
}
function typeOf(cell: string, hasChildren: boolean): Record<string, unknown> {
  const t = cell.trim();
  const map = t.match(/^map\[string,?\s*(\w+)\]$/i);
  if (map) return { type: 'object', additionalProperties: scalar(map[1]!) ?? {} };
  const arr = t.match(/^(.+)\[\]$/);
  if (arr) return { type: 'array', items: scalar(arr[1]!) ?? { type: 'object' } };
  if (/^array$/i.test(t)) return { type: 'array', items: hasChildren ? { type: 'object' } : {} };
  return scalar(t) ?? (hasChildren || /^(object|[A-Z]\w*)$/.test(t) ? { type: 'object' } : {});
}

type Row = { depth: number; name: string; type: string; required?: boolean; description: string };
/** A field table's rows, each with how deep its name is indented (non-breaking spaces before it, three to a level, as
 *  the page writes them; a row deeper than the last is its child). */
function fieldRows(t: Table, withRequired: boolean): Row[] {
  const rows: Row[] = [];
  for (const r of t.rows) {
    if (r.length < (withRequired ? 4 : 3)) continue;
    const raw = decode(r[0]!.replace(/<[^>]+>/g, ''));
    const lead = raw.match(/^[\s\p{Cf}]*/u)![0].replace(/\p{Cf}/gu, '').length;
    const name = raw.replace(/[\s\p{Cf}]+/gu, ' ').trim();
    if (!name) continue;
    rows.push({ depth: lead, name, type: text(r[1]!), ...(withRequired ? { required: /^yes/i.test(text(r[2]!)) } : {}), description: text(r[withRequired ? 3 : 2]!) });
  }
  return rows;
}
/** The rows as an object schema: each row's children are the rows after it indented further, until one is not. */
function objectOf(rows: Row[], withRequired: boolean): Record<string, unknown> {
  const build = (from: number, to: number): Record<string, unknown> => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    let i = from;
    while (i < to) {
      const row = rows[i]!;
      let j = i + 1;
      while (j < to && rows[j]!.depth > row.depth) j++;
      const hasChildren = j > i + 1;
      const schema: Record<string, unknown> = { ...typeOf(row.type, hasChildren), ...(row.description ? { description: row.description } : {}) };
      if (hasChildren) {
        const inner = build(i + 1, j);
        if (schema.type === 'array') schema.items = { ...(schema.items as object), ...inner, type: 'object' };
        else Object.assign(schema, inner, { type: 'object' });
      }
      // a field name the page writes with a qualifier ("user_id (optional)") is the name before it
      const name = row.name.split(/\s+/)[0]!;
      properties[name] = schema;
      if (withRequired && row.required) required.push(name);
      i = j;
    }
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  };
  return build(0, rows.length);
}

// ── the document ──────────────────────────────────────────────────────────────────────────────────────────────────

const camel = (anchor: string): string => anchor.split('-').filter(Boolean).map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('');
const pascal = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const reason: Record<string, string> = { '200': 'OK', '201': 'Created', '202': 'Accepted', '204': 'No Content' };

const paths: Record<string, Record<string, unknown>> = {};
const schemas: Record<string, unknown> = {
  // the error body the reference's examples answer a refused request with ("error": "Bad Request", "status": 400,
  // "message": "user is already banned")
  Error: { type: 'object', properties: { error: { type: 'string' }, status: { type: 'integer' }, message: { type: 'string' } } },
};
const tags = new Set<string>();
const sections = html.split('<section class="doc-content">').slice(1);
for (const section of sections) {
  const h2 = section.match(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/);
  if (!h2) continue;
  const anchor = h2[1]!;
  const leftEnd = section.indexOf('<section class="right-code">');
  const left = leftEnd < 0 ? section : section.slice(0, leftEnd);
  const b = blocks(left);
  const url = text(b.get('URL') ?? '').match(/^(GET|POST|PUT|PATCH|DELETE) https:\/\/api\.twitch\.tv\/helix(\/[^\s?]*)/);
  if (!url) continue;
  const method = url[1]!.toLowerCase();
  const path = url[2]!;
  const id = camel(anchor);
  const tag = resourceOf.get(anchor) ?? 'Other';
  tags.add(tag);
  const intro = left.slice(left.indexOf('</h2>') + 5, left.indexOf('<h3>') < 0 ? left.length : left.indexOf('<h3>'));
  const description = text(intro.replace(/<a class="editor-link"[\s\S]*?<\/a>/, ''));
  const auth = b.get('Authorization') ?? '';
  const scopes = [...new Set([...auth.matchAll(/<strong>([a-z][a-z0-9_]*(?::[a-z0-9_]+)+)<\/strong>/g)].map((m) => m[1]!))];
  const tokens = [/user access token/i.test(text(auth)) ? 'user' : '', /app access token/i.test(text(auth)) ? 'app' : '', /JWT/.test(text(auth)) ? 'jwt' : ''].filter(Boolean);
  const op: Record<string, unknown> = {
    operationId: id, summary: text(h2[2]!), tags: [tag], ...(description ? { description } : {}),
    'x-twitch-authorization': text(auth), ...(scopes.length ? { 'x-twitch-scopes': scopes } : {}), ...(tokens.length ? { 'x-twitch-tokens': tokens } : {}),
  };
  const query = blockNamed(b, ['Request Query Parameters', 'Request Query Parameter', 'Request Query Paramters']);
  const qt = query ? tableAfter(query) : undefined;
  if (qt) {
    op.parameters = fieldRows(qt, true).map((r) => ({
      name: r.name.split(/\s+/)[0], in: 'query', required: r.required === true, schema: typeOf(r.type, false), ...(r.description ? { description: r.description } : {}),
    }));
  }
  const body = blockNamed(b, ['Request Body', 'Request Body Parameters']);
  const bt = body ? tableAfter(body) : undefined;
  if (bt && bt.head.length >= 4) {
    const name = `${pascal(id)}Body`;
    schemas[name] = objectOf(fieldRows(bt, true), true);
    op.requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } } };
  }
  const responses: Record<string, unknown> = {};
  const rb = b.get('Response Body');
  const rt = rb ? tableAfter(rb) : undefined;
  let answer: string | undefined;
  if (rt && rt.head.length >= 3) {
    const rows = fieldRows(rt, false);
    if (rows.length) {
      answer = `${pascal(id)}Response`;
      const shape = objectOf(rows, false) as { properties: Record<string, Record<string, unknown>> };
      // the objects a list answers under `data` are a schema of their own, named for the operation, so the derived core
      // reads each one as the resource it is
      const data = shape.properties.data;
      if (data?.type === 'array' && (data.items as Record<string, unknown>)?.properties) {
        schemas[`${answer}Data`] = data.items;
        data.items = { $ref: `#/components/schemas/${answer}Data` };
      }
      schemas[answer] = shape;
    }
  }
  const codes = b.get('Response Codes');
  const ct = codes ? tableAfter(codes) : undefined;
  for (const r of ct?.rows ?? []) {
    const code = text(r[0]!).match(/^(\d{3})/)?.[1];
    if (!code) continue;
    const said = text(r[1] ?? '');
    const ok = code.startsWith('2');
    responses[code] = {
      description: said || reason[code] || code,
      ...(ok && answer && code !== '204' ? { content: { 'application/json': { schema: { $ref: `#/components/schemas/${answer}` } } } } : {}),
      ...(!ok ? { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } : {}),
    };
  }
  if (!Object.keys(responses).some((c) => c.startsWith('2'))) {
    responses[answer ? '200' : '204'] = { description: reason[answer ? '200' : '204']!, ...(answer ? { content: { 'application/json': { schema: { $ref: `#/components/schemas/${answer}` } } } } : {}) };
  }
  op.responses = responses;
  const item = (paths[path] ??= {});
  if (item[method]) throw new Error(`two operations at ${method.toUpperCase()} ${path}`);
  item[method] = op;
}

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Twitch API',
    version: html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1]?.slice(0, 10) ?? '',
    description: 'Written from https://dev.twitch.tv/docs/api/reference/ by spec/page-to-openapi.ts (spec/SOURCE.md).',
  },
  servers: [{ url: 'https://api.twitch.tv/helix' }],
  tags: [...tags].map((name) => ({ name })),
  paths,
  components: { schemas },
};
writeFileSync(outPath!, `${JSON.stringify(doc, null, 2)}\n`);
const ops = Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0);
console.log(`page-to-openapi: ${ops} operations, ${Object.keys(schemas).length} schemas, ${tags.size} tags`);
