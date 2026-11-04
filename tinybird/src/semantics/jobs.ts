// The Jobs API (https://www.tinybird.co/docs/api-reference/jobs-api): the jobs a Workspace ran, and one of them. Its
// list's filters (kind, status, a Pipe, a time range) are variants no demand or life step asks for: the gap (a refresh
// reads the list whole).
import type { HandlerContext } from '@volter/world-core';
import { answer, getRow, hasScope, jobKey, jobOf, jobsListed, originOf, param, tbError } from './shared.ts';

const FILTERS = ['kind', 'status', 'pipe_id', 'pipe_name', 'created_after', 'created_before'];

/** GET /v0/jobs: each listed job with the address it is polled at. */
export async function jobs(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, query, token) => {
    if (!hasScope(token, 'DATASOURCES:READ')) return tbError(403, 'token does not have the DATASOURCES:READ scope');
    // source: https://www.tinybird.co/docs/api-reference/jobs-api "with the possibility of filtering them by kind, status, pipe_id, pipe_name, created_after, and created_before."
    if (FILTERS.some((f) => query.has(f))) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
    return { status: 200, body: { jobs: jobsListed(req).map((job) => ({ ...job, job_url: `${originOf(req)}/v0/jobs/${String(job.id)}` })) } };
  });
}

/** GET /v0/jobs/<id>. */
export async function job(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    if (!hasScope(token, 'DATASOURCES:READ')) return tbError(403, 'token does not have the DATASOURCES:READ scope');
    // source: https://www.tinybird.co/docs/api-reference/jobs-api "Depending on the job kind , it returns certain information related with the specific job, along with the status of the job."
    const id = param(ctx, 'job_id');
    const found = getRow('job', jobKey(id), req);
    if (!found) return tbError(404, `Job '${id}' not found`);
    return { status: 200, body: jobOf(found) };
  });
}
