// The Events API (https://www.tinybird.co/docs/api-reference/events-api), `POST /v0/events?name=<data source>[&wait=true]`:
// NDJSON rows or one JSON object appended to a Data Source, each the Data Source's `event` row.
import type { HandlerContext } from '@volter/world-core';
import { answer, hasScope, ingestRows, isQuarantineName, parseEventObject, readOnlyRejection, tbError, TINYBIRD_MAX_EVENTS_BYTES } from './shared.ts';

export async function datasource_events(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    // source: https://www.tinybird.co/docs/api-reference/events-api "400 The request is invalid. The body contains more information. A common cause is a missing name parameter."
    const name = query.get('name');
    if (!name) return tbError(400, "You need to provide a value for 'name' (the target Data Source)");
    // source: https://www.tinybird.co/docs/api-reference/events-api "All endpoints require authentication using a Token with DATASOURCE:APPEND or DATASOURCE:CREATE scope."
    if (!hasScope(token, 'DATASOURCES:APPEND', name) && !hasScope(token, 'DATASOURCES:CREATE')) return tbError(403, `token does not have the DATASOURCES:APPEND scope for '${name}', nor DATASOURCES:CREATE`);
    // a quarantine Data Source is written by Tinybird, never by a caller
    if (isQuarantineName(name)) return tbError(400, `'${name}' is a quarantine Data Source; quarantine tables are written by Tinybird, not appended to`);
    // source: https://www.tinybird.co/docs/api-reference/events-api "The following example shows how to push single JSON messages using the Events API"
    // Documentation stops at this input rule; the exact refusal wording is not published.
    if (query.get('format') === 'json' && !parseEventObject(req.body ?? '')) return tbError(400, 'Invalid JSON body: send a JSON object');
    if (req.readOnly) return readOnlyRejection();
    const body = req.body ?? '';
    // source: https://www.tinybird.co/docs/api-reference/events-api "413 The request payload size exceeds the limit for your plan. For example, the Free plan limit is 10 MB."
    if (Buffer.byteLength(body, 'utf8') > TINYBIRD_MAX_EVENTS_BYTES) return tbError(413, `Request Entity Too Large: the Events API accepts at most ${TINYBIRD_MAX_EVENTS_BYTES} bytes per request`);
    // source: https://www.tinybird.co/docs/api-reference/events-api "Use this endpoint to send NDJSON (new-line delimited JSON) events to a Data Source."
    const rows: Array<Record<string, unknown>> = [];
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      const obj = parseEventObject(line);
      if (!obj) return tbError(400, `Invalid NDJSON body: each line must be a JSON object (offending line: ${line.slice(0, 80)})`);
      rows.push(obj);
    }
    if (rows.length === 0) return tbError(400, 'Empty request body: send one JSON object per line (NDJSON)');
    const ingested = await ingestRows(req, name, rows);
    if ('status' in ingested) return ingested;
    // source: https://www.tinybird.co/docs/api-reference/events-api "200 The data has been inserted into the database. The write has been acknowledged. The request 'wait' parameter was enabled."
    // source: https://www.tinybird.co/docs/api-reference/events-api "202 Tinybird has processed the data and sends it to the database asynchronously."
    // the body is the same either way: the rows taken and the rows quarantined
    // source: https://www.tinybird.co/docs/classic/get-data-in/ingest-apis/events-api "{\"successful_rows\":2,\"quarantined_rows\":0}"
    const wait = query.get('wait') === 'true';
    return { status: wait ? 200 : 202, body: { successful_rows: ingested.accepted.length, quarantined_rows: ingested.quarantined.length } };
  });
}
