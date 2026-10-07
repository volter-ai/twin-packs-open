// What Linear shares: the caller (an OAuth app's grant, acting as the app, or a person's API key), a workspace's
// objects as its GraphQL schema names them, and Linear's default workflow states for a new team.
import { GraphqlError, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const ORG = 'organization';
export const USER = 'user';
export const TEAM = 'team';
export const STATE = 'workflow_state';
export const PROJECT = 'project';
export const ISSUE = 'issue';
export const COMMENT = 'comment';
export const LABEL = 'issue_label';
export const APP = '_app';
export const CODE = '_code';
export const ACCESS = '_access_token';
export const REFRESH = '_refresh_token';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = <T = Row>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');
const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);

/** A token-shaped value (Linear's are 64 hex digits), drawn from the World's secret. */
export const hexToken = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> => sha256(ctx, await ctx.secret(label));

/** Relation ids survive refresh in the vendor's nested response shape. Private ids are local indexes. */
export const relation = (r: Row | undefined, field: string): unknown => r?.[`_${field}`] ?? obj(r?.[field]).id;
export function belongs(ctx: HandlerContext, r: Row, org: string): boolean {
  if (r._org !== undefined) return r._org === org;
  return observedParentBelongs(ctx, r, org);
}

export type Caller = { org: string; user: string; scope: string[]; teamIds?: string[] };
/** The caller `Authorization` names: `Bearer <OAuth token>` (the app's actor), or a person's API key as it is. */
export function callerOf(ctx: HandlerContext): Caller {
  const header = ctx.call.request.headers.get('authorization') ?? '';
  const value = /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? (header.startsWith('lin_api_') ? header : undefined);
  const t = value ? live(ctx.rowsRaw(ACCESS).find((r) => r.sha256 === sha256(ctx, value) && r.revoked !== true)) : undefined;
  // source: https://linear.app/developers/oauth-2-0-authentication "The access token is valid for 24 hours"
  if (!t || (t.expires && Date.parse(String(t.expires)) <= Date.parse(ctx.occurredAt))) throw new GraphqlError('Authentication required, not authenticated', 'authentication error');
  return { org: String(t.org), user: String(t.user), scope: String(t.scope ?? 'read write').split(/[ ,]+/), ...(Array.isArray(t.teamIds) ? { teamIds: arr<string>(t.teamIds) } : {}) };
}
/** A write needs the `write` scope. */
export function writer(ctx: HandlerContext): Caller {
  const c = callerOf(ctx);
  if (!c.scope.includes('write') && !c.scope.includes('admin')) throw new GraphqlError('Invalid scope: `write` required', 'forbidden');
  return c;
}

/** A workspace's object by id, or the GraphQL error Linear answers for an entity it cannot find. */
export function mine(ctx: HandlerContext, c: Caller, type: string, id: unknown, what: string): Row {
  const r = live(ctx.row(type, ctx.resolve(type, String(id ?? ''))));
  // Where the documentation stops: the message is the twin's, in Linear's "Entity not found" form
  if (!r || !belongs(ctx, r, c.org) || (c.teamIds && (type === TEAM ? !c.teamIds.includes(String(r.id)) : relation(r, 'team') && !c.teamIds.includes(String(relation(r, 'team')))))) throw new GraphqlError(`Entity not found: ${what}`, 'invalid input');
  return r;
}

// Where the documentation stops: a new team's states are the app's defaults (Backlog, Todo, In Progress, In Review,
// Done, Canceled, Duplicate), each of the schema's WorkflowState types
export const DEFAULT_STATES: Array<{ name: string; type: string; color: string }> = [
  { name: 'Backlog', type: 'backlog', color: '#bec2c8' }, { name: 'Todo', type: 'unstarted', color: '#e2e2e2' },
  { name: 'In Progress', type: 'started', color: '#f2c94c' }, { name: 'In Review', type: 'started', color: '#0f783c' },
  { name: 'Done', type: 'completed', color: '#5e6ad2' }, { name: 'Canceled', type: 'canceled', color: '#95a2b3' },
  { name: 'Duplicate', type: 'canceled', color: '#95a2b3' },
];

/** The priority's label, as Linear names each level. */
export const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

