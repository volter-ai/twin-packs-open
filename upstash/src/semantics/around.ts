// UPSTASH'S REST API (https://upstash.com/docs/redis/features/restapi): the front of every request to a database's
// endpoint. It reads the vendor's forms, checks the database's token, runs the commands with the kernel's Redis core
// under Upstash's dialect (ctx.redis), and answers in the vendor's envelope. The forms:
//   POST /            ["SET", "foo", "bar", "EX", 100]           one command in the body ("POST Command in Body")
//   /set/foo/bar      a command and its arguments in the path ("API Semantics"); a POST body is its last argument, and
//                     a query's other parameters follow it ("JSON or Binary Value")
//   POST /pipeline    [[...], [...]]  each answered, in order, not atomically ("Pipelining")
//   POST /multi-exec  [[...], [...]]  the same, as one transaction; a malformed command discards it whole ("Transactions")
// Answers: `{ result }` (200) or `{ error }` (400); a pipeline's and a transaction's an array of each. `Upstash-Encoding:
// base64` encodes every string of a result except the status reply OK ("Base64 Encoded Responses", and probed). A missing
// or wrong token: 401. A method other than HEAD, GET, POST and PUT: 405 ("HTTP Codes").
//
// `Upstash-Response-Format: resp2` answers the same replies as RESP2 bytes (application/octet-stream), but at /multi-exec.
//
// Where the documentation stops and the probes of 2026-08-19 decide: the 401's text; an empty body's "EOF", a body that
// is not an array's "expected JSON array" and each argument type's refusal; a 405's empty body; an OPTIONS preflight
// answered 200 with the origin echoed; `upstash-sync-token`, a counter the SDK sends back, moved by each write. Where
// neither does: a Read Only token's write is refused as Redis refuses a user's command its ACL denies (NOPERM).
import { redis, readHostPort, type HandlerContext } from '@volter/world-core';
import { databaseAt, DIALECT } from './shared.ts';

type Row = Record<string, unknown>;

// source: https://upstash.com/docs/redis/features/restapi "401 Unauthorized"
const UNAUTHORIZED = 'WRONGPASS invalid or missing auth token. See https://docs.upstash.com/redis/troubleshooting/http_unauthorized for details.';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-credentials': 'true' };

const answer = (body: unknown, status: number, extra: Record<string, string> = {}): Response => new Response(redis.jsonReply(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const refusal = (error: string, status = 400): Response => answer({ error }, status);

const hostOf = (request: Request): string => readHostPort(request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host)?.host ?? '';

/** The caller's token: `?_token=` wins over the header, which may carry `Bearer <token>` or the token alone (probed). */
// source: https://upstash.com/docs/redis/features/restapi "or set the token as a url parameter"
function tokenOf(request: Request, query: URLSearchParams): string | undefined {
  const q = query.get('_token');
  if (q) return q;
  const raw = request.headers.get('authorization')?.trim();
  if (!raw) return undefined;
  const bearer = /^bearer\s+(.+)$/i.exec(raw);
  return (bearer ? bearer[1]! : raw).trim() || undefined;
}

/** One JSON argument as a command argument: a string, a number or a boolean; anything else refused in the vendor's words. */
function argOf(v: unknown): string | { error: string } {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return { error: 'ERR null args are not supported' };
  return { error: `ERR unsupported arg type: "${Array.isArray(v) ? '[' : '{'}": json.Delim` };
}
function commandOf(raw: unknown): string[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'expected JSON array' };
  if (raw.length === 0) return { error: 'ERR empty command' };
  const out: string[] = [];
  for (const v of raw) {
    const a = argOf(v);
    if (typeof a !== 'string') return a;
    out.push(a);
  }
  return out;
}
function parsed(text: string): unknown | { error: string } {
  if (!text.trim()) return { error: 'EOF' };
  try { return JSON.parse(text); } catch { return { error: 'ERR invalid JSON' }; }
}
const failed = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Row).error === 'string';

/** A result as the envelope carries it: the status reply as its text, and under base64 every other string encoded. */
function encoded(v: redis.RedisValue, base64: boolean): unknown {
  if (v instanceof redis.RedisStatus) return base64 && v.value !== 'OK' ? Buffer.from(v.value, 'utf8').toString('base64') : v.value;
  if (typeof v === 'string') return base64 ? Buffer.from(v, 'utf8').toString('base64') : v;
  if (Array.isArray(v)) return v.map((x) => encoded(x, base64));
  return v;
}

/** A World started read-only refuses a write as Upstash's REST API refuses a method it does not take (405). */
function readOnlyWorld(): Response {
  return new Response(null, { status: 405 });
}

