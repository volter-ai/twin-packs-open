// The Query API (https://www.tinybird.co/docs/api-reference/query-api), `GET /v0/sql`. A Query API request is a row of
// tinybird.pipe_stats_rt whose pipe is `query_api`, unless it read a Service Data Source.
import type { HandlerContext } from '@volter/world-core';
import { answer, logPipeRequest, requestParameters, sqlAnswer } from './shared.ts';

export async function query(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, given, token) => {
    // `POST /v0/sql` takes the query in its body: the SQL itself as text (the SDK's sql()), or a form's `q`
    // source: https://www.tinybird.co/docs/api-reference/query-api "q String The SQL query"
    const q = new URLSearchParams(given);
    if (req.method === 'POST' && req.body) {
      const type = ctx.call.request.headers.get('content-type') ?? '';
      const fields = type.includes('application/x-www-form-urlencoded') ? formFields(req.body) : undefined;
      if (fields) { for (const [k, v] of fields) if (!q.has(k)) q.set(k, v); }
      else if (!q.has('q')) q.set('q', req.body);
    }
    // source: https://www.tinybird.co/docs/api-reference/query-api "Executes a SQL query using the engine."
    const answered = sqlAnswer(req, q, token);
    // source: https://www.tinybird.co/docs/classic/monitoring/service-datasources "Calls made against Service data sources are not logged and don't count towards usage limits."
    if (!answered.service) {
      await logPipeRequest(req, { pipeId: 'query_api', pipeName: 'query_api', method: req.method, params: requestParameters(q), token, response: answered.response, ...(answered.result ? { result: answered.result } : {}) });
    }
    return answered.response;
  });
}

/** `POST /v0/sql`: the same query, its SQL in the body. */
export async function query_2(ctx: HandlerContext): Promise<Response> {
  return query(ctx);
}

/** A form's fields where it names `q`; a bare SQL body (curl's -d sends one form-typed) is the query itself. */
function formFields(body: string): Array<[string, string]> | undefined {
  const fields = [...new URLSearchParams(body)];
  return fields.some(([k]) => k === 'q') ? fields : undefined;
}
