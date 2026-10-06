// GitHub's issues operations (https://docs.github.com/en/rest/issues) the core cannot serve: what records its author,
// what filters beyond a field's value, and what keeps a count on another subject. An issue is read, and a comment
// updated, by the core.
import type { HandlerContext } from '@volter/world-core';
import { account, actorLogin, assignable, bodyOf, commentOn, editIssue, ensureUser, fail, invalid, issueByNumber, json, labelsNamed, makeIssue, milestoneOf, mint, notFound, nowIso, ownerOf, page, repoOfPath, roleIn, type Row, shown, str, triages, who } from './shared.ts';
import { atLeast, milestoneShape } from '../engine/objects.ts';


/** issues/create: an issue by anyone who can read the repository (410 when its issues are off; where the documentation
 *  stops, "Issues are disabled for this repo" are GitHub's words); its labels, milestone and assignees set only by
 *  someone with push access (left out otherwise, as GitHub leaves them). */
// source: https://docs.github.com/en/rest/issues/issues "Any user with pull access to a repository can create an issue. If issues are disabled in the repository , the API returns a 410 Gone status."
// source: https://docs.github.com/en/rest/issues/issues "NOTE: Only users with push access can set labels for new issues. Labels are silently dropped otherwise."
// source: https://docs.github.com/en/rest/issues/issues "NOTE: Only users with push access can set the milestone for new issues. The milestone is silently dropped otherwise."
// source: https://docs.github.com/en/rest/issues/issues "NOTE: Only users with push access can set assignees for new issues. Assignees are silently dropped otherwise."
export async function issues_create(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (repo.has_issues === false) return fail(ctx, 410, 'Issues are disabled for this repo');
  const b = bodyOf(ctx);
  const title = str(b.title) ?? (typeof b.title === 'number' ? String(b.title) : undefined);
  // source: https://docs.github.com/en/rest/issues/issues "title string or integer Required"
  // source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "missing_field A parameter that was required was not specified."
  if (!title) return invalid('Issue', 'title', 'missing_field');
  const triage = triages(ctx, repo, c);
  const milestone = triage && b.milestone != null ? milestoneOf(ctx, repo, b.milestone) : undefined;
  if (triage && b.milestone != null && !milestone) return invalid('Issue', 'milestone', 'invalid');
  const assignees = triage ? [...new Set([...((b.assignees as string[] | undefined) ?? []), ...(str(b.assignee) ? [String(b.assignee)] : [])])] : [];
  if (assignees.some((a) => !assignable(ctx, repo, a))) return invalid('Issue', 'assignees', 'invalid');
  const by = actorLogin(c);
  await ensureUser(ctx, by);
  const i = await makeIssue(ctx, repo, by, { title, body: str(b.body) ?? null, labels: triage ? await labelsNamed(ctx, repo, b.labels) : [], assignees, milestone: milestone ?? null });
  return json(shown(ctx, i), 201);
}

/** issues/list-for-repo: issues and pull requests, newest first; `state`, `labels` (every one named), `assignee` (a
 *  login, `none`, `*`), `creator`, `mentioned`, `milestone` (a number, `none`, `*`), `since`, `sort`, `direction`. */
