// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"), each declared in the manifest's
// `doors`: how an application the World does not run answers QStash, and what QStash sent.
import type { HandlerContext } from '@volter/world-core';
import { DELIVERY, DESTINATION, durationMs, type Row } from './shared.ts';

/** The World's door refused a stand-in with no URL or status. */
function notADestination(): Response {
  return Response.json({ error: 'url and status are required (and takes, when given, a duration)' }, { status: 400 });
}

/** POST /_twin/destinations {url, status, headers?, body?, takes?, when?}: the answer an application gives at that URL
 *  (or under it) when no application of the World answers there, with its headers, `takes` later on the World's clock
 *  (`<number><unit>`, 10s or 2m; the attempt holds its key's slot until then, and one that may wait less gives up when
 *  it may wait no longer); with `when` ({header: value}), only to a request carrying
 *  those headers (the same route's failure function answering while its steps fail). */
export async function destinations(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  const takes = typeof b.takes === 'string' ? durationMs(b.takes) : 0;
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url) || !Number.isInteger(b.status) || takes === undefined) return notADestination();
  const lowered = (v: unknown): Record<string, string> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k.toLowerCase(), String(x)])) : {});
  const when = lowered(b.when);
  await ctx.record(DESTINATION, { url: b.url, status: b.status, headers: lowered(b.headers), body: typeof b.body === 'string' ? b.body : '', takes, when }, `${b.url} ${JSON.stringify(when)}`);
  return new Response(null, { status: 204 });
}

/** GET /_twin/deliveries?to=<url>[&run=<workflow run id>][&message=<message id>]: every request QStash made to that URL
 *  (or under it), of that workflow run or that message when one is named, oldest first, each with its answer's status once it has arrived, and what was missed
 *  when none came (`timeout`: the attempt gave up; `unreachable`: nothing answered there). */
export async function deliveries(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const to = q.get('to') ?? '';
  const run = q.get('run');
  const message = q.get('message');
  const out = ctx.rowsRaw(DELIVERY).filter((d) => String(d.url).startsWith(to) && (!run || d.run === run) && (!message || d.message === message)).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((d) => ({ message: d.message, ...(d.run ? { run: d.run } : {}), url: d.url, method: d.method, headers: d.headers, body: d.body, retried: d.retried, ...(d.status !== undefined ? { status: d.status } : {}), ...(d.missed ? { missed: d.missed } : {}), at: d.at }));
  return Response.json({ deliveries: out });
}
