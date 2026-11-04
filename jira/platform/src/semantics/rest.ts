// Jira REST v3 operations share the spec path family /rest.
import type { HandlerContext } from '@volter/world-core';
import { arr, base, callerOf, COMMENT, commentView, COMPONENT, componentView, fieldsAsked, ISSUE, ISSUE_TYPES, inSite, issueOf, issueView, jiraError, obj, PERSON, PRIORITIES, PROJECT, projectOf, projectView, type Row, type Caller, newProjectView, newComponentView, STATUSES, statusView, TRANSITIONS, userView } from './shared.ts';
// Issues: made in a project (its key's next number, from the project's issues), read with the fields asked, their
// fields edited, commented on, and moved through the workflow's transitions (./states.ts rules each move).

const now = (ctx: HandlerContext): string => ctx.occurredAt.replace('Z', '+0000');

// source: spec:getCurrentUser "Returns details for the current user."
// source: spec:getCurrentUser "read:jira-user"
export async function getCurrentUser(ctx: HandlerContext): Promise<Response> {
  const caller = callerOf(ctx, 'read:jira-user');
  if (caller instanceof Response) return caller;
  // The pack's declared gap also covers optional group/application-role expansion.
  if (new URL(ctx.call.request.url).searchParams.get('expand')) return jiraError(404, ['Not found']);
  const user = userView(ctx, caller.site, caller.person);
  if (!user) return jiraError(401, ['Client must be authenticated to access this resource.']);
  // source: spec:/components/schemas/User "The groups that the user belongs to."
  // Where the documentation stops: groups and application roles are expansions (expand=groups,applicationRoles, the
  // gap above); unexpanded they are a list's size with no items. The twin's sites hold no group or application role
  // (their APIs are the gap), so both are empty; key and name are the deprecated properties the example answers empty.
  return Response.json({ ...user, emailAddress: ctx.row(PERSON, caller.person)!.email, key: '', name: '', groups: { size: 0, items: [] }, applicationRoles: { size: 0, items: [] } });
}

/** An ADF document's form (a `doc` of content), or the field error Jira answers for one that is not. */
// source: spec:createIssue "Atlassian Document Format"
// source: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/ "Defines the version of ADF used in this representation."
const adfError = (v: unknown): string | undefined =>
  v === undefined || v === null || (obj(v).type === 'doc' && obj(v).version === 1 && Array.isArray(obj(v).content)) ? undefined : 'Operation value must be an Atlassian Document (see the Atlassian Document Format)';