// source: https://docs.github.com/en/rest/issues/issues "List issues in a repository. Only open issues will be listed."
// source: https://docs.github.com/en/rest/issues/issues "GitHub's REST API considers every pull request an issue, but not every issue is a pull request."
// source: https://docs.github.com/en/rest/issues/issues "If the string * is passed, issues with any milestone are accepted. If the string none is passed, issues without milestones are returned."
// source: https://docs.github.com/en/rest/issues/issues "Pass in none for issues with no assigned user, and * for issues assigned to any user."
// source: https://docs.github.com/en/rest/issues/issues "A list of comma separated label names."
// source: https://docs.github.com/en/rest/issues/issues "Only show results that were last updated after the given time."
// source: https://docs.github.com/en/rest/issues/issues "Can be one of : created , updated , comments"
export async function issues_list_for_repo(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const p = ctx.params;
  const state = str(p.state) ?? 'open';
  const labels = str(p.labels)?.split(',').map((x) => x.trim().toLowerCase());
  const since = str(p.since);
  const m = p.milestone === undefined ? undefined : String(p.milestone);
  const all = ctx.rowsRaw('issue').filter((i) => {
    if (i._repo !== repo.full_name || (state !== 'all' && i.state !== state)) return false;
    const names = ((i.labels as Row[]) ?? []).map((l) => String(l.name).toLowerCase());
    if (labels && !labels.every((l) => names.includes(l))) return false;
    const assignees = ((i.assignees as Row[]) ?? []).map((a) => String(a.login));
    const a = str(p.assignee);
    if (a === 'none' ? assignees.length > 0 : a === '*' ? assignees.length === 0 : a ? !assignees.includes(a) : false) return false;
    if (str(p.creator) && (i.user as Row).login !== p.creator) return false;
    if (str(p.mentioned) && !String(i.body ?? '').includes(`@${String(p.mentioned)}`)) return false;
    const n = (i.milestone as Row | null)?.number;
    if (m === 'none' ? n != null : m === '*' ? n == null : m !== undefined ? String(n) !== m : false) return false;
    return !since || String(i.updated_at) >= since;
  });
  const sort = str(p.sort) ?? 'created';
  const key = (i: Row): string | number => (sort === 'comments' ? Number(i.comments) : String(sort === 'updated' ? i.updated_at : i.created_at));
  all.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : Number(x.id) - Number(y.id)));
  return json(page(ctx, str(p.direction) === 'asc' ? all : all.reverse()).map((row) => shown(ctx, row)));
}

/** issues/update: its title, body, state (with `state_reason`), assignees, labels and milestone, by its author or
 *  someone with push access or the triage role (the last three by push access alone). Where the documentation stops:
 *  the refusal's words are GitHub's. */
// source: https://docs.github.com/en/rest/issues/issues "Issue owners and users with push access or Triage role can edit an issue."
export async function issues_update(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const i = issueByNumber(ctx, repo, ctx.call.params.issue_number);
  if (!i) return notFound(ctx);
  const c = who(ctx);
  const by = c ? actorLogin(c) : '';
  const triage = triages(ctx, repo, c);
  if (!atLeast(roleIn(ctx, repo, c), 'triage') && !triage && (i.user as Row).login !== by) return fail(ctx, 403, 'Must have triage access to update this issue');
  const updated = await editIssue(ctx, repo, i, by, triage, bodyOf(ctx));
  return updated instanceof Response ? updated : json(shown(ctx, updated));
}

/** issues/create-comment: a comment by anyone who can read the repository; the issue's comment count is kept on it. */
// source: https://docs.github.com/en/rest/issues/comments "You can use the REST API to list comments on issues and pull requests. Every pull request is an issue, but not every issue is a pull request."
export async function issues_create_comment(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  const i = issueByNumber(ctx, repo, ctx.call.params.issue_number);
  if (!i) return notFound(ctx);
  const text = str(bodyOf(ctx).body);
  // source: https://docs.github.com/en/rest/issues/comments "body string Required"
  if (!text) return invalid('IssueComment', 'body', 'missing_field');
  return json(shown(ctx, await commentOn(ctx, repo, i, c, text)), 201);
}

/** issues/list-comments: an issue's comments, oldest first (`since`). */
// source: https://docs.github.com/en/rest/issues/comments "Issue comments are ordered by ascending ID."
export async function issues_list_comments(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const i = issueByNumber(ctx, repo, ctx.call.params.issue_number);
  if (!i) return notFound(ctx);
  const since = str(ctx.params.since);
  return json(page(ctx, ctx.rowsRaw('issue_comment').filter((x) => x._repo === repo.full_name && x._issue === String(i.number) && (!since || String(x.updated_at) >= since)).map((row) => shown(ctx, row))));
}

