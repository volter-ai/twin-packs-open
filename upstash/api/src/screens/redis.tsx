// UPSTASH'S REDIS PAGES — console.upstash.com/redis: "Create Database", its name and primary region, then the
// database's page with its REST endpoint and tokens, `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and "For
// the Read Only token, just enable the Read-Only Token switch" (https://upstash.com/docs/redis/overall/getstarted;
// https://upstash.com/docs/redis/features/restapi). Its Delete asks the database's name to confirm. A person sees the
// databases they made. Where the documentation stops: the regions offered are AWS's the page lists first, the plan is
// the free one, and the confirmation is typing the name. A workspace (docs/contributing/architecture.md, "Screens").
import { redis, type HandlerContext } from '@volter/world-core';
import { formOf, redirect, signedIn } from '@volter/world-ui';
import { DATABASE, DIALECT, makeDatabase } from '../semantics/shared.ts';
import { COOKIE, consolePage, consolePath, notAllowed, type Row, toLogin } from './shared.tsx';

// source: https://upstash.com/docs/redis/overall/getstarted "Create Database"
const REGIONS = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1', 'sa-east-1'];

function listPage(person: Row, ctx: HandlerContext, notice?: string, status = 200): Response {
  const mine = ctx.rowsRaw(DATABASE).filter((d) => d.user_email === person.email && d.deleted !== true);
  return consolePage(ctx, person, <>
    <div className="up-banner"><div className="up-banner-inner"><div className="up-heading"><h1>Redis</h1><button className="up-primary" type="button" data-open-dialog="create-database">+ Create Database</button></div></div></div>
    <main className="up-main"><nav className="up-tabs" aria-label="Redis navigation"><span aria-current="page">Databases</span></nav>{mine.length ? <><label><span className="up-muted">Search databases</span><br/><input className="up-search" data-database-search placeholder="Search databases"/></label><div className="up-grid">{mine.map(d => <a className="up-database" key={String(d.database_id)} data-database-name={String(d.database_name).toLowerCase()} href={consolePath(ctx, `/redis/${String(d.database_id)}`)}><strong>{String(d.database_name)}</strong><span className="up-muted">{String(d.primary_region)} · Free</span></a>)}</div></> : <section className="up-card"><h2>Create your first database</h2><p className="up-muted">No databases yet.</p><button className="up-primary" type="button" data-open-dialog="create-database">Create Database</button></section>}</main>
    <dialog id="create-database" aria-labelledby="create-title"><h2 id="create-title">Create Database</h2><form method="post" action={consolePath(ctx, '/redis')}><label className="up-field"><span>Database Name</span><input name="name" required pattern="[A-Za-z0-9_-]{1,64}" maxLength={64}/></label><label className="up-field"><span>Primary Region</span><select name="region">{REGIONS.map(region => <option key={region} value={region}>{region}</option>)}</select></label><p className="up-muted">Free · one primary region. Read regions and paid plans are outside this twin’s declared screen scope.</p><div className="up-actions"><button type="button" data-close-dialog>Cancel</button><button className="up-primary" type="submit">Create</button></div></form></dialog>
  </>, notice, status);
}

function databaseTabs(ctx: HandlerContext, d: Row, active: 'Details' | 'Data Browser') {
  return <nav className="up-tabs" aria-label="Database navigation">{['Details', 'Usage', 'CLI', 'Data Browser', 'Search', 'Monitor', 'Backups', 'ACL'].map(label => label === 'Details' || label === 'Data Browser'
    ? <a key={label} aria-current={active === label ? 'page' : undefined} href={consolePath(ctx, `/redis/${String(d.database_id)}${label === 'Data Browser' ? '/data-browser' : ''}`)}>{label}</a>
    : <span key={label} aria-disabled="true" title="Outside this twin’s declared screen scope">{label}</span>)}</nav>;
}

function databaseHeading(ctx: HandlerContext, d: Row) {
  return <div className="up-banner"><div className="up-banner-inner"><div className="up-heading"><h1><a href={consolePath(ctx, '/redis')}>Redis</a> / {String(d.database_name)}</h1><a href="https://upstash.com/docs/redis/overall/getstarted">Docs</a></div><div className="up-tags"><span>Free</span><span>AWS</span><span>{String(d.primary_region)}</span></div></div></div>;
}