// source: spec:createIssue "Creates an issue or, where the option to create subtasks is enabled in Jira, a subtask."
export async function createIssue(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'write:jira-work');
  if (c instanceof Response) return c;
  const f = obj(obj(ctx.body).fields);
  const errors: Row = {};
  const project = projectOf(ctx, c, obj(f.project).id ?? obj(f.project).key);
  if (project instanceof Response) errors.project = 'Specify a valid project ID or key';
  const type = ISSUE_TYPES.find((t) => t.id === String(obj(f.issuetype).id) || t.name === obj(f.issuetype).name);
  if (!type) errors.issuetype = 'Specify an issue type';
  // source: spec:createIssue "must contain the ID or key of the parent issue."
  const parent = type?.subtask ? issueOf(ctx, c, obj(f.parent).id ?? obj(f.parent).key) : undefined;
  if (type?.subtask && (parent instanceof Response || !parent || project instanceof Response || obj(obj(parent.fields).project).id !== String(project.id) || obj(obj(parent.fields).issuetype).subtask === true)) errors.parent = 'Specify a parent issue in the same project.';
  // source: spec:createIssue "fields"
  if (typeof f.summary !== 'string' || !f.summary.trim()) errors.summary = 'You must specify a summary of the issue.';
  else if (f.summary.length > 255) errors.summary = 'Summary must be less than 255 characters.';
  const bad = adfError(f.description);
  if (bad) errors.description = bad;
  const priority = f.priority === undefined ? PRIORITIES[2] : PRIORITIES.find((p) => p.id === String(obj(f.priority).id) || p.name === obj(f.priority).name);
  if (!priority) errors.priority = 'Specify the Priority (id or name) in the string format';
  const components = arr<Row>(f.components).map((k) => ctx.rowsRaw(COMPONENT).find((x) => x.deleted !== true && !(project instanceof Response) && String(x._project ?? x.projectId) === String(project.id) && (x.id === String(k.id) || x.name === k.name)));
  if (components.some((k) => !k)) errors.components = 'Component name is not valid';
  const assignee = obj(f.assignee).accountId;
  if (assignee !== undefined && !arr<string>(ctx.row(PERSON, String(assignee))?.sites).includes(c.site)) errors.assignee = `User '${String(assignee)}' cannot be assigned issues.`;
  if (Object.keys(errors).length || project instanceof Response) return jiraError(400, [], errors);
  // p3: A project's issue key is a per-project sequence over retained history, not the resource id; the id is minted below.
  // the project's next number, from its issues' history (a deleted one keeps its number)
  const number = Math.max(0, ...ctx.rowsRaw(ISSUE, { withDeleted: true }).filter((i) => String(i._project ?? obj(obj(i.fields).project).id) === String(project.id)).map((i) => Number(i._number ?? String(i.key).split('-').at(-1)))) + 1;
  const id = ctx.mint(ISSUE);
  const key = `${String(project.key)}-${number}`;
  // stored as Jira answers an issue: its id, key and `fields` (the plain ones; status, project and people are views)
  await ctx.write(ISSUE, id, {
    id, key, self: `${base(c)}/issue/${id}`, fields: {
      summary: f.summary, description: f.description ?? null, labels: arr<string>(f.labels), created: now(ctx), updated: now(ctx),
      status: statusView(c, 'To Do'), issuetype: type, priority,
      project: { self: `${base(c)}/project/${project.id}`, id: String(project.id), key: project.key, name: project.name },
      components: components.map((k) => ({ id: k!.id, name: k!.name })),
      assignee: userView(ctx, c.site, assignee), reporter: userView(ctx, c.site, c.person), creator: userView(ctx, c.site, c.person),
      resolutiondate: null, ...(parent && !(parent instanceof Response) ? { parent: { id: parent.id, key: parent.key, self: parent.self } } : {}),
    },
    _number: number, _project: project.id, _site: c.site, _issuetype: type!.id, _priority: priority!.id, _components: components.map((k) => k!.id),
    _assignee: assignee ?? null, _reporter: c.person, _status: 'To Do',
  }, 'createIssue');
  const requested = obj(obj(ctx.body).transition).id;
  let transition: Row | undefined;
  if (requested !== undefined) {
    const target = TRANSITIONS.find((t) => t.id === String(requested));
    if (!target) transition = { status: 400, errorCollection: { errorMessages: ['Transition not found'], errors: {} } };
    else {
      if (target.to !== 'To Do') ctx.legal(ISSUE, '_status', 'createIssue', 'To Do', target.to, id);
      const held = ctx.row(ISSUE, id)!;
      await ctx.write(ISSUE, id, { _status: target.to, fields: { ...obj(held.fields), status: statusView(c, target.to), updated: now(ctx) } }, 'doTransition');
      transition = { status: 200, errorCollection: { errorMessages: [], errors: {} } };
    }
  }
  return Response.json({ id: String(id), key, self: `${base(c)}/issue/${id}`, ...(transition ? { transition } : {}) }, { status: 201 });
}

// source: spec:getIssue "Returns the details for an issue."
export async function getIssue(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  return Response.json(issueView(ctx, c, i, fieldsAsked(new URL(ctx.call.request.url).searchParams.getAll('fields').join(','))));
}