/** issues/list-comments-for-repo: every comment on the repository's issues and pull requests ("You can use the REST API
 *  to list comments on issues and pull requests for a repository"), by `since`, sorted by `created` (unless `updated`)
 *  in id order, `direction` turning it when `sort` is named. */
// source: https://docs.github.com/en/rest/issues/comments "By default, issue comments are ordered by ascending ID."
// source: https://docs.github.com/en/rest/issues/comments "Either asc or desc . Ignored without the sort parameter."
export async function issues_list_comments_for_repo(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const since = str(ctx.params.since);
  const sort = str(ctx.params.sort);
  const key = (x: Row): string => String(sort === 'updated' ? x.updated_at : x.created_at);
  const all = ctx.rowsRaw('issue_comment').filter((x) => x._repo === repo.full_name && x.deleted !== true && (!since || String(x.updated_at) >= since))
    .sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : Number(x.id) - Number(y.id)));
  return json(page(ctx, sort && str(ctx.params.direction) === 'desc' ? all.reverse() : all).map((row) => shown(ctx, row)));
}

/** issues/create-milestone: a milestone under the repository's next milestone number, its creator the caller; a title
 *  the repository has already is 422 already_exists. */
// source: https://docs.github.com/en/rest/issues/milestones "Creates a milestone."
// source: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api "already_exists Another resource has the same value as one of your parameters."
export async function issues_create_milestone(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const title = str(b.title);
  // source: https://docs.github.com/en/rest/issues/milestones "title string Required"
  if (!title) return invalid('Milestone', 'title', 'missing_field');
  if (ctx.rowsRaw('milestone').some((m) => m._repo === repo.full_name && m.title === title)) return invalid('Milestone', 'title', 'already_exists');
  const number = 1 + ctx.rowsRaw('milestone', { withDeleted: true }).filter((m) => m._repo === repo.full_name).reduce((n, m) => Math.max(n, Number(m.number)), 0);
  const id = mint(ctx, 'milestone');
  const m = await ctx.write('milestone', String(id), {
    ...milestoneShape(id, number, String(repo.full_name), account(ctx, actorLogin(who(ctx)!)), { title, description: str(b.description) ?? null, state: b.state, due_on: str(b.due_on) ?? null }, nowIso(ctx)),
    _repo: repo.full_name, _n: String(number),
  }, 'milestone.created');
  return json(shown(ctx, m), 201);
}

/** issues/list-milestones: a repository's milestones in a state (`open` unless asked; `all`), sorted by due date unless
 *  by completeness (`sort`, `direction`), a milestone with no due date after those with one. */
// source: https://docs.github.com/en/rest/issues/milestones "The state of the milestone. Either open , closed , or all ."
// source: https://docs.github.com/en/rest/issues/milestones "What to sort results by. Either due_on or completeness ."
export async function issues_list_milestones(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const state = str(ctx.params.state) ?? 'open';
  if (!['open', 'closed', 'all'].includes(state)) return invalid('Milestone', 'state', 'invalid');
  const done = (m: Row): number => { const all = Number(m.open_issues ?? 0) + Number(m.closed_issues ?? 0); return all ? Number(m.closed_issues ?? 0) / all : 0; };
  const byCompleteness = str(ctx.params.sort) === 'completeness';
  const desc = str(ctx.params.direction) === 'desc';
  const held = ctx.rowsRaw('milestone').filter((m) => m._repo === repo.full_name && (state === 'all' || m.state === state)).sort((a, b) => {
    const d = byCompleteness ? done(a) - done(b) : (a.due_on ? (b.due_on ? String(a.due_on).localeCompare(String(b.due_on)) : -1) : b.due_on ? 1 : 0);
    return (desc ? -d : d) || Number(a.number) - Number(b.number);
  });
  return json(page(ctx, held).map((row) => shown(ctx, row)));
}
