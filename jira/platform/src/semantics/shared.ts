// What the platform lane shares: the caller (a 3LO grant that covers the path's site), Jira's views of a project, an
// issue and a comment (each with its `self` URL), a new project's issue types and statuses, and the priorities.
import type { HandlerContext } from '@volter/world-core';
import { API_TOKEN, grantOf, ISSUE, jiraError, obj, PERSON, PROJECT, type Row, SITE, arr } from '../../../src/semantics/shared.ts';

export { arr, COMMENT, COMPONENT, ISSUE, jiraError, obj, PERSON, PROJECT, type Row } from '../../../src/semantics/shared.ts';

export type Caller = { site: string; siteUrl: string; person: string };
/** The caller: a grant that covers the site the path names (`/ex/jira/{cloudId}`), or Jira's refusal. */
export function callerOf(ctx: HandlerContext, scope: string): Caller | Response {
  const g = grantOf(ctx);
  // source: spec:getIssue "Returned if the authentication credentials are incorrect or missing."
  // Where the documentation stops: the messages are the twin's, in Jira's error form
  // source: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/ "Build a string of the form useremail:api_token."
  const encoded = /^Basic\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const [email, token] = encoded ? Buffer.from(encoded, 'base64').toString('utf8').split(':') : [];
  const basic = token ? ctx.rowsRaw(API_TOKEN).find((r) => r.email === email && r.sha256 === ctx.crypto.digest('sha256', token, 'hex')) : undefined;
  if (!g && !basic) return jiraError(401, ['Client must be authenticated to access this resource.']);
  if (basic) {
    const person = ctx.row(PERSON, String(basic.person));
    const site = String(ctx.call.params.cloudId ?? basic.site);
    if (!person || !ctx.row(SITE, site) || site !== basic.site) return jiraError(401, ['Unauthorized; scope does not match']);
    const host = ctx.call.request.headers.get('x-volter-twin-original-host') ?? ctx.call.request.headers.get('host') ?? new URL(ctx.call.request.url).hostname;
    const hostname = host.split(':')[0];
    const siteHost = new URL(String(ctx.row(SITE, site)!.url)).hostname;
    if (hostname !== siteHost && !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) return jiraError(401, ['Unauthorized; scope does not match']);
    if (scope === 'manage:jira-project' && !(person.admin_of as string[]).includes(site)) return jiraError(403, ['You do not have permission to administer this site.']);
    return { site, siteUrl: String(ctx.row(SITE, site)!.url), person: String(basic.person) };
  }
  const site = String(ctx.call.params.cloudId ?? '');
  if (!g!.sites.includes(site) || !ctx.row(SITE, site)) return jiraError(401, ['Unauthorized; scope does not match']);
  if (!g!.scopes.includes(scope)) return jiraError(401, ['Unauthorized; scope does not match']);
  // source: spec:createProject "Administer Jira"
  if (scope === 'manage:jira-project' && !arr<string>(ctx.row(PERSON, g!.person)?.admin_of).includes(site)) return jiraError(403, ['You do not have permission to administer this site.']);
  return { site, siteUrl: String(ctx.row(SITE, site)!.url), person: g!.person };
}

/** The API's base for a site, as its `self` URLs name it. */
export const base = (c: Pick<Caller, 'siteUrl'>): string => `${c.siteUrl}/rest/api/3`;
export const inSite = (c: Caller, row: Row): boolean => row._site === c.site || String(row.self ?? '').startsWith(base(c) + '/');

/** A person as Jira names one (a user bean). */
export function userView(ctx: HandlerContext, site: string, id: unknown): Row | null {
  const p = id ? ctx.row(PERSON, String(id)) : undefined;
  if (!p) return null;
  return { self: `${base({ siteUrl: String(ctx.row(SITE, site)!.url) })}/user?accountId=${String(p.id)}`, accountId: p.id, accountType: 'atlassian', displayName: p.displayName, active: p.active !== false, timeZone: 'America/New_York', avatarUrls: avatarUrls(p.displayName) };
}

/** A person's avatars at the four sizes an AvatarUrlsBean names. */
// source: spec:/components/schemas/AvatarUrlsBean "The URL of the item's 16x16 pixel avatar."
// Where the documentation stops: getCurrentUser's example shows the default avatar, the person's initials image
// (avatar-management--avatars.server-location.prod.public.atl-paas.net/initials/MK-5.png); the twin draws the
// person's initials the same way and keeps the example's colour index, 5, whose rule Atlassian does not publish.
function avatarUrls(name: unknown): Row {
  const initials = String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'U';
  return Object.fromEntries([16, 24, 32, 48].map((n) => [`${n}x${n}`, `https://avatar-management--avatars.server-location.prod.public.atl-paas.net/initials/${encodeURIComponent(initials)}-5.png?size=${n}&s=${n}`]));
}

