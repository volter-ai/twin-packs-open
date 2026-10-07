// Linear's state machines (architecture, "State"). An issue's workflow state is data (a team's WorkflowStates, each a
// record an issue points at, any to any), not a machine; the machine is an issue's archival.
import type { StateField } from '@volter/world-core';

/** An issue archived (`archivedAt` set) is out of every list; archiving it again is refused. Where the documentation
 *  stops: the refusal's message is the twin's. */
export const archival: StateField = {
  initial: 'active',
  derive: [{ state: 'archived', when: { truthy: true } }],
  transitions: [
    { operation: 'mutation.issueArchive', from: ['active'], to: 'archived', source: 'https://linear.app/developers/graphql "Archived resources are hidden by default"' },
    { operation: 'mutation.issueArchive', from: ['archived'], refusal: { status: 400, message: 'Entity already archived' }, source: 'https://linear.app/developers/graphql "Archived resources are hidden by default"' },
  ],
};

export const states = {
  issue: { state: { archivedAt: archival }, notState: ['priority'] },
  project: { notState: ['state'] },
  workflow_state: { notState: ['type'] },
};