const KEY_TYPES = [['string', 'String'], ['list', 'List'], ['hash', 'Hash'], ['set', 'Set'], ['zset', 'Sorted Set'], ['stream', 'Stream']] as const;
const scalarText = (value: redis.RedisValue): string => value instanceof redis.RedisStatus ? value.value : value instanceof redis.RedisInteger ? value.integer : String(value ?? '');

function contents(kind: string, value: redis.RedisValue) {
  if (kind === 'string') return <div className="up-browser-string"><label htmlFor="redis-key-value">Value</label><textarea id="redis-key-value" aria-label="Value" value={scalarText(value)} readOnly spellCheck={false}/>{value === '' ? <p className="up-muted">Empty string.</p> : null}</div>;
  if (!Array.isArray(value)) return <p role="alert">The key’s value changed. Refresh to read it again.</p>;
  const paired = kind === 'hash' || kind === 'zset';
  const headings = kind === 'hash' ? ['Fields', 'Content'] : kind === 'zset' ? ['Member', 'Score'] : kind === 'stream' ? ['ID', 'Content'] : ['Index', 'Content'];
  const rows: Array<[string, string]> = paired
    ? Array.from({ length: Math.floor(value.length / 2) }, (_, i) => [scalarText(value[i * 2]!), scalarText(value[i * 2 + 1]!)])
    : value.map((entry, i) => kind === 'stream' && Array.isArray(entry) ? [scalarText(entry[0]!), redis.jsonReply(entry[1])] : [String(i), scalarText(entry)]);
  return rows.length ? <table className="up-browser-table"><thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map(([field, content], i) => <tr key={i}><td><code>{field}</code></td><td><code>{content}</code></td></tr>)}</tbody></table> : <p className="up-browser-empty">No entries.</p>;
}

