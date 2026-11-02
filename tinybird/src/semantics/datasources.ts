// The Data Sources API (https://www.tinybird.co/docs/api-reference/datasource-api): list, create from a schema, append an
// CSV or NDJSON imports from a local file or World-held URL, read one and its datafile, truncate, and delete rows by a SQL condition.
import type { HandlerContext } from '@volter/world-core';
import {
  answer, appendRows, attributes, chDateTime, createDatasource, datasourceDatafile, datasourceView, engineFromParams, filePart, fromStored, grantedResources, hasScope, isQuarantineName,
  jobKey, MODELED_ENGINES, namingRefusal, nowIso, nowMsOf, originOf, param, parseForm, parseSchemaParam, parseSql, queryRefusal, readDatasource, readOnlyRejection, rowsOfType, runSql,
  snapshot, tbError, truncateDatasource, write,
} from './shared.ts';

/** GET /v0/datasources: the Data Sources the token may read. */
export async function datasources(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, query, token) => {
    if (!hasScope(token, 'DATASOURCES:READ')) return tbError(403, 'token does not have the DATASOURCES:READ scope');
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "The token you use to query the available Data Sources will determine what Data Sources get returned: only those accessible with the token you are using will be returned in the response."
    const visible = grantedResources(token, 'DATASOURCES:READ');
    const snap = snapshot(req);
    // a Data Source's quarantine table is not listed: no page says the list returns it, and it stays reachable by its name
    // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/recover-from-quarantine "The quarantine Data Source is named {datasource_name}_quarantine and can be queried using Pipes like a regular Data Source."
    const list = [...snap.datasources.values()]
      .filter((d) => !isQuarantineName(d.name))
      .filter((d) => visible === undefined || visible.has(d.name))
      .map((d) => attributes(datasourceView(d, req, snap), query));
    return { status: 200, body: { datasources: list } };
  });
}

/** POST /v0/datasources: schema creation and CSV/NDJSON import in create, append and replace modes. */
export async function datasource_create_from_definition(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "DATASOURCES:CREATE Enables your Token to create, append, and delete data in Data Sources."
    if (!hasScope(token, 'DATASOURCES:CREATE')) return tbError(403, 'token does not have the DATASOURCES:CREATE scope');
    if (req.readOnly) return readOnlyRejection();
    const multipart = /^multipart\/form-data;\s*boundary=(.+)$/i.exec(req.headers?.['content-type'] ?? '');
    const form = multipart ? {} : parseForm(req.body);
    const get = (k: string): string | undefined => form[k] ?? query.get(k) ?? undefined;
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Default: create . Other modes: append and replace ."
    const mode = get('mode') ?? 'create';
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Default: csv . Indicates the format of the data to be ingested in the Data Source."
    const format = get('format') ?? 'csv';
    const file = multipart ? filePart(req.body ?? '', multipart[1]!.replace(/^"(.*)"$/, '$1'), format) : undefined;
    if (get('connector') !== undefined) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
    if (mode === 'append' || mode === 'replace' || file !== undefined || get('url') !== undefined) {
      return appendRows(req, { name: get('name'), mode, format, file, schema: get('schema'), get });
    }
    // Documentation stops at this input rule; the exact refusal wording is not published.
    if (mode !== 'create') return tbError(400, `Invalid import mode '${mode}'`);
    const name = get('name');
    const schema = get('schema');
    // where the page stops: it names a create without a name ("will automatically name the Data Source") and without a
    // schema (from a file or URL), neither of which a demand or life step makes; both are refused here as missing
    if (!name) return tbError(400, "You need to provide a value for 'name'");
    if (!schema) return tbError(400, "You need to provide a value for 'schema'");
    if (readDatasource(name, req)) return tbError(409, `Data Source '${name}' already exists`);
    const unnamed = namingRefusal(req, name, 'pipe');
    if (unnamed) return unnamed;
    const columns = parseSchemaParam(schema);
    if (!columns) return tbError(400, `Invalid schema: '${schema}'`);
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Engine for the underlying data. Requires the schema parameter."
    const engine = engineFromParams(get);
    if (!MODELED_ENGINES.has(engine.engine.toLowerCase())) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
    for (const key of [engine.ver, engine.isDeleted]) {
      if (key !== undefined && !columns.some((c) => c.name === key)) return tbError(400, `Engine column '${key}' is not a column of '${name}'`);
    }
    const ds = await createDatasource(name, columns, req, { engine, description: get('description') ?? '' });
    return { status: 200, body: datasourceView(ds, req) };
  });
}

