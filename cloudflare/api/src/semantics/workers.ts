// Workers (Cloudflare's "Workers" API, the Worker as a resource over its scripts and versions): a Worker is the script
// the account deployed under its name, as the Worker Script API stores it.
import type { HandlerContext } from '@volter/world-core';
import { noScript, ok, type Row, scriptNamed } from './shared.ts';

/** `GET …/workers/workers/{id}`: the Worker, by its name, with its workers.dev subdomain settings (wrangler reads them
 *  after an upload to decide the Worker's workers.dev route). */
// source: spec:getWorker "Get details about a specific Worker."
export async function getWorker(ctx: HandlerContext): Promise<Response> {
  const s = scriptNamed(ctx, String(ctx.call.params.account_id), String(ctx.call.params.worker_id));
  if (!s) return noScript();
  const subdomain = (s.subdomain as Row | undefined) ?? { enabled: false, previews_enabled: false };
  return ok({
    id: s.name, name: s.name, tags: s.tags ?? [], subdomain, observability: s.observability ?? { enabled: false }, logpush: false, tail_consumers: [],
    created_on: s.created_on, updated_on: s.modified_on, deployed_on: s.modified_on ?? null, references: {},
  });
}
