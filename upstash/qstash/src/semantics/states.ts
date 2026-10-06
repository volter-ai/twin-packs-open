// QStash's state machines (docs/contributing/architecture.md, "What an author writes": states), each move cited, and its
// rulings of what is not state; the manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

/** A workflow run's `workflowState` (the WorkflowRun schema): started by its first invocation, a success when `serve()`
 *  ends it (the SDK's `DELETE /v2/workflows/runs/{id}?cancel=false`), canceled on a user's request (`cancel=true`), and
 *  failed when a step is out of retries (QStash's own move). */
const workflowState: StateField = {
  initial: 'RUN_STARTED',
  transitions: [
    { operation: 'delete_v2_workflows_runs_workflowrunid', from: ['RUN_STARTED'], to: 'RUN_SUCCESS', source: 'spec:/components/schemas/WorkflowRun "The workflow run has completed succesfully."' },
    { operation: 'delete_v2_workflows_runs_workflowrunid', from: ['RUN_STARTED'], to: 'RUN_CANCELED', source: 'spec:/components/schemas/WorkflowRun "The workflow run has canceled upon user request."' },
    { actor: 'vendor', from: ['RUN_STARTED'], to: 'RUN_FAILED', source: 'spec:/components/schemas/WorkflowRun "Some errors has occured and workflow failed after all retries."' },
  ],
};

export const states = {
  WorkflowRun: { state: { workflowState } },
  // a queue's `paused` is set by pause and resume, which no application calls (the gap); not moved by any served rule
  Queue: { notState: ['paused'] },
};
