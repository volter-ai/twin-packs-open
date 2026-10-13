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
export const BROWSER_SESSION = '_browser_session';

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

/** The same workspace/team visibility for GraphQL and the signed-in workspace screen. */
export function visibleRows(ctx: HandlerContext, type: string, c: Caller): Row[] {
  return ctx.rowsRaw(type).filter((r) => r.deleted !== true && belongs(ctx, r, c.org) && (!c.teamIds || (type === TEAM ? c.teamIds.includes(String(r.id)) : !relation(r, 'team') || c.teamIds.includes(String(relation(r, 'team'))))));
}

/** The issue an id names: its UUID or its native identifier (for example BOOK-1). */
export function issueBy(ctx: HandlerContext, c: Caller, id: unknown): Row {
  const key = ctx.resolve(ISSUE, String(id ?? ''));
  const hit = visibleRows(ctx, ISSUE, c).find((i) => i.id === key || i.identifier === key);
  // Where the documentation stops: the message is the twin's existing GraphQL refusal.
  if (!hit) throw new GraphqlError('Entity not found: Issue', 'invalid input');
  return hit;
}

/** Browser identity uses the existing consent session; it never substitutes cookie auth for API Authorization. */
export function browserPerson(ctx: HandlerContext): Row | undefined {
  const token = /(?:^|;\s*)linear_session=([^;]+)/.exec(ctx.call.request.headers.get('cookie') ?? '')?.[1];
  const session = token ? ctx.rowsRaw(BROWSER_SESSION).find((s) => s.deleted !== true && s.sha256 === sha256(ctx, token) && Date.parse(String(s.expires)) > Date.parse(ctx.occurredAt)) : undefined;
  const person = session ? ctx.row(USER, String(session.user)) : undefined;
  return person && person.deleted !== true && person.app !== true && person.active !== false ? person : undefined;
}

/** Sign in with the synthetic password recorded by the workspace/people settings doors. */
export async function browserSignIn(ctx: HandlerContext, email: string, password: string): Promise<{ person: Row; cookie: string } | undefined> {
  const person = ctx.rowsRaw(USER).find((u) => u.deleted !== true && u.app !== true && u.active !== false && u.email === email);
  if (!person || person._password !== sha256(ctx, `${String(person.id)}:${password}`)) return undefined;
  const id = await ctx.issue(BROWSER_SESSION);
  const token = await hexToken(ctx, `linear-browser:${id}`);
  await ctx.record(BROWSER_SESSION, { user: person.id, sha256: sha256(ctx, token), expires: new Date(Date.parse(ctx.occurredAt) + 90 * 86400000).toISOString() }, id);
  return { person, cookie: `linear_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax` };
}