// Public layout reference: Upstash's 2024-10-30 session-management article and its Data Browser screenshot.
// The screenshot supplies Search / All Types / Refresh, the key sidebar, content panel and TTL footer.
// No memory estimate or database-wide count is inferred from these replies, and no mutation control is served.
// source: https://upstash.com/blog/session-management-nextjs "The Data Browser tab will show the session data"
// source: https://upstash.com/docs/redis/troubleshooting/command_count_increases_unexpectedly "SCAN: To iterate through the keyspace"
async function dataBrowserPage(ctx: HandlerContext, person: Row, d: Row): Promise<Response> {
  const query = new URL(ctx.call.request.url).searchParams;
  const pattern = query.get('pattern') ?? '';
  const kind = query.get('type') ?? '';
  const cursor = query.get('cursor') ?? '0';
  const base = `/redis/${String(d.database_id)}/data-browser`;
  const link = (changes: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams({ pattern, type: kind, cursor });
    if (query.has('key')) params.set('key', query.get('key')!);
    for (const [name, value] of Object.entries(changes)) value === undefined ? params.delete(name) : params.set(name, value);
    return consolePath(ctx, `${base}?${params}`);
  };
  const failed = (message: string) => consolePage(ctx, person, <>{databaseHeading(ctx, d)}<main className="up-main">{databaseTabs(ctx, d, 'Data Browser')}<p className="up-notice" role="alert">{message}</p><a href={consolePath(ctx, base)}>Back to Data Browser</a></main></>, undefined, 400);
  if (kind && !KEY_TYPES.some(([type]) => type === kind)) return failed('Choose a key type from All Types.');
  // The console owner has access to this database's Standard credential. The screen uses the same native
  // Redis context as that credential's REST requests; the database ownership check precedes this function.
  const run = (commands: string[][]) => ctx.redis(commands, { dialect: DIALECT, database: String(d.database_id) });
  const scan = (await run([['SCAN', cursor, 'MATCH', pattern || '*', 'COUNT', '100', ...(kind ? ['TYPE', kind] : [])]])).items[0]!;
  if ('error' in scan) return failed(scan.error);
  const scanReply = scan.result as redis.RedisValue[];
  const next = scalarText(scanReply[0]!);
  const keys = (scanReply[1] as redis.RedisValue[]).map(scalarText);
  const types = keys.length ? (await run(keys.map(key => ['TYPE', key]))).items : [];
  const selected = query.has('key') ? query.get('key')! : keys[0];
  let type = 'none';
  let ttl = '';
  let value: redis.RunItem | undefined;
  let error: string | undefined;
  if (selected !== undefined) {
    const [typeReply, ttlReply] = (await run([['TYPE', selected], ['TTL', selected]])).items;
    if ('error' in typeReply!) error = typeReply.error;
    else type = scalarText(typeReply!.result);
    if ('error' in ttlReply!) error = ttlReply.error;
    else ttl = scalarText(ttlReply!.result);
    // Only existing declared Redis reads: each answer is the kernel's native value under this database's scope.
    const command = type === 'string' ? ['GET', selected] : type === 'hash' ? ['HGETALL', selected] : type === 'list' ? ['LRANGE', selected, '0', '-1'] : type === 'set' ? ['SMEMBERS', selected] : type === 'zset' ? ['ZRANGE', selected, '0', '-1', 'WITHSCORES'] : type === 'stream' ? ['XRANGE', selected, '-', '+'] : undefined;
    if (!error && command) value = (await run([command])).items[0]!;
    if (value && 'error' in value) error = value.error;
  }
  const present = type !== 'none' && ttl !== '-2' && value && 'result' in value && value.result !== null;
  const typeLabel = KEY_TYPES.find(([name]) => name === type)?.[1] ?? type;
  return consolePage(ctx, person, <>
    {databaseHeading(ctx, d)}
    <main className="up-main">{databaseTabs(ctx, d, 'Data Browser')}
      <div className="up-browser" aria-label="Data Browser">
        <aside className="up-browser-sidebar" aria-label="Redis keys">
          <form className="up-browser-search" method="get" action={consolePath(ctx, base)}>
            <input name="pattern" aria-label="Search" placeholder="Search" title="Redis key pattern, for example app:*" defaultValue={pattern}/>
            <select name="type" aria-label="Key type" defaultValue={kind}><option value="">All Types</option>{KEY_TYPES.map(([name, label]) => <option key={name} value={name}>{label}</option>)}</select>
            <button type="submit" aria-label="Search keys">Search</button>
          </form>
          <div className="up-browser-tools"><a href={link()} aria-label="Refresh keys">Refresh</a></div>
          <div className="up-browser-keys">{keys.length ? keys.map((key, i) => {
            const reply = types[i]!;
            const keyType = 'error' in reply ? undefined : scalarText(reply.result);
            return <a className="up-browser-key" key={key} href={link({ key })} aria-current={selected === key ? 'true' : undefined}><span className="up-key-type" title={keyType}>{keyType === 'hash' ? 'H' : keyType === 'zset' ? 'Z' : keyType === 'stream' ? 'X' : (keyType ?? '?').slice(0, 1).toUpperCase()}</span><span className="up-key-name">{key || '(empty key)'}</span><span aria-hidden="true">›</span></a>;
          }) : <p className="up-browser-empty">{pattern || kind ? 'No keys match this search.' : 'No keys on this page.'}</p>}</div>
          <div className="up-browser-pagination"><span>{keys.length} keys on this page</span><nav aria-label="Key pages">{cursor !== '0' ? <a href={link({ cursor: '0', key: undefined })}>First page</a> : null}{next !== '0' ? <a href={link({ cursor: next, key: undefined })}>Next page</a> : null}</nav></div>
        </aside>
        <section className="up-browser-content" aria-label="Selected key">
          {selected === undefined ? <p className="up-browser-empty">Select a key to view its value.</p> : <>
            <header className="up-browser-title"><h2>{selected || '(empty key)'}</h2>{present ? <span className="up-browser-kind">{typeLabel}</span> : null}{type === 'string' && present ? <button type="button" data-copy="redis-key-value">Copy</button> : null}</header>
            <div className="up-browser-value">{error ? <p role="alert">{error}</p> : !present ? <p className="up-browser-empty">Key not found or expired. Refresh to read the current keys.</p> : value && 'result' in value ? contents(type, value.result) : null}</div>
            {present ? <footer className="up-browser-footer">TTL: {ttl === '-1' ? 'No expiration' : `${ttl}s`}</footer> : null}
          </>}
        </section>
      </div>
    </main>
  </>);
}