/** The command engine's unexpected exception (any but a read-only World's) is a kernel defect, not a Redis wire refusal. */
function engineFailure(e: unknown): never {
  throw e;
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') {
    const origin = request.headers.get('origin') ?? '*';
    return new Response(null, { status: 200, headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'HEAD, GET, POST, PUT', 'access-control-allow-headers': request.headers.get('access-control-request-headers') ?? '*' } });
  }
  if (!['HEAD', 'GET', 'POST', 'PUT'].includes(method)) return new Response(null, { status: 405 });
  // the twin's discovery is the kernel's (its doors are answered before this front)
  if (url.pathname === '/twin') return next();

  const token = tokenOf(request, url.searchParams);
  const host = hostOf(request);
  const databases = ctx.rowsRaw('database');
  // An SDK using the descriptor's direct loopback URL has no vendor Host. Its issued
  // database token selects the same database; an explicitly named vendor host stays binding.
  const db = databaseAt(databases, host) ?? (/^(?:localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)
    ? databases.find(d => d.deleted !== true && token && (d.rest_token === token || d.read_only_rest_token === token)) : undefined);
  if (!db || !token || (token !== db.rest_token && token !== db.read_only_rest_token)) return refusal(UNAUTHORIZED, 401);
  const readOnlyToken = token === db.read_only_rest_token;
  if (method === 'HEAD') return new Response(null, { status: 200 });

  // Upstash-Encoding: base64, and Upstash-Response-Format: json (the default) or resp2
  const encoding = request.headers.get('upstash-encoding');
  if (encoding !== null && encoding !== '' && encoding !== 'base64') return refusal(`ERR invalid Upstash-Encoding: ${encoding}`);
  const format = request.headers.get('upstash-response-format');
  // source: https://upstash.com/docs/redis/features/restapi "Any format other than json and resp2 is not allowed and will result in a HTTP 400 Bad Request."
  // source: https://upstash.com/docs/redis/features/restapi "setting the Upstash-Encoding header to base64 is not permitted when the Upstash-Response-Format is set to resp2"
  // Where the documentation stops: neither 400's text; each is refused in the envelope's {error}.
  if (format !== null && format !== 'json' && format !== 'resp2') return refusal(`ERR invalid Upstash-Response-Format: ${format}`);
  if (format === 'resp2' && encoding === 'base64') return refusal('ERR Upstash-Encoding base64 is not permitted with Upstash-Response-Format resp2');
  const base64 = encoding === 'base64';

  const path = url.pathname.replace(/\/+$/, '') || '/';
  const text = method === 'POST' || method === 'PUT' ? ctx.text : '';
  let commands: string[][];
  const batch = path === '/pipeline' || path === '/multi-exec';
  if (batch) {
    const raw = parsed(text);
    if (failed(raw)) return refusal(raw.error);
    if (!Array.isArray(raw)) return refusal('expected JSON array');
    commands = [];
    for (const row of raw) {
      const c = commandOf(row);
      if (failed(c)) return refusal(c.error);
      commands.push(c);
    }
    if (commands.length === 0) return refusal('ERR empty command');
  } else if (path === '/') {
    const raw = parsed(text);
    if (failed(raw)) return refusal(raw.error);
    const c = commandOf(raw);
    if (failed(c)) return refusal(c.error);
    commands = [c];
  } else {
    const argv = path.slice(1).split('/').map((seg) => decodeURIComponent(seg));
    if (text) argv.push(text);
    for (const [k, v] of url.searchParams) if (k !== '_token') argv.push(k, v);
    commands = [argv];
  }

  // queue time: a transaction with a malformed command is discarded whole; a single command is refused; a pipeline's
  // is answered in its place, as each command of a pipeline is
  const malformed = new Map<number, string>();
  commands.forEach((argv, i) => {
    const shape = redis.commandShapeError(argv, DIALECT);
    if (shape !== null) malformed.set(i, shape);
  });
  if (malformed.size && path !== '/pipeline') return refusal(malformed.values().next().value!);
  // a Read Only token reaches the read commands only ("Read Only token permits access to the read commands only. Some
  // powerful read commands (e.g. SCAN, KEYS) are also restricted"); where the documentation stops, its refusal is Redis's
  // ACL words
  // source: https://upstash.com/docs/redis/features/restapi "Some powerful read commands"
  const denied = new Map<number, string>(malformed);
  if (readOnlyToken) {
    commands.forEach((argv, i) => {
      const name = argv[0]!.toUpperCase();
      if (!denied.has(i) && (redis.isWriteCommand(name, argv.slice(1), DIALECT) || name === 'SCAN' || name === 'KEYS')) denied.set(i, `NOPERM this user has no permissions to run the '${name.toLowerCase()}' command`);
    });
    // a single command or a transaction is refused whole; a pipeline answers each denied command in its place
    if (denied.size && path !== '/pipeline') return refusal([...denied.values()].pop()!);
  }

  let run: { items: redis.RunItem[]; wrote: boolean };
  try {
    const ran = await ctx.redis(commands.filter((_, i) => !denied.has(i)), { dialect: DIALECT, database: String(db.database_id) });
    const items = [...ran.items];
    run = { wrote: ran.wrote, items: commands.map((_, i) => (denied.has(i) ? { error: denied.get(i)! } : items.shift()!)) };
  } catch (e) { if (e instanceof redis.ReadOnlyError) return readOnlyWorld(); return engineFailure(e); }
  const incoming = request.headers.get('upstash-sync-token');
  const base = incoming && /^[0-9a-v]+$/.test(incoming) ? Number.parseInt(incoming, 32) : 0;
  const sync = { 'upstash-sync-token': (run.wrote ? base + 1 : base).toString(32) };
  // source: https://upstash.com/docs/redis/features/restapi "the response content type is set to application/octet-stream and the raw response is returned as binary similar to a TCP-based Redis client"
  // source: https://upstash.com/docs/redis/features/restapi "This option is not applicable to /multi-exec transactions endpoint, as it only returns response in JSON format."
  // Where the documentation stops: a pipeline's replies follow one another, as a TCP client reads a pipeline's; a refused
  // command's error reply keeps the JSON envelope's 400.
  if (format === 'resp2' && path !== '/multi-exec') {
    const failedOne = !batch && 'error' in run.items[0]!;
    return new Response(run.items.map((i) => redis.resp2('error' in i ? { error: i.error } : i.result)).join(''), { status: failedOne ? 400 : 200, headers: { 'content-type': 'application/octet-stream', 'access-control-allow-credentials': 'true', ...sync } });
  }
  const item = (i: redis.RunItem): Row => ('error' in i ? { error: i.error } : { result: encoded(i.result, base64) });
  if (batch) return answer(run.items.map(item), 200, sync);
  const one = run.items[0]!;
  return 'error' in one ? refusal(one.error) : answer({ result: encoded(one.result, base64) }, 200, sync);
}
