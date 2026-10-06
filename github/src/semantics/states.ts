// GitHub's state machines (docs/contributing/architecture.md, "The semantics layer"): each state field's values, its
// initial value and every move the twin's served operations, doors and GitHub itself make, with its source; and, per
// resource, the candidates that are not state, each with its reason. The manifest takes each resource's whole. A move
// only an operation the twin does not serve makes is not declared, and is named beside the machine it would belong to.
import type { StateField, Transition } from '@volter/world-core';

const ISSUES = 'https://docs.github.com/en/rest/issues/issues#update-an-issue';
const CLOSING = 'https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue';
const MERGE = 'https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request';
const BRANCHES = 'https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository';
const RUNS = 'https://docs.github.com/en/rest/actions/workflow-runs';
const RUNNERS = 'https://docs.github.com/actions/about-github-actions/understanding-github-actions';
const ADVISORIES = 'https://docs.github.com/en/rest/security-advisories/repository-advisories';

const byVendor = (from: string[], to: string, source: string): Transition => ({ actor: 'vendor', from, to, source });

/** An issue's `state`: open or closed by an update, and closed by GitHub when a pull request that says it closes the
 *  issue merges into the default branch, or a commit that says so reaches it. */
// source: https://docs.github.com/en/rest/issues/issues "The open or closed state of the issue."
// source: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue "When you merge a linked pull request into the default branch of a repository, its linked issue is automatically closed."
const issueState: StateField = {
  initial: 'open',
  transitions: [
    { operation: 'issues/update', from: ['open', 'closed'], to: 'closed', source: ISSUES },
    { operation: 'issues/update', from: ['closed', 'open'], to: 'open', source: ISSUES },
    byVendor(['open'], 'closed', CLOSING),
  ],
};

/** A pull request's `state`: open until merged ("405 Method Not Allowed if merge cannot be performed", for one already
 *  closed), and closed when its head branch is deleted. Closing and reopening by an update (pulls/update) is an
 *  operation the twin does not serve. */
// source: https://docs.github.com/en/rest/pulls/pulls "405 Method Not Allowed if merge cannot be performed"
// source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-and-deleting-branches-within-your-repository "If the branch is associated with at least one open pull request, deleting the branch closes the pull requests."
const pullState: StateField = {
  initial: 'open',
  transitions: [
    { operation: 'pulls/merge', from: ['open'], to: 'closed', refusal: { status: 405, message: 'Pull Request is not mergeable' }, source: MERGE },
    byVendor(['open'], 'closed', BRANCHES),
  ],
};

/** A pull request's `merged`: false until merged, then for good. */
// source: https://docs.github.com/en/rest/pulls/pulls "405 Method Not Allowed if merge cannot be performed"
const pullMerged: StateField = {
  initial: 'false',
  transitions: [{ operation: 'pulls/merge', from: ['false'], to: 'true', refusal: { status: 405, message: 'Pull Request is not mergeable' }, source: MERGE }],
};

/** A workflow run's `status`: queued (or, a fork's first-time contributor's, waiting for a maintainer's approval),
 *  picked up by a runner and completed by it. Approving, cancelling and re-running a run are operations the twin does
 *  not serve. */
// source: https://docs.github.com/actions/about-github-actions/understanding-github-actions "A runner is a server that runs your workflows when they're triggered. Each runner can run a single job at a time."
// source: https://docs.github.com/en/rest/actions/workflow-runs "Only GitHub Actions can set a status of waiting , pending , or requested ."
const runStatus: StateField = {
  initial: 'queued',
  transitions: [
    byVendor(['queued'], 'in_progress', RUNNERS),
    byVendor(['in_progress'], 'completed', RUNS),
  ],
};

/** A job's `status`: as its run's, moved by the runner. */
// source: https://docs.github.com/actions/about-github-actions/understanding-github-actions "A runner is a server that runs your workflows when they're triggered. Each runner can run a single job at a time."
const jobStatus: StateField = {
  initial: 'queued',
  transitions: [
    byVendor(['queued'], 'in_progress', RUNNERS),
    byVendor(['queued', 'in_progress'], 'completed', RUNS),
  ],
};

/** A check run's `status`: a workflow job's check run, queued, in progress and completed as the runner moves its job.
 *  An App's own updates (checks/update) are an operation the twin does not serve. */
// source: https://docs.github.com/en/rest/checks/runs "The current status of the check run. Only GitHub Actions can set a status of waiting , pending , or requested ."
const checkStatus: StateField = {
  initial: 'queued',
  transitions: [
    byVendor(['queued'], 'in_progress', RUNNERS),
    byVendor(['queued', 'in_progress'], 'completed', RUNNERS),
  ],
};

/** A repository security advisory's `state`: a draft published or closed, a closed one reopened as a draft; any other
 *  move refused as GitHub refuses taking a published advisory back to a draft. Triage (a private report) and withdrawal
 *  are made by no operation the twin serves. */