function databasePage(ctx: HandlerContext, person: Row, d: Row, notice?: string, status = 200): Response {
  const url = `https://${String(d.endpoint)}.upstash.io`;
  return consolePage(ctx, person, <>
    {databaseHeading(ctx, d)}
    <main className="up-main">{databaseTabs(ctx, d, 'Details')}
      <section className="up-card"><div className="up-connection"><div><small>Endpoint</small><code>{String(d.endpoint)}.upstash.io</code></div><div><small>Token / Readonly Token</small><code>••••••••</code></div><div><small>Port</small><code>6379</code></div><div><small>TLS/SSL</small><span>Enabled</span></div></div></section>
      <section className="up-card"><h2>Connect</h2><p className="up-muted">Connect to your Redis database from your app.</p><div className="up-env"><div className="up-env-header"><span>REST</span><a href="https://upstash.com/docs/redis/features/restapi">REST API documentation</a></div><div className="up-env-row"><label htmlFor="redis-url">UPSTASH_REDIS_REST_URL</label><input id="redis-url" value={url} readOnly/><button type="button" data-copy="redis-url">Copy</button></div><div className="up-env-row"><label htmlFor="redis-token">UPSTASH_REDIS_REST_TOKEN</label><input id="redis-token" type="password" value={String(d.rest_token)} readOnly autoComplete="off"/><button type="button" data-reveal="redis-token">Show</button><button type="button" data-copy="redis-token">Copy</button></div><div className="up-env-row"><label htmlFor="readonly-token">Read-Only Token</label><input id="readonly-token" type="password" value={String(d.read_only_rest_token)} readOnly autoComplete="off"/><button type="button" data-reveal="readonly-token">Show</button><button type="button" data-copy="readonly-token">Copy</button></div></div></section>
      <section className="up-card"><h2>Delete Database</h2><p className="up-muted">This removes the stored database. Type its name to confirm.</p><form method="post" action={consolePath(ctx, `/redis/${String(d.database_id)}/delete`)}><label className="up-field"><span>Type {String(d.database_name)} to confirm</span><input name="confirm" required autoComplete="off"/></label><button className="up-danger" type="submit">Delete</button></form></section>
    </main>
  </>, notice, status);
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin(`${path}${url.search}`, ctx);
  if (path === '/redis') {
    if (request.method === 'GET') return listPage(person, ctx);
    if (request.method !== 'POST') return notAllowed();
    const f = formOf(ctx);
    const name = (f.name ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return listPage(person, ctx, 'A name of letters, digits, hyphens and underscores is required.', 422);
    if (!REGIONS.includes(f.region ?? '')) return listPage(person, ctx, 'Choose a primary region.', 422);
    if (ctx.rowsRaw(DATABASE).some((d) => d.user_email === person.email && d.database_name === name && d.deleted !== true)) return listPage(person, ctx, `A database named ${name} exists.`, 409);
    const d = await makeDatabase(ctx, { owner: String(person.email), name, region: f.region! });
    return redirect(consolePath(ctx, `/redis/${String(d.database_id)}`));
  }
  const m = /^\/redis\/([0-9a-f-]{36})(\/delete|\/data-browser)?$/.exec(path);
  const d = m ? ctx.rowsRaw(DATABASE).find((x) => x.database_id === m[1] && x.user_email === person.email && x.deleted !== true) : undefined;
  if (!m || !d) return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (m[2] === '/data-browser') return request.method === 'GET' ? dataBrowserPage(ctx, person, d) : new Response('Method Not Allowed', { status: 405, headers: { 'content-type': 'text/plain', allow: 'GET' } });
  if (!m[2]) return request.method === 'GET' ? databasePage(ctx, person, d) : notAllowed();
  if (request.method !== 'POST') return notAllowed();
  if ((formOf(ctx).confirm ?? '').trim() !== d.database_name) return databasePage(ctx, person, d, 'Type the database\'s name to confirm.', 422);
  await ctx.remove(DATABASE, String(d.database_id), 'database.delete');
  return listPage(person, ctx, `Database ${String(d.database_name)} deleted.`);
}