// source: spec:editIssue "Edits an issue."
export async function editIssue(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'write:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  const b = obj(ctx.body);
  const f = obj(b.fields);
  // source: spec:editIssue "the request includes one or more fields that don't exist or aren't associated with the project and issue type."
  // Only these screen fields/label updates are in the measured scope; unavailable edits are refused, never discarded.
  const unsupported = Object.keys(f).filter((key) => !['summary', 'description', 'labels', 'priority', 'assignee'].includes(key));
  if (unsupported.length || Object.keys(obj(b.update)).some((key) => key !== 'labels')) return jiraError(400, ['The requested field edit is not available in this project.']);
  const fields: Row = { ...obj(i.fields), updated: now(ctx) };
  const priority = f.priority === undefined ? fields.priority : editedPriority(f.priority);
  if (priority instanceof Response) return priority;
  fields.priority = priority;
  const assignee = f.assignee === undefined ? fields.assignee : editedAssignee(ctx, c, f.assignee);
  if (assignee instanceof Response) return assignee;
  fields.assignee = assignee;
  const summary = f.summary === undefined ? fields.summary : editedSummary(f.summary);
  if (summary instanceof Response) return summary;
  fields.summary = summary;
  const descriptionError = f.description === undefined ? undefined : adfError(f.description);
  if (descriptionError) return jiraError(400, [], { description: descriptionError });
  fields.description = f.description === undefined ? fields.description : f.description;
  let labels = arr<string>(obj(i.fields).labels);
  if (f.labels !== undefined) labels = arr<string>(f.labels);
  // an `update` names operations on a field: labels added and removed
  for (const op of arr<Row>(obj(b.update).labels)) {
    if (typeof op.add === 'string' && !labels.includes(op.add)) labels = [...labels, op.add];
    if (typeof op.remove === 'string') labels = labels.filter((l) => l !== op.remove);
    if (Array.isArray(op.set)) labels = op.set.map(String);
  }
  // source: spec:editIssue "labels"
  if (labels.some((l) => /\s/.test(l))) return jiraError(400, [], { labels: 'The label must not contain spaces.' });
  fields.labels = labels;
  await ctx.write(ISSUE, String(i.id), { fields }, 'editIssue');
  return new Response(null, { status: 204 });
}

// source: spec:getComments "Returns all comments for an issue."
export async function getComments(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  const all = ctx.rowsRaw(COMMENT).filter((m) => m.deleted !== true && (m._issue === i.id || String(m.self ?? '').startsWith(String(i.self) + '/comment/')) && (m.visibility === undefined || (ctx.row(PERSON, c.person)?.admin_of as string[]).includes(c.site))).sort((a, z) => Number(a.id) - Number(z.id));
  const q = new URL(ctx.call.request.url).searchParams;
  const startAt = Number(q.get('startAt') ?? 0);
  const maxResults = Math.min(5000, Number(q.get('maxResults') ?? 5000));
  return Response.json({ comments: all.slice(startAt, startAt + maxResults).map((m) => commentView(ctx, c, m)), maxResults, total: all.length, startAt });
}

// source: spec:addComment "Adds a comment to an issue."
export async function addComment(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'write:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  const body = obj(ctx.body).body;
  const bad = body === undefined ? 'Comment body can not be empty!' : adfError(body);
  if (bad) return jiraError(400, [], { comment: bad });
  // source: spec:addComment "visibility"
  const visibility = obj(obj(ctx.body).visibility);
  if (Object.keys(visibility).length && (visibility.type !== 'role' || visibility.value !== 'Administrators')) return jiraError(400, ['This visibility configuration is not modeled.']);
  if (visibility.value && !(ctx.row(PERSON, c.person)?.admin_of as string[]).includes(c.site)) return jiraError(403, ['You cannot add an administrator-only comment.']);
  const id = ctx.mint(COMMENT);
  await ctx.write(COMMENT, id, { id, self: `${base(c)}/issue/${i.id}/comment/${id}`, body, ...(visibility.value ? { visibility: { type: 'role', value: 'Administrators', identifier: 'Administrators' } } : {}), author: userView(ctx, c.site, c.person), updateAuthor: userView(ctx, c.site, c.person), jsdPublic: true, created: now(ctx), updated: now(ctx), _issue: i.id, _author: c.person, _site: c.site }, 'addComment');
  await ctx.write(ISSUE, String(i.id), { fields: { ...obj(i.fields), updated: now(ctx) } }, 'issue.commented');
  return Response.json(commentView(ctx, c, ctx.row(COMMENT, id)!), { status: 201 });
}

/** The transitions the issue's workflow offers from where it is: every status but its own. */
const offered = (i: Row): typeof TRANSITIONS => TRANSITIONS.filter((t) => t.to !== obj(obj(i.fields).status).name);

// source: spec:getTransitions "Returns either all transitions or a transition that can be performed by the user on an issue, based on the issue's status."
export async function getTransitions(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  const only = new URL(ctx.call.request.url).searchParams.get('transitionId');
  const list = offered(i).filter((t) => !only || t.id === only);
  return Response.json({
    expand: 'transitions',
    transitions: list.map((t) => ({ id: t.id, name: t.to, to: statusView(c, t.to), hasScreen: false, isGlobal: true, isInitial: false, isAvailable: true, isConditional: false })),
  });
}