// Where the documentation stops: a new software project's issue types and statuses are its template's; the twin's
// are the ones a new team-managed software project shows
export const ISSUE_TYPES = [
  { id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 }, { id: '10002', name: 'Bug', subtask: false, hierarchyLevel: 0 },
  { id: '10003', name: 'Story', subtask: false, hierarchyLevel: 0 }, { id: '10004', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  { id: '10005', name: 'Subtask', subtask: true, hierarchyLevel: -1 },
];
// source: spec:getStatusCategories "Returns a list of all status categories."
export const STATUSES: Record<string, { id: string; category: { id: number; key: string; name: string; colorName: string } }> = {
  'To Do': { id: '10000', category: { id: 2, key: 'new', name: 'To Do', colorName: 'blue-gray' } },
  'In Progress': { id: '3', category: { id: 4, key: 'indeterminate', name: 'In Progress', colorName: 'yellow' } },
  Done: { id: '10001', category: { id: 3, key: 'done', name: 'Done', colorName: 'green' } },
};
/** The transitions a new project's workflow offers: one into each status, by id. */
export const TRANSITIONS = [{ id: '11', to: 'To Do' }, { id: '21', to: 'In Progress' }, { id: '31', to: 'Done' }];
// Where the documentation stops: the default priority scheme's
export const PRIORITIES = [{ id: '1', name: 'Highest' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }, { id: '4', name: 'Low' }, { id: '5', name: 'Lowest' }];

export const statusView = (c: Pick<Caller, 'siteUrl'>, name: string): Row => {
  const s = STATUSES[name]!;
  return { self: `${base(c)}/status/${s.id}`, id: s.id, name, description: '', statusCategory: { self: `${base(c)}/statuscategory/${s.category.id}`, ...s.category } };
};

/** The project a path names (by id or key) in the caller's site, or Jira's 404. */
export function projectOf(ctx: HandlerContext, c: Caller, idOrKey: unknown): Row | Response {
  const p = ctx.rowsRaw(PROJECT).find((x) => x.deleted !== true && inSite(c, x) && (x.id === String(idOrKey) || x.key === String(idOrKey)));
  // source: spec:getProject "Returned if the project is not found or the user does not have permission to view it."
  // Where the documentation stops: the message is the twin's
  return p ?? jiraError(404, [`No project could be found with key '${String(idOrKey)}'.`]);
}
/** The issue a path names (by id or key) in the caller's site, or Jira's 404. */
export function issueOf(ctx: HandlerContext, c: Caller, idOrKey: unknown): Row | Response {
  const visible = ctx.rowsRaw(ISSUE).filter((x) => x.deleted !== true && inSite(c, x));
  // source: spec:getIssue "a case-insensitive search and check for moved issues is performed."
  // Moving issues is outside the served set, so no historical-key alias can arise.
  const i = visible.find((x) => x.id === String(idOrKey) || x.key === String(idOrKey))
    ?? visible.find((x) => String(x.key).toLowerCase() === String(idOrKey).toLowerCase());
  return i ?? jiraError(404, ['Issue does not exist or you do not have permission to see it.']);
}

export const newProjectView = (c: Caller, p: Row): Row => ({
  self: `${base(c)}/project/${String(p.id)}`, id: String(p.id), key: p.key, name: p.name, projectTypeKey: p.projectTypeKey, simplified: true, style: 'next-gen',
  isPrivate: false, archived: false, description: p.description ?? '', avatarUrls: {},
});

/** An issue as the API answers it, with only the fields asked when some are (`fields=status,labels`). */
export function issueView(ctx: HandlerContext, i: Row, fields?: string[]): Row {
  const own = publicOwn(ctx, i);
  const all = obj(own.fields);
  // source: spec:getIssue "Any issue field, prefixed with a minus to exclude."
  const includes = fields?.filter((f) => !f.startsWith('-')) ?? [];
  const want = !includes.length || includes.includes('*all') || includes.includes('*navigable') ? Object.keys(all) : includes;
  const excludes = new Set(fields?.filter((f) => f.startsWith('-')).map((f) => f.slice(1)));

  return { ...own, fields: Object.fromEntries(want.filter((f) => f in all && !excludes.has(f)).map((f) => [f, all[f]])) };
}

export const commentView = (ctx: HandlerContext, m: Row): Row => publicOwn(ctx, m);
export const projectView = (ctx: HandlerContext, c: Caller, p: Row, expandTypes = false): Row => {
  const own = publicOwn(ctx, p);
  return { ...own, ...(expandTypes ? { issueTypes: ISSUE_TYPES.map((t) => ({ self: `${base(c)}/issuetype/${t.id}`, ...t, description: '' })) } : {}) };
};

/** The fields a request asks for: `fields` as a comma list (a query) or an array (a body). */
export const fieldsAsked = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : undefined);

/** A component as the API answers it (its project by key and id). */
export const newComponentView = (c: Caller, k: Row): Row => ({ self: `${base(c)}/component/${String(k.id)}`, id: String(k.id), name: k.name, description: k.description ?? '', project: k._projectKey, projectId: Number(k._project), assigneeType: 'PROJECT_DEFAULT' });

export const componentView = (ctx: HandlerContext, k: Row): Row => publicOwn(ctx, k);

const publicOwn = (ctx: HandlerContext, row: Row): Row => Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_')));
