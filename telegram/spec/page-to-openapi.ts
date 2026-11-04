// Writes an OpenAPI 3.1 document of the Telegram Bot API from its reference page (https://core.telegram.org/bots/api),
// read as HTML (SOURCE.md names the bytes it read). Usage: bun spec/page-to-openapi.ts <page.html> <out.json>, then
// `gzip -n -9` the output to spec/openapi.json.gz.
//
// Every method's parameters are declared twice: as its body (JSON, form or multipart) and in its query string, since
// the Bot API reads them from either (Making requests: "We support four ways of passing parameters in Bot API
// requests", the first "URL query string").
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
const html = readFileSync(inPath!, 'utf8');

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (s: string) => decode(s.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// the page in order: h3 sections and h4 items, each item's HTML up to the next heading
type Item = { section: string; name: string; anchor: string; body: string };
const items: Item[] = [];
const heads = [...html.matchAll(/<h([34])><a class="anchor" name="([^"]+)"[^>]*><i class="anchor-icon"><\/i><\/a>([\s\S]*?)<\/h\1>/g)];
let section = '';
for (let i = 0; i < heads.length; i++) {
  const h = heads[i]!;
  const end = i + 1 < heads.length ? heads[i + 1]!.index! : html.indexOf('</div>', h.index!) > 0 ? html.length : html.length;
  const body = html.slice(h.index! + h[0].length, end);
  if (h[1] === '3') { section = text(h[3]!); continue; }
  items.push({ section, name: text(h[3]!), anchor: h[2]!, body });
}
const METHOD_SECTIONS = new Set(['Getting updates', 'Available methods', 'Updating messages', 'Stickers', 'Rich messages', 'Inline mode', 'Payments', 'Telegram Passport', 'Games']);
const isType = (it: Item) => /^[A-Z][A-Za-z0-9]+$/.test(it.name) && it.section !== 'Recent changes';
const isMethod = (it: Item) => /^[a-z][A-Za-z0-9]+$/.test(it.name) && METHOD_SECTIONS.has(it.section) && !/\s/.test(it.name);
const typeNames = new Set(items.filter(isType).map((t) => t.name));

function tableRows(body: string): string[][] | null {
  const t = body.match(/<table class="table">([\s\S]*?)<\/table>/);
  if (!t) return null;
  const rows = [...t[1]!.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]!));
  return rows;
}
function beforeTable(body: string): string {
  const i = body.indexOf('<table');
  return i < 0 ? body : body.slice(0, i);
}

// a Type cell: Integer, String, Boolean, True, Float, InputFile, a type, "Array of X", "X or Y", "X, Y and Z"
function schemaOf(cell: string): any {
  const t = text(cell).replace(/\s+/g, ' ').trim();
  return parseType(t);
}
function parseType(t: string): any {
  t = t.trim();
  const arr = t.match(/^Array of (.+)$/);
  if (arr) return { type: 'array', items: parseType(arr[1]!) };
  const parts = t.split(/\s*,\s*|\s+or\s+|\s+and\s+/).filter(Boolean);
  if (parts.length > 1) return { oneOf: parts.map(parseType) };
  switch (t) {
    case 'Integer': case 'Int': return { type: 'integer' };
    case 'String': return { type: 'string' };
    case 'Boolean': return { type: 'boolean' };
    case 'True': return { type: 'boolean', enum: [true] };
    case 'False': return { type: 'boolean', enum: [false] };
    case 'Float': case 'Float number': return { type: 'number' };
    case 'InputFile': return { type: 'string', format: 'binary' };
  }
  if (typeNames.has(t)) return { $ref: `#/components/schemas/${t}` };
  throw new Error(`unknown type: ${t}`);
}

// quoted values the description states a field can take (“private”, “group” …)
function enumOf(desc: string, schema: any): any {
  if (schema.type !== 'string') return schema;
  const d = text(desc);
  const m = d.match(/(?:\balways\b|\bcan be\b|\bmust be\b|\bone of\b)/);
  if (!m) return schema;
  // the rest of the sentence the phrase opens (a sentence ends at ". " before a capital, outside quotes)
  const rest = d.slice(m.index!);
  const end = rest.search(/\.\s+[A-Z]/);
  const sentence = end < 0 ? rest : rest.slice(0, end);
  const values = [...sentence.matchAll(/“([^”]+)”/g)].map((x) => x[1]!);
  return values.length ? { ...schema, enum: [...new Set(values)] } : schema;
}