// source: spec:doTransition "Performs an issue transition"
export async function doTransition(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'write:jira-work');
  if (c instanceof Response) return c;
  const i = issueOf(ctx, c, ctx.call.params.issueIdOrKey);
  if (i instanceof Response) return i;
  const id = String(obj(obj(ctx.body).transition).id ?? '');
  const t = offered(i).find((x) => x.id === id);
  // Where the documentation stops: the message is the twin's, in Jira's error form
  if (!t) return jiraError(400, [`Transition id '${id}' is not valid for this issue.`]);
  const refused = ctx.legal(ISSUE, '_status', 'doTransition', obj(obj(i.fields).status).name, t.to, String(i.id));
  if (refused) return jiraError(refused.status, [refused.message]);
  await ctx.write(ISSUE, String(i.id), { _status: t.to, fields: { ...obj(i.fields), status: statusView(c, t.to), resolutiondate: t.to === 'Done' ? now(ctx) : null, updated: now(ctx) } }, 'doTransition');
  return new Response(null, { status: 204 });
}


// Projects and what the filing taxonomy reads: a site's projects (paged), one with its issue types, its components,
// the labels its issues carry, and the people who can be assigned. Projects and components are made through the API,
// which is how the World seeds them (the seeding rule).

const q = (ctx: HandlerContext): URLSearchParams => new URL(ctx.call.request.url).searchParams;
/** A page as Jira pages a list (startAt, maxResults, total, isLast, values). */
function page(ctx: HandlerContext, items: Row[], max = 50, defaultMax = 50): Row {
  const startAt = Number(q(ctx).get('startAt') ?? 0);
  const maxResults = Math.min(max, Number(q(ctx).get('maxResults') ?? defaultMax));
  const values = items.slice(startAt, startAt + maxResults);
  return { startAt, maxResults, total: items.length, isLast: startAt + values.length >= items.length, values };
}

// source: spec:searchProjects "list of projects visible to the user."
export async function searchProjects(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const projects = ctx.rowsRaw(PROJECT).filter((p) => p.deleted !== true && inSite(c, p)).sort((a, z) => String(a.key).localeCompare(String(z.key)));
  // source: spec:searchProjects "The maximum number of items to return per page."
  const body = page(ctx, projects.map((p) => projectView(ctx, c, p)));
  const self = new URL(base(c) + '/project/search');
  q(ctx).forEach((v, k) => self.searchParams.append(k, v));
  const next = new URL(self);
  next.searchParams.set('startAt', String(Number(body.startAt) + Number(body.maxResults)));
  next.searchParams.set('maxResults', String(body.maxResults));
  // source: spec:/components/schemas/PageBeanProject/properties/nextPage "If there is another page of results, the URL of the next page."
  return Response.json({ self: String(self), ...body, ...(body.isLast ? {} : { nextPage: String(next) }) });
}

// source: spec:createProject "Creates a project based on a project type template"
export async function createProject(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'manage:jira-project');
  if (c instanceof Response) return c;
  const b = obj(ctx.body);
  const key = String(b.key ?? '');
  const errors: Row = {};
  // Where the documentation stops: the messages are the twin's, in Jira's field-error form
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) errors.projectKey = 'Project keys must start with an uppercase letter, followed by one or more uppercase alphanumeric characters.';
  if (typeof b.name !== 'string' || !b.name) errors.projectName = 'You must specify a valid project name.';
  if (!b.leadAccountId || !ctx.row(PERSON, String(b.leadAccountId))) errors.projectLead = 'You must specify a valid project lead.';
  if (ctx.rowsRaw(PROJECT).some((p) => p.deleted !== true && inSite(c, p) && p.key === key)) errors.projectKey = `Project '${key}' uses this project key.`;
  if (Object.keys(errors).length) return jiraError(400, [], errors);
  const id = ctx.mint(PROJECT);
  const project = { id, key, name: b.name, description: b.description ?? '', projectTypeKey: b.projectTypeKey ?? 'software' };
  await ctx.write(PROJECT, id, { ...newProjectView(c, project), lead: userView(ctx, c.site, b.leadAccountId), _lead: b.leadAccountId, _site: c.site }, 'createProject');
  // source: spec:createProject "Creates a project"
  return Response.json({ self: `${base(c)}/project/${id}`, id: Number(id), key }, { status: 201 });
}

