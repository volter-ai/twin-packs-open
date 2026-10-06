// Workflow runs: each started by its first invocation (a publish or batch with `Upstash-Workflow-Init: true`, ./shared.ts)
// and ended by `serve()` when the route function returns, or cancelled on request.
import type { HandlerContext } from '@volter/world-core';
import { fail, MESSAGE, pending, RUN } from './shared.ts';

/** `DELETE /v2/workflows/runs/{id}?cancel=false|true`: `serve()`'s end of a run (a success), or a cancel, whose pending
 *  steps are cancelled with it. */
// source: spec:delete_v2_workflows_runs_workflowrunid "Cancel an ongoing workflow run."
export async function delete_v2_workflows_runs_workflowrunid(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.workflowRunId);
  const run = ctx.row(RUN, id);
  if (!run) return fail(404, 'workflow run not found');
  const cancel = new URL(ctx.call.request.url).searchParams.get('cancel') === 'true';
  const to = cancel ? 'RUN_CANCELED' : 'RUN_SUCCESS';
  const refused = ctx.legal('WorkflowRun', 'workflowState', 'delete_v2_workflows_runs_workflowrunid', String(run.workflowState), to, id);
  if (refused) return fail(400, `workflow run is ${String(run.workflowState)}`);
  const now = Date.parse(ctx.occurredAt);
  if (cancel) for (const m of ctx.rowsRaw(MESSAGE).filter((x) => x._run === id && pending(x))) await ctx.write(MESSAGE, String(m.messageId), { _state: 'CANCELLED', _resolved: now }, 'message.cancel');
  await ctx.write(RUN, id, { workflowState: to, workflowRunCompletedAt: now }, cancel ? 'workflow_run.cancel' : 'workflow_run.success');
  return new Response(null, { status: 200 });
}