// The stored response models selected by the demand-pinned SDK. Field names and nullability are the vendored SDL's;
// values below describe this synthetic workspace, not undocumented production defaults. Optional integrations,
// cycles, sharing, automation and agent sessions are unconfigured; their mutations remain outside this scope.
export const USER_FIELDS = [
  'id', 'name', 'displayName', 'email', 'description', 'avatarUrl', 'createdIssueCount', 'avatarBackgroundColor',
  'statusUntilAt', 'statusEmoji', 'initials', 'updatedAt', 'lastSeen', 'timezone', 'disableReason', 'statusLabel',
  'archivedAt', 'createdAt', 'gitHubUserId', 'title', 'url', 'active', 'isAssignable', 'guest', 'admin', 'owner',
  'app', 'isMentionable', 'supportsAgentSessions', 'canAccessAnyPublicTeam', 'calendarHash', 'inviteHash',
];
export const TEAM_FIELDS = [
  'id', 'name', 'key', 'description', 'createdAt', 'updatedAt', 'cycleIssueAutoAssignCompleted', 'cycleLockToActive',
  'cycleIssueAutoAssignStarted', 'cycleCalenderUrl', 'upcomingCycleCount', 'autoArchivePeriod', 'autoClosePeriod',
  'securitySettings', 'integrationsSettings', 'activeCycle', 'triageResponsibility', 'scimGroupName', 'autoCloseStateId',
  'cycleCooldownTime', 'cycleStartDay', 'defaultTemplateForMembers', 'defaultTemplateForNonMembers',
  'defaultProjectTemplate', 'defaultIssueState', 'cycleDuration', 'icon', 'defaultTemplateForMembersId',
  'defaultTemplateForNonMembersId', 'issueEstimationType', 'displayName', 'color', 'parent', 'archivedAt', 'retiredAt',
  'timezone', 'visibility', 'mergeWorkflowState', 'draftWorkflowState', 'startWorkflowState', 'mergeableWorkflowState',
  'reviewWorkflowState', 'markedAsDuplicateWorkflowState', 'triageIssueState', 'defaultIssueEstimate',
  'setIssueSortOrderOnStateChange', 'allMembersCanJoin', 'requirePriorityToLeaveTriage', 'autoCloseChildIssues',
  'autoCloseParentIssues', 'scimManaged', 'private', 'inheritIssueEstimation', 'inheritWorkflowStatuses', 'cyclesEnabled',
  'issueEstimationExtended', 'issueEstimationAllowZero', 'aiDiscussionSummariesEnabled', 'aiThreadSummariesEnabled',
  'groupIssueHistory', 'slackIssueComments', 'slackNewIssue', 'slackIssueStatuses', 'triageEnabled', 'inviteHash',
  'issueOrderingNoPriorityFirst', 'issueSortOrderDefaultToBottom',
];
export const ISSUE_FIELDS = [
  'id', 'number', 'identifier', 'title', 'description', 'priority', 'url', 'createdAt', 'updatedAt', 'archivedAt',
  'dueDate', 'estimate', 'completedAt', 'trashed', 'reactionData', 'labelIds', 'integrationSourceType',
  'previousIdentifiers', 'reactions', 'customerTicketCount', 'sharedAccess', 'branchName', 'delegate', 'botActor',
  'sourceComment', 'cycle', 'syncedWith', 'externalUserCreator', 'asksExternalUserRequester', 'asksRequester',
  'lastAppliedTemplate', 'boardOrder', 'sortOrder', 'prioritySortOrder', 'subIssueSortOrder', 'parent',
  'projectMilestone', 'recurringIssueTemplate', 'startedTriageAt', 'triagedAt', 'addedToCycleAt', 'addedToProjectAt',
  'addedToTeamAt', 'autoArchivedAt', 'autoClosedAt', 'canceledAt', 'startedAt', 'slaStartedAt', 'slaBreachesAt',
  'slaHighRiskAt', 'slaMediumRiskAt', 'snoozedUntilAt', 'slaType', 'snoozedBy', 'favorite', 'inheritsSharedAccess',
];

