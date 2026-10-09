// Linear's GraphQL API (https://linear.app/developers/graphql) over the workspace's state: the queries and mutations
// the customer sends (../../journeys/demand.json), and teamCreate and projectCreate, which the World seeds with. Objects
// are stored as the schema names their fields; a resolver answers what joins them (an issue's team, state, labels,
// comments and people) and each filter the demand uses. A filter the twin does not read is refused by name.
import { GraphqlError, type GraphqlPart, type HandlerContext } from '@volter/world-core';
import {
  arr, callerOf, COMMENT, DEFAULT_STATES, ISSUE, ISSUE_FIELDS, issueBy, issueFields, LABEL, mine, obj, ORG, ORGANIZATION_FIELDS, PAID_SUBSCRIPTION_FIELDS, PRIORITY_LABELS, PROJECT, PROJECT_STATUS_FIELDS, relation, type Row, STATE, TEAM, TEAM_FIELDS, teamFields, updateIssue, USER, USER_FIELDS, visibleRows as live, WORKFLOW_STATE_FIELDS, writer, type Caller,
} from './shared.ts';

type C = HandlerContext;

// ── filters ─────────────────────────────────────────────────────────────────────────────────────────
// source: https://linear.app/developers/filtering "eq"

/** A comparator on a value (`eq`, `neq`, `in`, `nin`), as Linear's filters write them. */
function compare(v: unknown, cmp: Row, path: string): boolean {
  for (const [op, want] of Object.entries(cmp)) {
    if (op === 'eq' && v !== want) return false;
    if (op === 'neq' && v === want) return false;
    if (op === 'in' && !arr(want).includes(v as never)) return false;
    if (op === 'nin' && arr(want).includes(v as never)) return false;
    if (op === 'null' && (v === null || v === undefined) !== want) return false;
    if (['lt', 'lte', 'gt', 'gte'].includes(op) && (v === null || v === undefined)) return false;
    if (op === 'lt' && !((v as number) < (want as number))) return false;
    if (op === 'lte' && !((v as number) <= (want as number))) return false;
    if (op === 'gt' && !((v as number) > (want as number))) return false;
    if (op === 'gte' && !((v as number) >= (want as number))) return false;
    if (op === 'contains' && !String(v ?? '').includes(String(want))) return false;
    if (op === 'startsWith' && !String(v ?? '').startsWith(String(want))) return false;
    if (!['eq', 'neq', 'in', 'nin', 'null', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith'].includes(op)) throw new GraphqlError(`the twin does not read the filter ${path}.${op}`, 'invalid input');
  }
  return true;
}
/** Each key of a filter, read on the object by `read` (a nested filter's keys by their own reader). */
function matches(filter: Row, readers: Record<string, (cmp: Row, path: string) => boolean>, path: string): boolean {
  return Object.entries(filter).every(([k, cmp]) => {
    if (k === 'or') return arr<Row>(cmp).some((f) => matches(f, readers, path));
    if (k === 'and') return arr<Row>(cmp).every((f) => matches(f, readers, path));
    const read = readers[k];
    if (!read) throw new GraphqlError(`the twin does not read the filter ${path}.${k}`, 'invalid input');
    return read(obj(cmp), `${path}.${k}`);
  });
}

// ── views ───────────────────────────────────────────────────────────────────────────────────────────

// source: https://linear.app/developers/filtering "Filtering by relationship"
const related = (ctx: C, type: string, id: unknown): Row | undefined => id ? ctx.get(type, ctx.resolve(type, String(id))) : undefined;
const relatedRow = (ctx: C, type: string, id: unknown): Row | undefined => id ? ctx.row(type, ctx.resolve(type, String(id))) : undefined;
const referenceCompare = (ctx: C, type: string, id: unknown, cmp: Row, path: string): boolean => compare(id ? ctx.resolve(type, String(id)) : null, Object.fromEntries(Object.entries(cmp).map(([k, v]) => [k, Array.isArray(v) ? v.map((id) => ctx.resolve(type, String(id))) : typeof v === 'string' ? ctx.resolve(type, v) : v])), path);
const labelIds = (i: Row): string[] => arr<string>(i._labels ?? arr(obj(i.labels).nodes).map((l) => l.id));
const dateCompare = (ctx: C, value: unknown, cmp: Row, path: string): boolean => {
  const date = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const relative = /^(-?)P(\d+)(W|D)$/.exec(v);
    return relative ? Date.parse(ctx.occurredAt) + (relative[1] ? -1 : 1) * Number(relative[2]) * (relative[3] === 'W' ? 7 : 1) * 86400000 : Date.parse(v);
  };
  return compare(value == null ? null : date(value), Object.fromEntries(Object.entries(cmp).map(([k, v]) => [k, k === 'null' ? v : date(v)])), path);
};
const userFilter = (u: Row | undefined, cmp: Row, p: string): boolean => !!u && matches(cmp, { name: (x, q) => compare(u.name, x, q), email: (x, q) => compare(u.email, x, q) }, p);
const projectFilter = (ctx: C, project: Row | undefined, cmp: Row, p: string): boolean => !!project && matches(cmp, {
  id: (x, q) => referenceCompare(ctx, PROJECT, project.id, x, q), state: (x, q) => compare(project.state, x, q),
  lead: (x, q) => userFilter(related(ctx, USER, relation(project, 'lead')), x, q),
}, p);
const issueFilter = (ctx: C, i: Row) => (f: Row): boolean => matches(f, {
  title: (x, p) => compare(i.title, x, p), priority: (x, p) => compare(i.priority, x, p), description: (x, p) => compare(i.description, x, p), estimate: (x, p) => compare(i.estimate, x, p),
  dueDate: (x, p) => dateCompare(ctx, i.dueDate, x, p), completedAt: (x, p) => dateCompare(ctx, i.completedAt, x, p),
  team: (cmp, p) => matches(cmp, { id: (x, q) => referenceCompare(ctx, TEAM, relation(i, 'team'), x, q) }, p),
  project: (cmp, p) => projectFilter(ctx, relatedRow(ctx, PROJECT, relation(i, 'project')), cmp, p),
  assignee: (cmp, p) => userFilter(related(ctx, USER, relation(i, 'assignee')), cmp, p),
  labels: (cmp, p) => {
    const labels = labelIds(i).map((id) => related(ctx, LABEL, id)).filter((l): l is Row => !!l);
    const label = (l: Row, f: Row): boolean => matches(f, { name: (x, q) => compare(l.name, x, q) }, p);
    return cmp.every ? labels.every((l) => label(l, obj(cmp.every))) : labels.some((l) => label(l, cmp));
  },
  comments: (cmp, p) => ctx.rowsRaw(COMMENT).filter((c) => ctx.resolve(ISSUE, String(relation(c, 'issue'))) === ctx.resolve(ISSUE, String(i.id))).some((c) => matches(cmp, { body: (x, q) => compare(c.body, x, q) }, p)),
  state: (cmp, p) => matches(cmp, { type: (x, q) => compare(related(ctx, STATE, relation(i, 'state'))?.type, x, q), id: (x, q) => referenceCompare(ctx, STATE, relation(i, 'state'), x, q) }, p),
}, 'filter');
const issues = (ctx: C, a: Row, predicate: (i: Row) => boolean): Row[] => ordered(live(ctx, ISSUE, callerOf(ctx)).filter(predicate).filter((i) => a.includeArchived === true || !i.archivedAt).filter((i) => issueFilter(ctx, i)(obj(a.filter))), a.orderBy).map((r) => ctx.own(r));
// Where the documentation stops: valid schema choices this scope cannot execute are refused before writes.
const supported = (input: Row, fields: string[]): void => { const key = Object.keys(input).find((k) => !fields.includes(k)); if (key) throw new GraphqlError(`The twin does not model input ${key}`, 'invalid input'); };

const ordered = (rows: Row[], orderBy: unknown): Row[] => {
  const key = orderBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
  // source: https://linear.app/developers/pagination "orderBy"
  return [...rows].sort((a, z) => String(z[key]).localeCompare(String(a[key])) || String(z.id).localeCompare(String(a.id)));
};

const payload = (ctx: C, entity: string, value: Row | null): Row => ({ success: true, lastSyncId: 0, [entity]: value ? ctx.own(value) : null });

// ── teams ───────────────────────────────────────────────────────────────────────────────────────────

async function teamCreate(ctx: C, input: Row): Promise<Row> {
  const c = writer(ctx);
  supported(input, ['name', 'key', 'description']);
  const name = String(input.name ?? '');
  // Where the documentation stops: a key is the name's initials when not given; the refusals are the twin's
  const key = String(input.key ?? name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase();
  if (!name) throw new GraphqlError('name must not be empty', 'invalid input');
  if (live(ctx, TEAM, c).some((t) => t.key === key)) throw new GraphqlError(`Team key ${key} is already taken`, 'invalid input');
  const team = await ctx.create(TEAM, (id) => teamFields(ctx, id, c.org, { ...input, name, key }), 'teamCreate');
  const id = String(team.id);
  let defaultState: string | undefined;
  // the team's workflow states, as a new team has them
  for (const [position, s] of DEFAULT_STATES.entries()) {
    const state = await ctx.create(STATE, (sid) => ({ id: sid, name: s.name, type: s.type, color: s.color, position, description: null, archivedAt: null, inheritedFrom: null, createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, _team: id, _org: c.org }), 'workflowStateCreate');
    if (!defaultState && s.type === 'backlog') defaultState = String(state.id);
  }
  if (defaultState) await ctx.change(TEAM, id, () => ({ defaultIssueState: { id: defaultState } }), 'teamCreate');
  return ctx.row(TEAM, id)!;
}

async function issueCreate(ctx: C, input: Row): Promise<Row> {
  supported(input, ['teamId','stateId','projectId','assigneeId','labelIds','priority','title','description','createAsUser','displayIconUrl','estimate','dueDate']);
  const c = writer(ctx);
  const team = mine(ctx, c, TEAM, input.teamId, 'Team');
  const states = live(ctx, STATE, c).filter((s) => ctx.resolve(TEAM, String(relation(s, 'team'))) === team.id);
  const state = input.stateId !== undefined ? mine(ctx, c, STATE, input.stateId, 'WorkflowState')
    // Where the documentation stops: an issue made without a state lands in the team's first backlog state
    : states.find((s) => ctx.own(s).type === 'backlog') ?? states[0]!;
  if (ctx.resolve(TEAM, String(relation(state, 'team'))) !== team.id) throw new GraphqlError('The state does not belong to the team', 'invalid input');
  if (input.projectId !== undefined) mine(ctx, c, PROJECT, input.projectId, 'Project');
  if (input.assigneeId !== undefined) mine(ctx, c, USER, input.assigneeId, 'User');
  for (const l of arr<string>(input.labelIds)) mine(ctx, c, LABEL, l, 'IssueLabel');
  const priority = input.priority === undefined ? 0 : Number(input.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) throw new GraphqlError('priority must be between 0 and 4', 'invalid input');
  const org = ctx.row(ORG, c.org)!;
  const issue = await ctx.create(ISSUE, (id) => {
  // the team's next number, from its issues' history (archived ones keep theirs)
  const number = Math.max(0, ...ctx.rowsRaw(ISSUE).filter((i) => ctx.resolve(TEAM, String(relation(i, 'team'))) === team.id).map((i) => Number(i.number))) + 1;
  const identifier = `${String(team.key)}-${number}`;
  return {
    ...issueFields(ctx, input, identifier, number, state),
    id, number, identifier, title: input.title ?? '', description: input.description ?? null, priority, url: `https://linear.app/${String(org.urlKey)}/issue/${identifier}`,
    createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, archivedAt: null, dueDate: input.dueDate ?? null, estimate: input.estimate ?? null, completedAt: ctx.own(state).type === 'completed' ? ctx.occurredAt : null,
    team: { id: team.id }, state: { id: state.id }, creator: { id: c.user }, project: input.projectId ? { id: input.projectId } : null, assignee: input.assigneeId ? { id: input.assigneeId } : null, labels: { nodes: arr<string>(input.labelIds).map((id) => ({ id })) }, _team: team.id, _state: state.id, _project: input.projectId ?? null, _assignee: input.assigneeId ?? null, _creator: c.user, _labels: arr<string>(input.labelIds), _org: c.org,
    // an app's issue shown as the person it names (createAsUser) and its icon, as Linear attributes it
    ...(input.createAsUser ? { _createAsUser: input.createAsUser, _displayIconUrl: input.displayIconUrl ?? null } : {}),
  }; }, 'issueCreate');
  return ctx.row(ISSUE, String(issue.id))!;
}

async function issueUpdate(ctx: C, id: unknown, input: Row): Promise<Row> {
  supported(input, ['stateId','labelIds','title','description','priority','assigneeId','projectId','estimate','dueDate']);
  return updateIssue(ctx, writer(ctx), id, input);
}

async function issueArchive(ctx: C, id: unknown): Promise<Row> {
  const c = writer(ctx);
  const issue = issueBy(ctx, c, id);
  await ctx.change(ISSUE, String(issue.id), (held) => {
    const refused = ctx.legal(ISSUE, 'archivedAt', 'mutation.issueArchive', held.archivedAt, 'archived', String(issue.id));
    if (refused) throw new GraphqlError(refused.message, 'invalid input');
    return { archivedAt: ctx.occurredAt, updatedAt: ctx.occurredAt };
  }, 'mutation.issueArchive');
  return ctx.row(ISSUE, String(issue.id))!;
}

const resolvers: GraphqlPart<C>['resolvers'] = {
  // source: https://linear.app/developers/graphql "query Me"
  'Query.viewer': (_s, _a, ctx) => related(ctx, USER, callerOf(ctx).user),
  'Query.users': (_s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return live(ctx, USER, callerOf(ctx)).map((r) => ctx.own(r)); },
  'Query.projects': (_s, a, ctx) => live(ctx, PROJECT, callerOf(ctx)).filter((p) => projectFilter(ctx, p, obj(a.filter), 'filter')).map((r) => ctx.own(r)),
  'Query.comments': (_s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return live(ctx, COMMENT, callerOf(ctx)).map((r) => ctx.own(r)); },
  'Query.organization': (_s, _a, ctx) => related(ctx, ORG, callerOf(ctx).org),
  'Query.teams': (_s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return live(ctx, TEAM, callerOf(ctx)).map((r) => ctx.own(r)); },
  'Query.team': (_s, a, ctx) => ctx.own(mine(ctx, callerOf(ctx), TEAM, a.id, 'Team')),
  // The pinned SDL declares workflowState(id: String!); an ordinary SDK issue.state read uses it.
  // source: https://linear.app/developers/graphql
  'Query.workflowState': (_s, a, ctx) => { supported(a, ['id']); return ctx.own(mine(ctx, callerOf(ctx), STATE, a.id, 'WorkflowState')); },
  'Query.workflowStates': (_s, a, ctx) => {
    const c = callerOf(ctx);
    return live(ctx, STATE, c).filter((s) => matches(obj(a.filter), {
      team: (cmp, p) => matches(cmp, { id: (x, q) => referenceCompare(ctx, TEAM, relation(s, 'team'), x, q) }, p), type: (x, p) => compare(ctx.own(s).type, x, p), name: (x, p) => compare(s.name, x, p),
    }, 'filter')).sort((x, z) => Number(x.position) - Number(z.position)).map((r) => ctx.own(r));
  },
  'Query.issue': (_s, a, ctx) => ctx.own(issueBy(ctx, callerOf(ctx), a.id)),
  'Query.issues': (_s, a, ctx) => issues(ctx, a, () => true),
  'Query.issueLabels': (_s, a, ctx) => live(ctx, LABEL, callerOf(ctx)).filter((l) => matches(obj(a.filter), {
    team: (cmp, p) => matches(cmp, { id: (x, q) => referenceCompare(ctx, TEAM, relation(l, 'team'), x, q) }, p), name: (x, p) => compare(l.name, x, p),
  }, 'filter')).map((r) => ctx.own(r)),
  'Mutation.teamCreate': async (_s, a, ctx) => payload(ctx, 'team', await teamCreate(ctx, obj(a.input))),
  'Mutation.projectCreate': async (_s, a, ctx) => {
    const c = writer(ctx);
    const input = obj(a.input);
    supported(input, ['name','description','teamIds','leadId']);
    if (input.leadId) mine(ctx, c, USER, input.leadId, 'User');
    const teams = arr<string>(input.teamIds).map((t) => mine(ctx, c, TEAM, t, 'Team'));
    if (!teams.length) throw new GraphqlError('teamIds must name a team', 'invalid input');
    const project = await ctx.create(PROJECT, (id) => ({ id, name: String(input.name ?? ''), description: input.description ?? '', createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, lead: input.leadId ? { id: input.leadId } : null, _lead: input.leadId ?? null, state: 'planned', teams: { nodes: teams.map((t) => ({ id: t.id })) }, _teams: teams.map((t) => t.id), _org: c.org }), 'projectCreate');
    return payload(ctx, 'project', ctx.row(PROJECT, String(project.id))!);
  },
  'Mutation.issueCreate': async (_s, a, ctx) => payload(ctx, 'issue', await issueCreate(ctx, obj(a.input))),
  'Mutation.issueUpdate': async (_s, a, ctx) => payload(ctx, 'issue', await issueUpdate(ctx, a.id, obj(a.input))),
  'Mutation.issueArchive': async (_s, a, ctx) => payload(ctx, 'entity', await issueArchive(ctx, a.id)),
  'Mutation.commentCreate': async (_s, a, ctx) => {
    const c = writer(ctx);
    const input = obj(a.input);
    supported(input, ['issueId','body']);
    const issue = issueBy(ctx, c, input.issueId);
    const comment = await ctx.create(COMMENT, (id) => ({ id, body: String(input.body ?? ''), createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, issue: { id: issue.id }, user: { id: c.user }, _issue: issue.id, _user: c.user, _org: c.org }), 'commentCreate');
    return payload(ctx, 'comment', ctx.row(COMMENT, String(comment.id))!);
  },
  'Mutation.issueLabelCreate': async (_s, a, ctx) => {
    const c = writer(ctx);
    const input = obj(a.input);
    supported(input, ['name','color','description','teamId']);
    if (input.teamId !== undefined) mine(ctx, c, TEAM, input.teamId, 'Team');
    // Where the documentation stops: a label's name is unique in its team; the refusal is the twin's
    if (live(ctx, LABEL, c).some((l) => l.name === input.name && ctx.resolve(TEAM, String(relation(l, 'team') ?? '')) === ctx.resolve(TEAM, String(input.teamId ?? '')))) throw new GraphqlError('duplicate label name', 'invalid input');
    const label = await ctx.create(LABEL, (id) => ({ id, name: String(input.name), color: input.color ?? '#bec2c8', description: input.description ?? null, createdAt: ctx.occurredAt, team: input.teamId ? { id: input.teamId } : null, _team: input.teamId ?? null, _org: c.org }), 'issueLabelCreate');
    return payload(ctx, 'issueLabel', ctx.row(LABEL, String(label.id))!);
  },
  // source: https://linear.app/developers/graphql "query Team"
  'Team.issues': (s, a, ctx) => issues(ctx, a, (i) => ctx.resolve(TEAM, String(relation(i, 'team'))) === ctx.resolve(TEAM, String(s.id))),
  'Issue.team': (s, _a, ctx) => related(ctx, TEAM, String(relation(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id))), 'team'))),
  'Issue.state': (s, _a, ctx) => related(ctx, STATE, String(relation(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id))), 'state'))),
  'Issue.labels': (s, _a, ctx) => arr<string>(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id)))?._labels ?? arr(obj(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id)))?.labels).nodes).map((l) => l.id)).map((l) => related(ctx, LABEL, l)).filter(Boolean),
  'Issue.comments': (s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return ctx.rowsRaw(COMMENT).filter((m) => m.deleted !== true && ctx.resolve(ISSUE, String(relation(m, 'issue'))) === ctx.resolve(ISSUE, String(s.id))).sort((a, z) => String(a.createdAt).localeCompare(String(z.createdAt))).map((r) => ctx.own(r)); },
  'Issue.project': (s, _a, ctx) => { const id = relation(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id))), 'project'); return id ? related(ctx, PROJECT, String(id)) : null; },
  'Issue.assignee': (s, _a, ctx) => { const id = relation(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id))), 'assignee'); return id ? related(ctx, USER, String(id)) : null; },
  'Issue.creator': (s, _a, ctx) => related(ctx, USER, String(relation(ctx.row(ISSUE, ctx.resolve(ISSUE, String(s.id))), 'creator'))),
  // source: https://linear.app/developers/graphql "query Me"
  'User.organization': (s, _a, ctx) => related(ctx, ORG, String(ctx.row(USER, ctx.resolve(USER, String(s.id)))?._org)),
  'User.isMe': (s, _a, ctx) => ctx.resolve(USER, String(s.id)) === ctx.resolve(USER, callerOf(ctx).user),
  'Organization.userCount': (s, _a, ctx) => ctx.rowsRaw(USER).filter((u) => u.deleted !== true && u._org === s.id && u.app !== true).length,
  'Team.organization': (s, _a, ctx) => related(ctx, ORG, String(ctx.row(TEAM, ctx.resolve(TEAM, String(s.id)))?._org)),
  'Team.issueCount': (s, a, ctx) => {
    const team = ctx.row(TEAM, ctx.resolve(TEAM, String(s.id)))!;
    return a.includeArchived === true ? team._totalIssueCount : ctx.own(team).issueCount;
  },
  'WorkflowState.team': (s, _a, ctx) => related(ctx, TEAM, String(relation(ctx.row(STATE, ctx.resolve(STATE, String(s.id))), 'team'))),
  'IssueLabel.team': (s, _a, ctx) => { const id = relation(ctx.row(LABEL, ctx.resolve(LABEL, String(s.id))), 'team'); return id ? related(ctx, TEAM, String(id)) : null; },
  'IssueLabel.organization': (s, _a, ctx) => related(ctx, ORG, String(ctx.row(LABEL, ctx.resolve(LABEL, String(s.id)))?._org)),
  'Project.teams': (s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return arr<string>(ctx.row(PROJECT, ctx.resolve(PROJECT, String(s.id)))?._teams ?? arr(obj(ctx.row(PROJECT, ctx.resolve(PROJECT, String(s.id)))?.teams).nodes).map((t) => t.id)).map((id) => related(ctx, TEAM, id)).filter(Boolean); },
  'Comment.issue': (s, _a, ctx) => related(ctx, ISSUE, String(relation(ctx.row(COMMENT, ctx.resolve(COMMENT, String(s.id))), 'issue'))),
  // source: https://linear.app/developers/filtering "their priority is 0"
  'Issue.priorityLabel': (s) => PRIORITY_LABELS[Number(s.priority)] ?? 'No priority',
  'Team.states': (s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy']); return ctx.rowsRaw(STATE).filter((x) => x.deleted !== true && ctx.resolve(TEAM, String(relation(x, 'team'))) === ctx.resolve(TEAM, String(s.id))).sort((a, z) => Number(a.position) - Number(z.position)).map((r) => ctx.own(r)); },
  'Team.projects': (s, a, ctx) => { supported(a, ['first','last','after','before','includeArchived','orderBy','includeSubTeams']); return ctx.rowsRaw(PROJECT).filter((p) => p.deleted !== true && arr<string>(p._teams ?? arr(obj(p.teams).nodes).map((t) => t.id)).some((id) => ctx.resolve(TEAM, id) === ctx.resolve(TEAM, String(s.id)))).map((r) => ctx.own(r)); },
  'Project.issues': (s, a, ctx) => issues(ctx, a, (i) => ctx.resolve(PROJECT, String(relation(i, 'project'))) === ctx.resolve(PROJECT, String(s.id))),
  'Project.lead': (s, _a, ctx) => related(ctx, USER, relation(relatedRow(ctx, PROJECT, s.id), 'lead')),
  'User.assignedIssues': (s, a, ctx) => issues(ctx, a, (i) => ctx.resolve(USER, String(relation(i, 'assignee'))) === ctx.resolve(USER, String(s.id))),
  'User.createdIssues': (s, a, ctx) => issues(ctx, a, (i) => ctx.resolve(USER, String(relation(i, 'creator'))) === ctx.resolve(USER, String(s.id))),
  'Comment.user': (s, _a, ctx) => related(ctx, USER, String(relation(ctx.row(COMMENT, ctx.resolve(COMMENT, String(s.id))), 'user'))),
};