// source: spec:getProject "for a project."
export async function getProject(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const p = projectOf(ctx, c, ctx.call.params.projectIdOrKey);
  if (p instanceof Response) return p;
  return Response.json({ ...projectView(ctx, c, p, (q(ctx).get('expand') ?? '').split(',').includes('issueTypes')), lead: p._lead ? userView(ctx, c.site, p._lead) : p.lead });
}


// source: spec:getProjectComponents "Returns all components in a project."
export async function getProjectComponents(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const p = projectOf(ctx, c, ctx.call.params.projectIdOrKey);
  if (p instanceof Response) return p;
  return Response.json(ctx.rowsRaw(COMPONENT).filter((k) => k.deleted !== true && String(k._project ?? k.projectId) === String(p.id)).map((k) => componentView(ctx, c, k)));
}

// source: spec:createComponent "Creates a component."
export async function createComponent(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'manage:jira-project');
  if (c instanceof Response) return c;
  const b = obj(ctx.body);
  const p = projectOf(ctx, c, b.project ?? b.projectId);
  if (p instanceof Response) return jiraError(400, [], { project: 'The project is not valid.' });
  // source: spec:/components/schemas/ProjectComponent/properties/name "The maximum length is 255 characters."
  if (typeof b.name !== 'string' || !b.name || b.name.length > 255) return jiraError(400, [], { name: 'A component name of 1 to 255 characters is required.' });
  // source: spec:/components/schemas/ProjectComponent/properties/assigneeType "Optional when creating or updating a component."
  const assigneeType = String(b.assigneeType ?? 'PROJECT_DEFAULT');
  if (!['PROJECT_DEFAULT', 'PROJECT_LEAD', 'COMPONENT_LEAD', 'UNASSIGNED'].includes(assigneeType)) return jiraError(400, [], { assigneeType: 'Invalid assignee type.' });
  const lead = b.leadAccountId ? componentLead(ctx, c, b.leadAccountId) : undefined;
  if (lead instanceof Response) return lead;
  // source: spec:/components/schemas/ProjectComponent/properties/isAssigneeTypeValid "then `false` is returned."
  const leads: Row = { COMPONENT_LEAD: lead?.id, UNASSIGNED: null, PROJECT_LEAD: p._lead ?? obj(p.lead).accountId, PROJECT_DEFAULT: p._lead ?? obj(p.lead).accountId };
  const nominal = leads[assigneeType];
  const isAssigneeTypeValid = assigneeType === 'UNASSIGNED' || nominal !== undefined;
  const realAssigneeType = isAssigneeTypeValid ? assigneeType : 'PROJECT_DEFAULT';
  const actual = leads[realAssigneeType];
  const id = ctx.mint(COMPONENT);
  const view = newComponentView(c, { id, name: b.name, description: b.description ?? '', _project: p.id, _projectKey: p.key });
  const leadView = lead ? { lead: userView(ctx, c.site, lead.id) } : {};
  const assigned = { assignee: userView(ctx, c.site, nominal), realAssignee: userView(ctx, c.site, actual) };
  await ctx.write(COMPONENT, id, { ...view, ...leadView, ...assigned, assigneeType, isAssigneeTypeValid, realAssigneeType, _project: p.id, _site: c.site }, 'createComponent');
  return Response.json(componentView(ctx, c, ctx.row(COMPONENT, id)!), { status: 201 });
}

// source: spec:getAllLabels "list of labels."
export async function getAllLabels(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  // the labels the site's issues carry
  const labels = [...new Set(ctx.rowsRaw(ISSUE).filter((i) => i.deleted !== true && inSite(c, i)).flatMap((i) => arr<string>(obj(i.fields).labels)))].sort();
  return Response.json(page(ctx, labels as unknown as Row[], 1000, 1000));
}

