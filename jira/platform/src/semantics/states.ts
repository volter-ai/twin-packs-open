// Jira's state machines (architecture, "State"): an issue's status, in the workflow a new software project has.
import type { StateField } from '@volter/world-core';


/** An issue's status in a new project's workflow: To Do, In Progress, Done, where every status reaches every other.
 *  Where the documentation stops: a new project's workflow is its template's; the twin's is the simplified one, each
 *  status reached from each. A move the workflow does not offer never reaches here: the transition
 *  is looked up first, and one the issue does not have is refused by id. */
const issueStatus: StateField = {
  initial: 'To Do',
  transitions: [
    { operation: 'createIssue', from: ['To Do'], to: 'In Progress', source: 'spec:createIssue "A transition may be applied"' },
    { operation: 'createIssue', from: ['To Do'], to: 'Done', source: 'spec:createIssue "A transition may be applied"' },
    { operation: 'doTransition', from: ['To Do', 'In Progress', 'Done'], to: 'To Do', source: 'spec:doTransition "Performs an issue transition"' },
    { operation: 'doTransition', from: ['To Do', 'In Progress', 'Done'], to: 'In Progress', source: 'spec:doTransition "Performs an issue transition"' },
    { operation: 'doTransition', from: ['To Do', 'In Progress', 'Done'], to: 'Done', source: 'spec:doTransition "Performs an issue transition"' },
  ],
};

// source: spec:/components/schemas/Project "Whether the project is archived."
// Archive and restore operations are unmodeled: local projects stay active.
export const states = {
  IssueBean: { state: { _status: issueStatus } },
  Project: { state: { archived: { initial: 'false', transitions: [] } }, notState: ['assigneeType', 'projectTypeKey', 'style'] },
  ProjectComponent: { notState: ['assigneeType', 'realAssigneeType'] },
};