// The same native models survive refresh. Relation ids stay in the vendor's response shape; isMe stays caller-relative.
export const USER_SELECTION = USER_FIELDS.join(' ');
export const TEAM_SELECTION = TEAM_FIELDS.map((field) => [
  'integrationsSettings', 'activeCycle', 'triageResponsibility', 'defaultTemplateForMembers', 'defaultTemplateForNonMembers',
  'defaultProjectTemplate', 'defaultIssueState', 'parent', 'mergeWorkflowState', 'draftWorkflowState', 'startWorkflowState',
  'mergeableWorkflowState', 'reviewWorkflowState', 'markedAsDuplicateWorkflowState', 'triageIssueState',
].includes(field) ? `${field} { id }` : field).join(' ') + ' issueCount _totalIssueCount: issueCount(includeArchived: true)';
export const ISSUE_SELECTION = ISSUE_FIELDS.map((field) => {
  if (field === 'sharedAccess') return 'sharedAccess { disallowedIssueFields isShared sharedWithCount sharedWithUsers { id } viewerHasOnlySharedAccess }';
  if (field === 'reactions') return 'reactions { id emoji createdAt updatedAt archivedAt comment { id } externalUser { id } initiativeUpdate { id } issue { id } projectUpdate { id } user { id } }';
  if (field === 'botActor') return 'botActor { id name avatarUrl subType type userDisplayName }';
  if (field === 'syncedWith') return 'syncedWith { id service metadata { ... on ExternalEntityInfoGithubMetadata { number owner repo } ... on ExternalEntityInfoJiraMetadata { issueTypeId projectId issueKey } ... on ExternalEntitySlackMetadata { messageUrl channelId channelName isFromSlack } } }';
  return ['delegate', 'sourceComment', 'cycle', 'externalUserCreator', 'asksExternalUserRequester', 'asksRequester',
    'lastAppliedTemplate', 'parent', 'projectMilestone', 'recurringIssueTemplate', 'snoozedBy', 'favorite'].includes(field) ? `${field} { id }` : field;
}).join(' ') + ' priorityLabel team { id } state { id } creator { id } assignee { id } project { id } labels { nodes { id } }';

/** The profile written when the synthetic person or app joins this workspace. Caller-relative isMe is a resolver. */
export function userFields(ctx: HandlerContext, id: string, input: {
  org: string; name: string; displayName: string; email: string; admin: boolean; owner?: boolean; app?: boolean;
}): Row {
  const names = input.name.trim().split(/\s+/);
  // source: https://linear.app/docs/profile "first and last initials"
  const initials = [names[0], ...(names.length > 1 ? [names.at(-1)] : [])].map((name) => Array.from(name ?? '')[0] ?? '').join('').toUpperCase();
  const workspace = ctx.row(ORG, input.org)!;
  return {
    id, name: input.name, displayName: input.displayName, email: input.email, description: null, title: null,
    avatarUrl: null, avatarBackgroundColor: `#${sha256(ctx, `linear-avatar:${id}`).slice(0, 6)}`, initials,
    createdIssueCount: 0, statusUntilAt: null, statusEmoji: null, statusLabel: null, lastSeen: null, timezone: null,
    disableReason: null, archivedAt: null, gitHubUserId: null, active: true, admin: input.admin, owner: input.owner === true,
    guest: false, app: input.app === true, isAssignable: input.app !== true, isMentionable: input.app !== true,
    supportsAgentSessions: false, canAccessAnyPublicTeam: true, calendarHash: null,
    inviteHash: sha256(ctx, `linear-user-invite:${id}`),
    // source: https://linear.app/docs/members-roles "profiles/<username>"
    url: `https://linear.app/${workspace.urlKey}/profiles/${encodeURIComponent(input.displayName)}`,
    createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, _org: input.org,
  };
}

/** The same app actor shape whether installed by consent or by a client-credentials settings toggle. */
export function appUserFields(ctx: HandlerContext, id: string, org: string, app: Row): Row {
  return { ...userFields(ctx, id, { org, name: String(app.name), displayName: String(app.name).toLowerCase().replace(/\s+/g, ''),
    // The schema requires an email. This is a synthetic actor address, never a guessed production app address.
    email: `app-${id}@linear-world.invalid`, admin: false, app: true }), _app: app.id };
}

/** An explicitly synthetic public team; disabled features have no configured resource or automation. */
export function teamFields(ctx: HandlerContext, id: string, org: string, input: Row): Row {
  return {
    id, name: input.name, displayName: input.name, key: input.key, description: input.description ?? null,
    createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, archivedAt: null, retiredAt: null, parent: null,
    // source: https://linear.app/docs/teams "Sections marked with an * are opt-in"
    cyclesEnabled: false, triageEnabled: false, activeCycle: null, triageResponsibility: null, triageIssueState: null,
    // The SDL documents the timezone default. The remaining numbers are chosen inactive starter settings.
    timezone: 'America/Los_Angeles', cycleDuration: 1, cycleCooldownTime: 0, cycleStartDay: 1, upcomingCycleCount: 0,
    cycleIssueAutoAssignCompleted: false, cycleLockToActive: false, cycleIssueAutoAssignStarted: false,
    cycleCalenderUrl: '', autoArchivePeriod: 0, autoClosePeriod: null, autoCloseStateId: null,
    securitySettings: {}, integrationsSettings: null, scimGroupName: null, scimManaged: false,
    defaultTemplateForMembers: null, defaultTemplateForNonMembers: null, defaultProjectTemplate: null,
    defaultTemplateForMembersId: null, defaultTemplateForNonMembersId: null, defaultIssueState: null,
    icon: null, color: null, issueEstimationType: 'notUsed', issueEstimationExtended: false, issueEstimationAllowZero: false,
    defaultIssueEstimate: 0, visibility: 'public', private: false, allMembersCanJoin: true,
    mergeWorkflowState: null, draftWorkflowState: null, startWorkflowState: null, mergeableWorkflowState: null,
    reviewWorkflowState: null, markedAsDuplicateWorkflowState: null, setIssueSortOrderOnStateChange: 'last',
    requirePriorityToLeaveTriage: false, autoCloseChildIssues: false, autoCloseParentIssues: false,
    inheritIssueEstimation: false, inheritWorkflowStatuses: false, aiDiscussionSummariesEnabled: false,
    aiThreadSummariesEnabled: false, groupIssueHistory: false, slackIssueComments: false, slackNewIssue: false,
    slackIssueStatuses: false, inviteHash: sha256(ctx, `linear-team-invite:${id}`), issueOrderingNoPriorityFirst: false,
    issueSortOrderDefaultToBottom: true, issueCount: 0, _totalIssueCount: 0, _org: org,
  };
}