// source: https://docs.github.com/en/rest/security-advisories/repository-advisories "Can be one of : published , closed , draft"
// source: spec:security-advisories/update-repository-advisory "Invalid state transition from `published` to `draft`."
const ADVISORY_REFUSED = { status: 422, message: 'Invalid state transition from `{from}` to `{to}`.' };
const advisoryState: StateField = {
  initial: 'draft',
  transitions: [
    { operation: 'security-advisories/update-repository-advisory', from: ['draft'], to: 'published', refusal: ADVISORY_REFUSED, source: ADVISORIES },
    { operation: 'security-advisories/update-repository-advisory', from: ['draft'], to: 'closed', refusal: ADVISORY_REFUSED, source: ADVISORIES },
    { operation: 'security-advisories/update-repository-advisory', from: ['closed'], to: 'draft', refusal: ADVISORY_REFUSED, source: ADVISORIES },
  ],
};

/** Each kind of subject's machines, and its rulings of what is not state: fields that record what a request set or what
 *  GitHub computes, never moved by a rule. */
const of = {
  // a lock, a draft flag, an association and a close's reason are set as they are asked or computed, never moved by a rule
  issue: { state: { state: issueState }, notState: ['author_association', 'state_reason', 'active_lock_reason', 'draft', 'locked'] },
  issueComment: { notState: ['author_association'] },
  // a pull request's draft flag is set when it is opened; marking it ready or a draft again is GraphQL's
  // markPullRequestReadyForReview and convertPullRequestToDraft, which no demand or life step sends (the gap)
  pull: { state: { state: pullState, merged: pullMerged }, notState: ['author_association', 'active_lock_reason', 'mergeable_state', 'locked', 'draft'] },
  pullSimple: { state: { state: pullState }, notState: ['author_association', 'active_lock_reason', 'locked', 'draft'] },
  // a milestone is made open or closed as its create asks; moving it is issues/update-milestone, which the twin does not serve
  milestone: { notState: ['state'] },
  review: { notState: ['author_association', 'state'] },
  workflowRun: { state: { status: runStatus }, notState: ['conclusion'] },
  job: { state: { status: jobStatus }, notState: ['conclusion'] },
  checkRun: { state: { status: checkStatus }, notState: ['conclusion'] },
  // a membership is made active by the organization's making (the orgs door); accepting an invitation is
  // orgs/update-membership-for-authenticated-user, which the twin does not serve, and its role is set as asked
  orgMembership: { notState: ['state', 'role'] },
  // the fields a request sets as it names them
  team: { notState: ['privacy', 'notification_setting', 'permission', 'type'] },
  org: { notState: ['is_verified'] },
  // archiving, a template flag and the creation policy are settings an update sets and unsets as asked
  repository: { notState: ['visibility', 'squash_merge_commit_title', 'squash_merge_commit_message', 'merge_commit_title', 'merge_commit_message', 'archived', 'disabled', 'is_template', 'pull_request_creation_policy'] },
  commitStatus: { notState: ['state'] },
  releaseAsset: { notState: ['state'] },
  workflow: { notState: ['state'] },
  // a hook's `active` is set as asked
  hook: { notState: ['active'] },
  // a release's draft is set as its create asks: a flag, not a machine
  release: { notState: ['draft'] },
  installation: { notState: ['repository_selection', 'target_type'] },
  // an advisory's severity is set as asked
  repositoryAdvisory: { state: { state: advisoryState }, notState: ['severity'] },
  // a ruleset's enforcement and target are settings an update sets as asked; its source and the caller's bypass are what
  // it is and who reads it
  repositoryRuleset: { notState: ['current_user_can_bypass', 'enforcement', 'source_type', 'target'] },
  // a branch policy's type is what it matches, branches or tags
  deploymentBranchPolicy: { notState: ['type'] },
};

/** Each resource's machines and rulings, by the resource's name in the manifest (the manifest takes its own whole). */
export const states = {
  'organization-full': of.org,
  'org-membership': of.orgMembership,
  'team-full': of.team,
  'full-repository': of.repository,
  'repository': of.repository,
  'milestone': of.milestone,
  'issue': of.issue,
  'issue-comment': of.issueComment,
  'pull-request': of.pull,
  'pull-request-simple': of.pullSimple,
  'pull-request-review': of.review,
  'status': of.commitStatus,
  'release': of.release,
  'release-asset': of.releaseAsset,
  'hook': of.hook,
  'workflow': of.workflow,
  'workflow-run': of.workflowRun,
  'job': of.job,
  'check-run': of.checkRun,
  'repository-advisory': of.repositoryAdvisory,
  'installation': of.installation,
  'repository-ruleset': of.repositoryRuleset,
  'deployment-branch-policy': of.deploymentBranchPolicy,
};