// source: spec:findAssignableUsers "Returns a list of users that can be assigned to an issue."
export async function findAssignableUsers(ctx: HandlerContext): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-user');
  if (c instanceof Response) return c;
  const params = q(ctx);
  const project = params.get('project'), issue = params.get('issueKey') ?? params.get('issueId');
  const query = params.get('query'), accountId = params.get('accountId');
  // source: spec:findAssignableUsers "`query` or `accountId` is missing."
  // source: spec:findAssignableUsers "`query` and `accountId` are provided."
  if ((!project && !issue) || (query === null && accountId === null) || (query !== null && accountId !== null)) return jiraError(400, ['Specify a project or issue and exactly one of query or accountId.']);
  if (project) { const p = projectOf(ctx, c, project); if (p instanceof Response) return p; }
  if (issue) { const refusal = assignableIssue(ctx, c, issue, params.get('actionDescriptorId')); if (refusal) return refusal; }
  // source: spec:findAssignableUsers "The string can match the prefix of the attribute's value."
  const matching = ctx.rowsRaw(PERSON).filter((p) => p.deleted !== true && (accountId !== null ? p.id === accountId : [p.displayName, p.email].some((v) => String(v).toLowerCase().startsWith(query!.toLowerCase()))));
  const start = Math.max(0, Number(params.get('startAt') ?? 0)), max = Math.max(0, Number(params.get('maxResults') ?? 50));
  // source: spec:findAssignableUsers "then returns only the users from that range that can be assigned the issue."
  const people = matching.slice(start, Math.min(1000, start + max)).filter((p) => p.active !== false && arr<string>(p.sites).includes(c.site));
  return Response.json(people.map((p) => userView(ctx, c.site, p.id)));
}

// JQL search (POST and GET /search/jql): the JQL Runhuman 1 writes, parsed — `project = "KEY"`, joined by AND with
// `statusCategory` compared by `=`, `!=`, `in (...)` or `not in (...)` (a category by its name or key), and `ORDER BY`
// `updated` or `created`, `ASC` or `DESC` — paged by nextPageToken. JQL the twin does not parse is refused as Jira
// refuses a query it cannot read, naming the part it could not.

type Clause = { field: 'project' | 'statuscategory'; op: '=' | '!=' | 'in' | 'not in'; values: string[] };
type Query = { clauses: Clause[]; order: { field: 'updated' | 'created'; dir: 'ASC' | 'DESC' } };

/** A JQL query in the subset, or the part the twin could not read. */
function parseJql(jql: string): Query | { error: string } {
  const [where, orderBy] = jql.split(/\s+ORDER\s+BY\s+/i);
  const order: Query['order'] = { field: 'created', dir: 'DESC' };
  if (orderBy !== undefined) {
    const m = /^(updated|created)(?:\s+(ASC|DESC))?\s*$/i.exec(orderBy.trim());
    if (!m) return { error: orderBy.trim() };
    order.field = m[1]!.toLowerCase() as 'updated' | 'created';
    order.dir = (m[2]?.toUpperCase() ?? 'ASC') as 'ASC' | 'DESC';
  }
  const clauses: Clause[] = [];
  const unquote = (v: string): string => v.trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
  for (const part of (where ?? '').trim() ? where!.split(/\s+AND\s+/i) : []) {
    const m = /^\s*(project|statusCategory)\s*(=|!=|not\s+in|in)\s*(.+?)\s*$/i.exec(part);
    if (!m) return { error: part.trim() };
    const op = m[2]!.toLowerCase().replace(/\s+/, ' ') as Clause['op'];
    const raw = m[3]!;
    const values = op === 'in' || op === 'not in' ? (/^\((.*)\)$/.exec(raw)?.[1]?.split(',').map(unquote) ?? null) : [unquote(raw)];
    if (!values) return { error: part.trim() };
    clauses.push({ field: m[1]!.toLowerCase() as Clause['field'], op, values });
  }
  return { clauses, order };
}

/** Whether a status's category is one a clause names (by name, `To Do`, or key, `new`). */
const inCategory = (status: string, names: string[]): boolean => {
  const cat = STATUSES[status]!.category;
  return names.some((n) => n.toLowerCase() === cat.name.toLowerCase() || n.toLowerCase() === cat.key);
};