const schemas: Record<string, any> = {};
for (const it of items.filter(isType)) {
  const rows = tableRows(it.body);
  const desc = text(beforeTable(it.body));
  if (rows && rows[0]?.[0]?.trim() === 'Field') {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const r of rows.slice(1)) {
      const [f, ty, d] = r;
      const name = text(f!);
      const s = enumOf(d!, schemaOf(ty!));
      properties[name] = { ...s, description: text(d!) };
      if (!/^Optional\./.test(text(d!))) required.push(name);
    }
    schemas[it.name] = { type: 'object', description: desc, properties, ...(required.length ? { required } : {}) };
    continue;
  }
  const list = it.body.match(/<ul>([\s\S]*?)<\/ul>/);
  if (list && !rows) {
    const lis = [...list[1]!.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.trim());
    const refs = lis.map((li) => li.match(/^<a href="#[a-z0-9]+">([A-Za-z0-9]+)<\/a>$/)?.[1]).filter((n): n is string => Boolean(n && typeNames.has(n)));
    if (refs.length && refs.length === lis.length) { schemas[it.name] = { description: desc, oneOf: refs.map((n) => ({ $ref: `#/components/schemas/${n}` })) }; continue; }
  }
  // a type that holds no information yet ("Currently holds no information"), or one described in prose only
  schemas[it.name] = { type: 'object', description: desc };
}
// InputFile is the multipart upload itself, not a JSON object
schemas.InputFile = { type: 'string', format: 'binary', description: schemas.InputFile?.description ?? 'This object represents the contents of a file to be uploaded.' };

// the result an operation's description says is returned
const RETURN_OVERRIDES: Record<string, any> = {};
function resultOf(it: Item): any {
  if (RETURN_OVERRIDES[it.name]) return RETURN_OVERRIDES[it.name];
  const descHtml = beforeTable(it.body);
  const sentences = descHtml.split(/(?<=\.)\s+(?=[A-Z<])/).filter((s) => /return/i.test(text(s)));
  const found: any[] = [];
  const seen = new Set<string>();
  const add = (key: string, s: any) => { if (!seen.has(key)) { seen.add(key); found.push(s); } };
  for (const s of sentences) {
    const tx = s;
    for (const m of tx.matchAll(/(Array of |array of |an array of )?<a href="#([a-z0-9]+)">([A-Za-z0-9]+)<\/a>(s?)/g)) {
      const name = m[3]!;
      if (!typeNames.has(name)) continue;
      const isArr = Boolean(m[1]) || (m[4] === 's' && /array of/i.test(tx.slice(Math.max(0, m.index! - 40), m.index!)));
      add(`${isArr ? '[]' : ''}${name}`, isArr ? { type: 'array', items: { $ref: `#/components/schemas/${name}` } } : { $ref: `#/components/schemas/${name}` });
    }
    const plain = text(tx);
    if (/\bTrue\b/.test(plain)) add('true', { type: 'boolean', enum: [true] });
    if (/\bas String\b|\bString on success\b|\bin form of a String\b|new invite link as String/.test(plain)) add('string', { type: 'string' });
    if (/\bReturns Int(eger)?\b|\bas Int(eger)?\b|\bInt(eger)? on success\b/.test(plain)) add('integer', { type: 'integer' });
    if (/\bReturns String\b/.test(plain)) add('string', { type: 'string' });
  }
  if (!found.length) { console.error(`NO RESULT ${it.name}: ${text(descHtml)}`); return {}; }
  return found.length === 1 ? found[0] : { oneOf: found };
}

// the types a method's result names (by itself, as an array's items, or as one of several): each is what the Bot API
// answers under `result` ("If 'ok' equals True, the request was successful and the result of the query can be found
// in the 'result' field", Making requests), so each is declared a resource under its own name (`x-resourceId`, the
// declaration the spec IR reads), and the IR reads every such answer under its envelope key, `answers.key: result`.
// The page has no GET read to infer them from: every method is written as a POST.
const answered = new Set<string>();
const namedIn = (s: any): void => {
  if (!s || typeof s !== 'object') return;
  if (typeof s.$ref === 'string') answered.add(s.$ref.split('/').pop());
  if (s.items) namedIn(s.items);
  for (const alt of s.oneOf ?? []) namedIn(alt);
};

