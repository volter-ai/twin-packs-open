// Axiom's datasets family: the legacy ingest (spec: ingestIntoDataset), which @axiomhq/js sends every batch to
// (`POST /v1/datasets/<dataset>/ingest`, NDJSON). Each event is kept as the vendor's own record (`event`), as the legacy
// query answers an entry: `_time` (the event's time), `_sysTime` (when it was ingested), `_rowId` and `data`, its fields
// as sent. The dataset list (getDatasets) is the core's.
import { s3, type HandlerContext } from '@volter/world-core';
import { csvEvents, type Fields, instantOf, jsonEvents, limitFields, ndjsonEvents, objectOf } from '../engine/ingest.ts';
import { axiomError, datasetOf, EVENT, tokenOf } from './shared.ts';

// source: https://axiom.co/docs/reference/limits "Axiom reserves the following field names for internal use:"
const RESERVED = ['_blockInfo', '_cursor', '_rowID', '_source', '_sysTime'];
const DAY_MS = 24 * 60 * 60 * 1000;

// source: spec:ingestIntoDataset "Ingest (Legacy)"
// source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "Ingests JSON, NDJSON, CSV, or Logplex events into an events or logs dataset through api.axiom.co ."
export async function ingestIntoDataset(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const name = String(ctx.call.params.dataset_name ?? '');
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "404 Dataset not found."
  const dataset = datasetOf(ctx, name);
  if (!dataset) return axiomError(404, 'Dataset not found');
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "403 The token can't ingest into this dataset, the dataset is shared, or the organization is suspended."
  const token = tokenOf(ctx);
  if (!token || !(token.datasets as string[] | undefined ?? []).includes(name)) return axiomError(403, 'Forbidden');

  const query = new URL(request.url).searchParams;
  // the kernel has decoded a gzip, zstd, br or deflate body (the manifest's encodings)
  const bytes = s3.bytesOf(request);
  const text = new TextDecoder().decode(bytes);
  const type = (request.headers.get('content-type') ?? 'application/json').split(';')[0]!.trim().toLowerCase();
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "Supported formats: JSON, NDJSON, CSV."
  // source: https://axiom.co/docs/restapi/ingest "Set the Content-Type header to either application/json or application/x-ndjson ."
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "If not specified, the first line of the CSV will be used as the field names."
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "If not specified, the default delimiter is , ."
  const csvFields = request.headers.get('x-axiom-csv-fields');
  const events = type === 'text/csv'
    ? csvEvents(text, query.get('csv-delimiter') || ',', csvFields ? csvFields.split(',').map((f) => f.trim()).filter(Boolean) : undefined)
    : type === 'application/x-ndjson' ? ndjsonEvents(text) : jsonEvents(text);
  // Where the documentation stops: the page gives no answer for a body that is not the format its Content-Type names;
  // the twin refuses it with the ingest page's 400.
  if (!events) return axiomError(400, `invalid ${type === 'application/x-ndjson' ? 'NDJSON' : 'JSON'} body`);

  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "An optional JSON encoded object with additional labels to add to all events in the request"
  // Where the documentation stops: a label and an event field of one name; the event's own field is kept.
  const labelHeader = request.headers.get('x-axiom-event-labels');
  const labels = labelHeader === null ? {} : objectOf(labelHeader);
  if (!labels) return axiomError(400, 'X-Axiom-Event-Labels is not a JSON object');

  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "The name of the field to use as the timestamp. If not specified, the timestamp will be the time the event was received by Axiom."
  // source: https://axiom.co/docs/restapi/endpoints/ingestIntoDataset "The reference time is Mon Jan 2 15:04:05 -0700 MST 2006"
  const timeField = query.get('timestamp-field') || '_time';
  const layout = query.get('timestamp-format') || undefined;
  const received = Date.parse(ctx.occurredAt);
  const failures: Array<{ timestamp: string; error: string }> = [];
  let ingested = 0;
  for (const sent of events) {
    const fields: Fields = { ...labels, ...sent };
    // source: https://axiom.co/docs/reference/limits "If you try to ingest a field with a reserved name, Axiom renames the ingested field to _user_FIELDNAME ."
    for (const r of RESERVED) if (r in fields) { fields[`_user_${r.slice(1)}`] = fields[r]; delete fields[r]; }
    // source: https://axiom.co/docs/reference/limits "Axiom assigns the time of the data ingest to the events."
    // source: https://axiom.co/docs/reference/limits "Axiom accepts many date strings and timestamps without knowing the format in advance, including Unix Epoch, RFC3339, or ISO 8601."
    // Where the documentation stops: the field the timestamp is read from becomes the event's `_time` and is not kept
    // beside it; a value that is no time is refused as an out-of-range one is.
    const given = fields[timeField];
    delete fields[timeField];
    const at = given === undefined || given === null ? received : instantOf(given, layout);
    // source: https://axiom.co/docs/reference/limits "Axiom rejects events with a timestamp more than 24 hours in the future or before the Unix epoch"
    if (at === undefined || at < 0 || at > received + DAY_MS) {
      failures.push({ timestamp: ctx.occurredAt, error: at === undefined ? `invalid timestamp in field ${timeField}` : 'timestamp is outside the accepted range' });
      continue;
    }
    // source: https://axiom.co/docs/reference/limits "Replaces strings that are too long with <invalid string: too long> ."
    // source: https://axiom.co/docs/reference/limits "Truncates maps and slices that nest deeper than 100 levels and replaces them with nil at the cut-off level."
    const data = limitFields(fields) as Fields;
    const rowId = ctx.mint(EVENT);
    // source: https://axiom.co/docs/reference/limits "_sysTime is the time when you ingested the data."
    await ctx.write(EVENT, rowId, { _time: new Date(at).toISOString(), _sysTime: ctx.occurredAt, _rowId: rowId, data, _dataset: String(dataset.id) }, 'event.create');
    ingested++;
  }
  // source: https://axiom.co/docs/reference/limits "If every event in a request is rejected, Axiom responds with the HTTP status code 400 ."
  if (events.length > 0 && ingested === 0) return axiomError(400, failures[0]?.error ?? 'every event was rejected');
  // source: https://axiom.co/docs/reference/limits "If a request contains both valid and rejected events, Axiom stores the valid events, responds with the HTTP status code 200 , counts the rejected events in failed , and lists them in failures ."
  // Where the documentation stops: blocks and the WAL are Axiom's storage; the twin writes no block, and the WAL holds
  // what this request stored.
  return Response.json({ ingested, failed: failures.length, failures, processedBytes: bytes.length, blocksCreated: 0, walLength: ingested });
}