const stored: GraphqlPart<C>['stored'] = {
  User: USER_FIELDS,
  Organization: ORGANIZATION_FIELDS,
  ProjectStatus: PROJECT_STATUS_FIELDS,
  PaidSubscription: PAID_SUBSCRIPTION_FIELDS,
  Integration: ['id'],
  Team: TEAM_FIELDS,
  WorkflowState: WORKFLOW_STATE_FIELDS,
  Project: ['id', 'name', 'description', 'createdAt', 'updatedAt', 'state'],
  Issue: ISSUE_FIELDS,
  IssueSharedAccess: ['disallowedIssueFields', 'isShared', 'sharedWithCount', 'sharedWithUsers', 'viewerHasOnlySharedAccess'],
  Reaction: ['id', 'emoji', 'createdAt', 'updatedAt', 'archivedAt', 'comment', 'externalUser', 'initiativeUpdate', 'issue', 'projectUpdate', 'user'],
  ActorBot: ['id', 'name', 'avatarUrl', 'subType', 'type', 'userDisplayName'],
  ExternalEntityInfo: ['id', 'service', 'metadata'],
  ExternalEntityInfoGithubMetadata: ['number', 'owner', 'repo'],
  ExternalEntityInfoJiraMetadata: ['issueTypeId', 'projectId', 'issueKey'],
  ExternalEntitySlackMetadata: ['messageUrl', 'channelId', 'channelName', 'isFromSlack'],
  IntegrationsSettings: ['id'], Cycle: ['id'], TriageResponsibility: ['id'], Template: ['id'],
  ExternalUser: ['id'], InitiativeUpdate: ['id'], ProjectUpdate: ['id'], ProjectMilestone: ['id'], Favorite: ['id'],
  Comment: ['id', 'body', 'createdAt', 'updatedAt'],
  IssueLabel: ['id', 'name', 'color', 'description', 'createdAt'],
  IssuePayload: ['success', 'issue', 'lastSyncId'],
  IssueArchivePayload: ['success', 'entity', 'lastSyncId'],
  CommentPayload: ['success', 'comment', 'lastSyncId'],
  IssueLabelPayload: ['success', 'issueLabel', 'lastSyncId'],
  TeamPayload: ['success', 'team', 'lastSyncId'],
  ProjectPayload: ['success', 'project', 'lastSyncId'],
};

export const graphql: GraphqlPart<C> = { resolvers, stored };