/** GET /v0/datasources/<name>.datasource: the Data Source as its datafile. */
export async function datasource_file(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    const dsName = param(ctx, 'datasource');
    if (!hasScope(token, 'DATASOURCES:READ', dsName)) return tbError(403, `token does not have the DATASOURCES:READ scope for '${dsName}'`);
    const ds = readDatasource(dsName, req);
    if (!ds) return tbError(404, `Data Source '${dsName}' not found`);
    return { status: 200, body: datasourceDatafile(ds, req), headers: { 'content-type': 'text/plain' } };
  });
}

/** GET /v0/datasources/<name>. */
export async function get_datasource(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, query, token) => {
    const name = param(ctx, 'ds_name');
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Get Data Source information and stats. The token provided must have read access to the Data Source."
    if (!hasScope(token, 'DATASOURCES:READ', name)) return tbError(403, `token does not have the DATASOURCES:READ scope for '${name}'`);
    const ds = readDatasource(name, req);
    if (!ds) return tbError(404, `Data Source '${name}' not found`);
    return { status: 200, body: attributes(datasourceView(ds, req), query) };
  });
}

/** POST /v0/datasources/<name>/truncate, a quarantine table's as well. */
export async function datasource_truncate(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    const name = param(ctx, 'datasource_name');
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Truncates a Data Source in your account."
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "This works as well for the quarantine table of a Data Source."
    if (!hasScope(token, 'DATASOURCES:CREATE')) return tbError(403, `token does not have the DATASOURCES:CREATE scope, which truncating '${name}' needs`);
    if (req.readOnly) return readOnlyRejection();
    if (!readDatasource(name, req)) return tbError(404, `Data Source '${name}' not found`);
    await truncateDatasource(name, req);
    // No body. Where the documentation stops: the page shows the call and no status; 205 is the twin's, and tinybird-cli
    // reads 204 and 205 alike as an empty success (client.py `_req`: `status_code in (204, 205)`).
    return { status: 205, body: null };
  });
}

/** POST /v0/datasources/<name>/delete: the rows its condition holds for deleted, as a job. */
export async function datasource_delete_rows(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    const name = param(ctx, 'datasource_name');
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Deletes rows from a Data Source in your account given a SQL condition. Auth token in use must have the DATASOURCES:CREATE scope."
    if (!hasScope(token, 'DATASOURCES:CREATE')) return tbError(403, `token does not have the DATASOURCES:CREATE scope, which deleting rows from '${name}' needs`);
    if (req.readOnly) return readOnlyRejection();
    const ds = readDatasource(name, req);
    if (!ds) return tbError(404, `Data Source '${name}' not found`);
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Mandatory. A string representing the WHERE SQL clause"
    const condition = parseForm(req.body).delete_condition ?? query.get('delete_condition') ?? undefined;
    if (!condition) return tbError(400, "You need to provide a value for 'delete_condition'");
    // The condition is evaluated per stored row, in storage order, so each verdict names its row.
    const victims = rowsOfType('event', req)
      .filter((r) => r.ds === name)
      .sort((a, b) => (typeof a.seq === 'number' ? a.seq : 0) - (typeof b.seq === 'number' ? b.seq : 0));
    let verdicts: unknown[][];
    try {
      const rel = { columns: ds.columns.map((c) => ({ name: c.name, type: c.type })), rows: victims.map((r) => ds.columns.map((c) => fromStored((r.row as Record<string, unknown>)?.[c.name], c.type))) };
      verdicts = runSql(parseSql(`SELECT (${condition}) FROM ${name}`), { table: () => rel }, nowMsOf(req)).rows;
    } catch (e) { return queryRefusal(e, (m) => `Invalid delete_condition: ${m}`, 400); }
    let deleted = 0;
    for (let i = 0; i < victims.length; i++) {
      const v = verdicts[i]?.[0];
      if (!(v === 1 || v === true)) continue;
      await write('event', victims[i]!.id, { deleted: true }, 'event.delete', req);
      deleted++;
    }
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "When deleting rows from a Data Source, the response will not be the final result of the deletion but a Job."
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "In the response, id , job_id , and delete_id should have the same value"
    // The twin deletes at once, so the job it answers is already done: the vendor's shape, the honest status, never a
    // `waiting` for work that is finished. The job read later carries `rows_affected`; the answer's job does not, as the
    // page's two answers show.
    const at = chDateTime(nowIso(req));
    const jobId = req.store.mint('Job');
    const job = {
      kind: 'delete_data', id: jobId, job_id: jobId, status: 'done', created_at: at, updated_at: at, started_at: at,
      is_cancellable: false, datasource: { id: ds.dsId, name: ds.name }, delete_condition: condition,
    };
    await write('job', jobKey(jobId), { ...job, rows_affected: deleted, deleted: false }, 'job.create', req);
    return {
      status: 200,
      body: { id: jobId, job_id: jobId, job_url: `${originOf(req)}/v0/jobs/${jobId}`, job, status: 'done', delete_id: jobId },
    };
  });
}
