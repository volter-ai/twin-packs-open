// QSTASH'S CONSOLE — authored from Upstash's public Quickstart, Reset token and Roll signing keys images.
// Reference URLs and capture limits live in api/spec/SOURCE.md. Region, token reset and key rotation use the
// existing stored QStash user; message/billing charts and unserved navigation are not invented.
import type { HandlerContext } from '@volter/world-core';
import { formOf, signedIn } from '@volter/world-ui';
import { openQStash, QSTASH_USER, resetQStashToken, rollSigningKeys } from '../semantics/shared.ts';
import { COOKIE, consolePage, consolePath, notAllowed, type Row, toLogin } from './shared.tsx';

const REGIONS = ['eu-central-1', 'us-east-1'];

function page(ctx: HandlerContext, person: Row, q: Row | undefined, notice?: string, status = 200): Response {
  const fields = q ? [
    { id: 'qstash-url', name: 'QSTASH_URL', value: q._url, secret: false },
    { id: 'qstash-token', name: 'QSTASH_TOKEN', value: q.token, secret: true },
    { id: 'qstash-current-key', name: 'QSTASH_CURRENT_SIGNING_KEY', value: q._current_signing_key, secret: true },
    { id: 'qstash-next-key', name: 'QSTASH_NEXT_SIGNING_KEY', value: q._next_signing_key, secret: true },
  ] : [];
  return consolePage(ctx, person, <>
    <div className="up-banner"><div className="up-banner-inner"><div className="up-heading"><h1>QStash{q ? <> / {q.region === 'eu-central-1' ? 'EU Region' : 'US Region'}</> : null}</h1><a href="https://upstash.com/docs/qstash/overall/getstarted">Docs</a></div>{q ? <div className="up-tags"><span>Pay as You Go</span><span>AWS</span><span>{String(q.region)}</span></div> : null}</div></div>
    <main className="up-main"><nav className="up-tabs" aria-label="QStash navigation"><span aria-current="page">Overview</span>{['Metrics', 'Logs', 'DLQ', 'Request Builder', 'Flow Control', 'Schedules', 'Queues', 'URL Group', 'Settings'].map(label => <span key={label} aria-disabled="true" title="Outside this twin’s declared screen scope">{label}</span>)}</nav>
      {q ? <>
        <section className="up-card"><h2>Quickstart</h2><p className="up-muted">Get started with QStash</p><div className="up-env"><div className="up-env-header"><span>.env</span></div>{fields.map(field => <div className="up-env-row" key={field.id}><label htmlFor={field.id}>{field.name}</label><input id={field.id} type={field.secret ? 'password' : 'text'} value={String(field.value)} readOnly autoComplete="off"/>{field.secret ? <button type="button" data-reveal={field.id}>Show</button> : null}<button type="button" data-copy={field.id} aria-label={`Copy ${field.name}`}>Copy</button></div>)}</div></section>
        <section className="up-card"><div className="up-heading"><div><h2>Reset Token</h2><p className="up-muted">Generate a new token for REST authentication.</p></div><button className="up-danger" type="button" data-open-dialog="reset-qstash-token">Reset token</button></div></section>
        <section className="up-card"><div className="up-heading"><div><h2>Roll Signing Key</h2><p className="up-muted">The next signing key becomes current, and a new next key is generated.</p></div><form method="post" action={consolePath(ctx, '/qstash?do=roll')}><button type="submit">Roll keys</button></form></div></section>
      </> : <section className="up-card"><h2>Get started with QStash</h2><p className="up-muted">Select a region for your QStash endpoint.</p><form method="post" action={consolePath(ctx, '/qstash?do=open')}><label className="up-field"><span>Region</span><select name="region">{REGIONS.map(region => <option key={region} value={region}>{region === 'eu-central-1' ? 'EU Region' : 'US Region'} ({region})</option>)}</select></label><button className="up-primary" type="submit">Select</button></form></section>}
    </main>
    {q ? <dialog id="reset-qstash-token" aria-labelledby="reset-title"><h2 id="reset-title">Reset token</h2><p>Your current token will stop working. Update QSTASH_TOKEN in your app after resetting it.</p><form method="post" action={consolePath(ctx, '/qstash?do=reset')}><div className="up-actions"><button type="button" data-close-dialog>Cancel</button><button className="up-danger" type="submit">Reset token</button></div></form></dialog> : null}
  </>, notice, status, 'QStash');
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const person = signedIn(ctx, COOKIE);
  if (!person) return toLogin('/qstash', ctx);
  const mine = (): Row | undefined => ctx.rowsRaw(QSTASH_USER).find((x) => x.customer_id === person.email && x.deleted !== true);
  if (request.method === 'GET') return page(ctx, person, mine());
  if (request.method !== 'POST') return notAllowed();
  const act = new URL(request.url).searchParams.get('do');
  const q = mine();
  if (act === 'open') {
    if (q) return page(ctx, person, q);
    const region = formOf(ctx).region ?? '';
    if (!REGIONS.includes(region)) return page(ctx, person, undefined, 'Choose a region.', 422);
    return page(ctx, person, await openQStash(ctx, { owner: String(person.email), region }));
  }
  if (!q) return page(ctx, person, undefined, 'Select a region first.', 422);
  if (act === 'reset') { await resetQStashToken(ctx, q); return page(ctx, person, mine(), 'Your token was reset. Update QSTASH_TOKEN wherever you use it.'); }
  if (act === 'roll') { await rollSigningKeys(ctx, q); return page(ctx, person, mine(), 'Signing keys rolled: the next key is now current.'); }
  return page(ctx, person, q, 'Choose an action.', 422);
}