/** Native empty feature state and recorded creation facts for an issue; configured relations are supplied by its write. */
export function issueFields(ctx: HandlerContext, input: Row, identifier: string, number: number, state: Row): Row {
  const stateType = ctx.own(state).type;
  return {
    trashed: false, reactionData: {}, labelIds: arr<string>(input.labelIds), integrationSourceType: null,
    previousIdentifiers: [], reactions: [], customerTicketCount: 0,
    sharedAccess: { disallowedIssueFields: [], isShared: false, sharedWithCount: 0, sharedWithUsers: [], viewerHasOnlySharedAccess: false },
    // Where the documentation stops: this starter uses identifier/title branches, with no workspace naming customization.
    branchName: issueBranchName(identifier, input.title), delegate: null, botActor: null, sourceComment: null,
    cycle: null, syncedWith: null, externalUserCreator: null, asksExternalUserRequester: null, asksRequester: null,
    lastAppliedTemplate: null, boardOrder: number, sortOrder: number, prioritySortOrder: number, subIssueSortOrder: null,
    parent: null, projectMilestone: null, recurringIssueTemplate: null, startedTriageAt: null, triagedAt: null,
    addedToCycleAt: null, addedToProjectAt: input.projectId ? ctx.occurredAt : null, addedToTeamAt: ctx.occurredAt,
    autoArchivedAt: null, autoClosedAt: null, canceledAt: stateType === 'canceled' ? ctx.occurredAt : null,
    startedAt: stateType === 'started' ? ctx.occurredAt : null, slaStartedAt: null, slaBreachesAt: null,
    slaHighRiskAt: null, slaMediumRiskAt: null, snoozedUntilAt: null, slaType: null, snoozedBy: null, favorite: null,
    inheritsSharedAccess: false,
  };
}

export function issueBranchName(identifier: string, title: unknown): string {
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${identifier.toLowerCase()}${slug ? `-${slug}` : ''}`;
}

/** Root observations carry their declared parent and vendor-shaped relation ids, not a local _org index. */
export function observedParentBelongs(ctx: HandlerContext, r: Row, org: string): boolean {
  const team = relation(r, 'team');
  if (team) return ctx.row(TEAM, ctx.resolve(TEAM, String(team)))?._org === org;
  const issue = relation(r, 'issue');
  if (issue) { const parent = ctx.row(ISSUE, ctx.resolve(ISSUE, String(issue))); return !!parent && belongs(ctx, parent, org); }
  return false;
}

// The optional IssueUpdateInput fields are declared by the vendored schema. This customer only changes state and labels.
// source: https://linear.app/developers/graphql "Creating & Editing Issues"
export function optionalIssueChanges(ctx: HandlerContext, c: Caller, input: Row): Row {
  return { ...(input.priority !== undefined ? priorityChange(input.priority) : {}), ...(input.assigneeId !== undefined ? assignmentChange(ctx, c, input.assigneeId) : {}), ...(input.projectId !== undefined ? projectChange(ctx, c, input.projectId) : {}) };
}

function priorityChange(value: unknown): Row {
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new GraphqlError('priority must be between 0 and 4', 'invalid input');
  return { priority };
}
function assignmentChange(ctx: HandlerContext, c: Caller, value: unknown): Row {
  const id = value === null ? null : mine(ctx, c, USER, value, 'User').id;
  return { _assignee: id, assignee: id ? { id } : null };
}
function projectChange(ctx: HandlerContext, c: Caller, value: unknown): Row {
  const id = value === null ? null : mine(ctx, c, PROJECT, value, 'Project').id;
  return { _project: id, project: id ? { id } : null };
}