/** A form token bound to the existing HttpOnly session, for ordinary workspace mutation forms. */
export function browserFormKey(ctx: HandlerContext): string {
  const token = /(?:^|;\s*)linear_session=([^;]+)/.exec(ctx.call.request.headers.get('cookie') ?? '')?.[1] ?? '';
  return sha256(ctx, `linear-issue-form:${token}`);
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

// The default SDK WorkflowState fragment reads the pinned SDL's native fields. Description, archive
// time and inherited-parent relation are nullable; a synthetic new team's states have none of them.
export const WORKFLOW_STATE_FIELDS = ['id', 'name', 'type', 'color', 'position', 'createdAt', 'updatedAt', 'description', 'archivedAt', 'inheritedFrom'];
export const WORKFLOW_STATE_SELECTION = `${WORKFLOW_STATE_FIELDS.map((field) => field === 'inheritedFrom' ? 'inheritedFrom { id }' : field).join(' ')} team { id }`;

// The unchanged SDK86 Organization fragment, from the pinned SDL. Nested types are stored inside this
// organization model when observed, not minted as substitute resources. Their mutation families remain gaps.
export const PROJECT_STATUS_FIELDS = ['id', 'description', 'type', 'color', 'updatedAt', 'name', 'position', 'archivedAt', 'createdAt', 'indefinite'];
export const PAID_SUBSCRIPTION_FIELDS = ['id', 'collectionMethod', 'cancelAt', 'canceledAt', 'nextBillingAt', 'updatedAt', 'seatsMaximum', 'seatsMinimum', 'seats', 'type', 'pendingChangeType', 'archivedAt', 'createdAt', 'creator'];
export const ORGANIZATION_FIELDS = [
  'id', 'name', 'urlKey', 'createdAt', 'updatedAt', 'archivedAt', 'userCount', 'createdIssueCount',
  'allowedAuthServices', 'allowedFileUploadContentTypes', 'authSettings', 'customersConfiguration',
  'defaultFeedSummarySchedule', 'previousUrlKeys', 'periodUploadVolume', 'securitySettings',
  'slackProjectChannelIntegration', 'logoUrl', 'initiativeUpdateRemindersDay', 'projectUpdateRemindersDay',
  'releaseChannel', 'initiativeUpdateReminderFrequencyInWeeks', 'projectUpdateReminderFrequencyInWeeks',
  'initiativeUpdateRemindersHour', 'projectUpdateRemindersHour', 'customerCount', 'slackProjectChannelPrefix',
  'gitBranchFormat', 'deletionRequestedAt', 'trialStartsAt', 'trialEndsAt', 'projectStatuses', 'subscription',
  'fiscalYearStartMonth', 'hipaaComplianceEnabled', 'samlEnabled', 'scimEnabled', 'gitLinkbackDescriptionsEnabled',
  'releasesEnabled', 'customersEnabled', 'gitLinkbackMessagesEnabled', 'gitPublicLinkbackMessagesEnabled',
  'feedEnabled', 'roadmapEnabled', 'aiDiscussionSummariesEnabled', 'aiThreadSummariesEnabled',
  'hideNonPrimaryOrganizations', 'projectUpdatesReminderFrequency', 'allowMembersToInvite',
  'restrictTeamCreationToAdmins', 'restrictLabelManagementToAdmins', 'slaDayCount',
];
export const ORGANIZATION_SELECTION = ORGANIZATION_FIELDS.map((field) => {
  if (field === 'slackProjectChannelIntegration') return `${field} { id }`;
  if (field === 'projectStatuses') return `${field} { ${PROJECT_STATUS_FIELDS.join(' ')} }`;
  if (field === 'subscription') return `${field} { ${PAID_SUBSCRIPTION_FIELDS.map((name) => name === 'creator' ? 'creator { id }' : name).join(' ')} }`;
  return field;
}).join(' ');

// These values describe this synthetic workspace, not undocumented vendor defaults. There is no paid plan,
// configured project-status model, Slack project integration, customer feature, AI service or reminder schedule.
// Required Day/ReleaseChannel/SLADayCountType values are SDL enum members for inactive starter settings.
export const ORGANIZATION_STARTER_FIELDS: Row = {
  archivedAt: null, createdIssueCount: 0, allowedAuthServices: [], allowedFileUploadContentTypes: null,
  authSettings: {}, customersConfiguration: {}, defaultFeedSummarySchedule: null, previousUrlKeys: [],
  periodUploadVolume: 0, securitySettings: {}, slackProjectChannelIntegration: null, logoUrl: null,
  initiativeUpdateRemindersDay: 'Monday', projectUpdateRemindersDay: 'Monday', releaseChannel: 'public',
  initiativeUpdateReminderFrequencyInWeeks: null, projectUpdateReminderFrequencyInWeeks: null,
  initiativeUpdateRemindersHour: 0, projectUpdateRemindersHour: 0, customerCount: 0, slackProjectChannelPrefix: '',
  gitBranchFormat: null, deletionRequestedAt: null, trialStartsAt: null, trialEndsAt: null,
  projectStatuses: [], subscription: null, fiscalYearStartMonth: 0, hipaaComplianceEnabled: false,
  samlEnabled: false, scimEnabled: false, gitLinkbackDescriptionsEnabled: false, releasesEnabled: false,
  customersEnabled: false, gitLinkbackMessagesEnabled: false, gitPublicLinkbackMessagesEnabled: false,
  feedEnabled: false, roadmapEnabled: false, aiDiscussionSummariesEnabled: false,
  aiThreadSummariesEnabled: false, hideNonPrimaryOrganizations: false, projectUpdatesReminderFrequency: 'never',
  allowMembersToInvite: null, restrictTeamCreationToAdmins: null, restrictLabelManagementToAdmins: null,
  slaDayCount: 'all',
};

/** The native organization recorded by the existing workspace settings door. */
export function organizationFields(ctx: HandlerContext, id: string, input: { name: string; urlKey: string }): Row {
  return { ...ORGANIZATION_STARTER_FIELDS, id, name: input.name, urlKey: input.urlKey,
    createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, userCount: 1 };
}

/** Retained synthetic starters keep their recorded settings; only fields previously absent are initialized. */
export async function completeStarterOrganization(ctx: HandlerContext, organization: Row): Promise<Row> {
  const existing = ctx.own(organization);
  const missing = Object.fromEntries(Object.entries(ORGANIZATION_STARTER_FIELDS).filter(([field]) => existing[field] === undefined));
  if (!Object.keys(missing).length) return organization;
  await ctx.change(ORG, String(organization.id), () => missing, 'organization.settings');
  return ctx.row(ORG, String(organization.id))!;
}

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

/** The existing issueUpdate action, shared by the GraphQL mutation and the browser's property form. */
export async function updateIssue(ctx: HandlerContext, c: Caller, id: unknown, input: Row): Promise<Row> {
  const fieldsAllowed = ['stateId','labelIds','title','description','priority','assigneeId','projectId','estimate','dueDate'];
  const unsupported = Object.keys(input).find((key) => !fieldsAllowed.includes(key));
  if (unsupported) throw new GraphqlError(`The twin does not model input ${unsupported}`, 'invalid input');
  if (!c.scope.includes('write') && !c.scope.includes('admin')) throw new GraphqlError('Invalid scope: `write` required', 'forbidden');
  const issue = issueBy(ctx, c, id);
  const fields: Row = { updatedAt: ctx.occurredAt };
  if (input.stateId !== undefined) {
    const state = mine(ctx, c, STATE, input.stateId, 'WorkflowState');
    if (ctx.resolve(TEAM, String(relation(state, 'team'))) !== ctx.resolve(TEAM, String(relation(issue, 'team')))) throw new GraphqlError('The state does not belong to the issue\'s team', 'invalid input');
    fields._state = state.id; fields.state = { id: state.id }; fields.completedAt = ctx.own(state).type === 'completed' ? ctx.occurredAt : null;
    fields.canceledAt = ctx.own(state).type === 'canceled' ? ctx.occurredAt : null;
    if (ctx.own(state).type === 'started' && !ctx.own(issue).startedAt) fields.startedAt = ctx.occurredAt;
  }
  if (input.labelIds !== undefined) { for (const label of arr<string>(input.labelIds)) mine(ctx, c, LABEL, label, 'IssueLabel'); fields._labels = arr<string>(input.labelIds); fields.labelIds = arr<string>(input.labelIds); fields.labels = { nodes: arr<string>(input.labelIds).map((label) => ({ id: label })) }; }
  if (input.estimate !== undefined) fields.estimate = input.estimate;
  if (input.dueDate !== undefined) fields.dueDate = input.dueDate;
  if (input.title !== undefined) { fields.title = input.title; fields.branchName = issueBranchName(String(issue.identifier), input.title); }
  if (input.description !== undefined) fields.description = input.description;
  Object.assign(fields, optionalIssueChanges(ctx, c, input));
  if (input.projectId !== undefined) fields.addedToProjectAt = input.projectId ? ctx.occurredAt : null;
  await ctx.change(ISSUE, String(issue.id), () => fields, 'issueUpdate');
  return ctx.row(ISSUE, String(issue.id))!;
}