const TAG: Record<string, string> = {};
const paths: Record<string, any> = {};
const methods = items.filter(isMethod);
for (const it of methods) {
  const rows = tableRows(it.body);
  const properties: Record<string, any> = {};
  const required: string[] = [];
  let hasFile = false;
  if (rows && rows[0]?.[0]?.trim() === 'Parameter') {
    for (const r of rows.slice(1)) {
      const [p, ty, req, d] = r;
      const name = text(p!);
      const s = enumOf(d!, schemaOf(ty!));
      if (/InputFile/.test(text(ty!))) hasFile = true;
      properties[name] = { ...s, description: text(d!) };
      if (text(req!) === 'Yes') required.push(name);
    }
  }
  const body = { type: 'object', properties, ...(required.length ? { required } : {}) };
  // the same parameters in the query string, none required there (a request carries each in one place or the other)
  const query = Object.entries(properties).map(([name, schema]) => ({ name, in: 'query', required: false, description: schema.description, schema: Object.fromEntries(Object.entries(schema).filter(([k]) => k !== 'description')) }));
  const result = resultOf(it);
  namedIn(result);
  paths[`/bot{token}/${it.name}`] = {
    post: {
      operationId: it.name,
      tags: [it.section],
      summary: it.name,
      description: text(beforeTable(it.body)),
      externalDocs: { url: `https://core.telegram.org/bots/api#${it.anchor}` },
      parameters: [{ $ref: '#/components/parameters/token' }, ...query],
      ...(Object.keys(properties).length
        ? {
            requestBody: {
              required: required.length > 0,
              content: {
                'application/json': { schema: body },
                'application/x-www-form-urlencoded': { schema: body },
                'multipart/form-data': { schema: body },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'The request was successful: the result of the query is in the result field.',
          content: { 'application/json': { schema: { type: 'object', required: ['ok', 'result'], properties: { ok: { type: 'boolean', enum: [true] }, result, description: { type: 'string' } } } } },
        },
        default: { $ref: '#/components/responses/Error' },
      },
    },
  };
  TAG[it.section] = it.section;
}
// the file download path getFile names ("https://api.telegram.org/file/bot<token>/<file_path>")
paths['/file/bot{token}/{file_path}'] = {
  get: {
    operationId: 'downloadFile',
    tags: ['Available methods'],
    summary: 'Download a file',
    description: text(beforeTable(items.find((i) => i.name === 'getFile')!.body)),
    externalDocs: { url: 'https://core.telegram.org/bots/api#getfile' },
    parameters: [{ $ref: '#/components/parameters/token' }, { name: 'file_path', in: 'path', required: true, schema: { type: 'string' } }],
    responses: { '200': { description: 'The file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, default: { $ref: '#/components/responses/Error' } },
  },
};

for (const name of answered) if (schemas[name]) schemas[name]['x-resourceId'] = name;

const ver = text(html.match(/<strong>Bot API ([0-9.]+)<\/strong>/)?.[0] ?? html.match(/Bot API ([0-9.]+)/)?.[0] ?? '');
const doc = {
  openapi: '3.1.0',
  info: {
    title: 'Telegram Bot API',
    version: ver.replace(/^Bot API /, ''),
    description: 'Written from https://core.telegram.org/bots/api (spec/SOURCE.md): every method and type the page documents.',
  },
  servers: [{ url: 'https://api.telegram.org' }],
  tags: [...new Set(methods.map((m) => m.section))].map((name) => ({ name })),
  paths,
  components: {
    parameters: {
      token: { name: 'token', in: 'path', required: true, description: "The bot's authentication token, as BotFather gives it (123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11).", schema: { type: 'string' } },
    },
    responses: {
      Error: {
        description: "The request was unsuccessful: 'ok' equals False and the error is explained in the 'description'.",
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['ok', 'error_code', 'description'],
        properties: {
          ok: { type: 'boolean', enum: [false] },
          error_code: { type: 'integer' },
          description: { type: 'string' },
          parameters: { $ref: '#/components/schemas/ResponseParameters' },
        },
      },
      ...schemas,
    },
  },
};
writeFileSync(outPath!, JSON.stringify(doc, null, 1) + '\n');
console.log(`methods ${methods.length}, types ${Object.keys(schemas).length}, version ${doc.info.version}`);