async function search(ctx: HandlerContext, input: Row): Promise<Response> {
  const c = callerOf(ctx, 'read:jira-work');
  if (c instanceof Response) return c;
  const jql = String(input.jql ?? '');
  const q = parseJql(jql);
  // source: spec:searchAndReconsileIssuesUsingJqlPost "Searches for issues using"
  // Where the documentation stops: the message is the twin's, in Jira's JQL error form
  if ('error' in q) return jiraError(400, [`Error in the JQL Query: the twin does not read '${q.error}'.`]);
  const projects = ctx.rowsRaw(PROJECT).filter((p) => p.deleted !== true && inSite(c, p));
  for (const cl of q.clauses) {
    if (cl.field === 'project') for (const v of cl.values) if (!projects.some((p) => p.key === v || p.id === v)) return jiraError(400, [`The value '${v}' does not exist for the field 'project'.`]);
  }
  const hits = ctx.rowsRaw(ISSUE).filter((i) => i.deleted !== true && inSite(c, i)).filter((i) => q.clauses.every((cl) => {
    const project = ctx.row(PROJECT, String(i._project ?? obj(obj(i.fields).project).id))!;
    const is = cl.field === 'project' ? cl.values.includes(String(project.key)) || cl.values.includes(String(project.id)) : inCategory(String(obj(obj(i.fields).status).name), cl.values);
    return cl.op === '=' || cl.op === 'in' ? is : !is;
  })).sort((a, z) => {
    const d = String(obj(a.fields)[q.order.field]).localeCompare(String(obj(z.fields)[q.order.field])) || Number(a.id) - Number(z.id);
    return q.order.dir === 'ASC' ? d : -d;
  });
  // source: spec:/components/schemas/SearchAndReconcileRequestBean "Use the `nextPageToken` to fetch the next page of issues."
  const start = input.nextPageToken ? Number(Buffer.from(String(input.nextPageToken), 'base64url').toString('utf8')) || 0 : 0;
  const max = Math.min(5000, Number(input.maxResults ?? 50));
  const pageOf = hits.slice(start, start + max);
  const next = start + pageOf.length < hits.length ? Buffer.from(String(start + pageOf.length)).toString('base64url') : undefined;
  return Response.json({ issues: pageOf.map((i) => issueView(ctx, c, i, fieldsAsked(input.fields) ?? ['id'])), ...(next ? { nextPageToken: next } : {}), isLast: !next });
}

// source: spec:searchAndReconsileIssuesUsingJqlPost "Searches for issues using"
export async function searchAndReconsileIssuesUsingJqlPost(ctx: HandlerContext): Promise<Response> { return search(ctx, obj(ctx.body)); }

// source: spec:searchAndReconsileIssuesUsingJql "Searches for issues using"
export async function searchAndReconsileIssuesUsingJql(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  return search(ctx, { jql: q.get('jql') ?? '', ...(q.get('nextPageToken') ? { nextPageToken: q.get('nextPageToken') } : {}), ...(q.get('maxResults') ? { maxResults: q.get('maxResults') } : {}), ...(q.get('fields') ? { fields: q.get('fields') } : {}) });
}

// source: spec:editIssue "Edits an issue."
const editedSummary = (summary: unknown): string | Response => typeof summary === 'string' && summary.trim() ? summary : jiraError(400, [], { summary: 'You must specify a summary of the issue.' });

// source: spec:editIssue "The edits to the issue's fields are defined"
function editedPriority(input: unknown): Row | Response {
  const priority = PRIORITIES.find((p) => p.id === String(obj(input).id) || p.name === obj(input).name);
  return priority ?? jiraError(400, [], { priority: 'Specify a valid priority.' });
}
// source: spec:editIssue "The edits to the issue's fields are defined"
function editedAssignee(ctx: HandlerContext, c: Caller, input: unknown): Row | Response | null {
  const id = obj(input).accountId;
  if (id != null && !arr<string>(ctx.row(PERSON, String(id))?.sites).includes(c.site)) return jiraError(400, [], { assignee: 'The user cannot be assigned this issue.' });
  return userView(ctx, c.site, id);
}
// source: spec:createComponent "the user is not found."
function componentLead(ctx: HandlerContext, c: Caller, id: unknown): Row | Response {
  const lead = ctx.row(PERSON, String(id));
  return lead && arr<string>(lead.sites).includes(c.site) ? lead : jiraError(400, [], { leadAccountId: 'User not found.' });
}
// source: spec:findAssignableUsers "the project, issue, or transition is not found."
function assignableIssue(ctx: HandlerContext, c: Caller, key: string, action: string | null): Response | undefined {
  const issue = issueOf(ctx, c, key);
  if (issue instanceof Response) return issue;
  if (action && !offered(issue).some((t) => t.id === action)) return jiraError(404, ['Transition not found.']);
}
