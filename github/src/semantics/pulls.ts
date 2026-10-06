// GitHub's pulls operations (https://docs.github.com/en/rest/pulls) the core cannot serve: opening one (its issue, its
// workflows), the list's head filter, its files and commits from the git plane, reviews, and merging. A pull request
// is read by the core.
import { git, type HandlerContext } from '@volter/world-core';
import { nodeId } from '../engine/objects.ts';
import { account, actorLogin, association, bodyOf, commitsBetween, fail, gitOf, invalid, issueByNumber, json, mergePull, mint, notFound, nowIso, openPull, page, pullByNumber, repoOfPath, type Row, shown, str, tipOf, who } from './shared.ts';

/** pulls/create: a pull request of a head branch — this repository's (`branch`) or a fork's (`owner:branch`) — into a
 *  base branch, by anyone who can read the base; its body may name an issue instead (`issue`: that issue's title and
 *  body). */
// source: https://docs.github.com/en/rest/pulls/pulls "An issue in the repository to convert to a pull request. The issue title, body, and comments will become the title, body, and comments on the new pull request. Required unless title is specified."
// source: https://docs.github.com/en/rest/pulls/pulls "Indicates whether the pull request is a draft."
export async function pulls_create(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  const b = bodyOf(ctx);
  const from = b.issue !== undefined ? issueByNumber(ctx, repo, b.issue) : undefined;
  if (b.issue !== undefined && (!from || from.pull_request)) return invalid('PullRequest', 'issue', 'invalid');
  const p = await openPull(ctx, repo, c, { title: str(b.title) ?? (from ? String(from.title) : undefined), head: str(b.head), base: str(b.base), body: str(b.body) ?? (from ? (from.body as string | null) : null), draft: b.draft === true });
  return p instanceof Response ? p : json(shown(ctx, p, 'pull-request'), 201);
}

/** pulls/list: open pull requests, newest first; `state`, `head` (`owner:branch`), `base`, `sort`, `direction`; each as
 *  the list's simple form names it (no counts, no merge state). */
// source: https://docs.github.com/en/rest/pulls/pulls "Filter pulls by head user or head organization and branch name in the format of user:ref-name or organization:ref-name ."
// source: https://docs.github.com/en/rest/pulls/pulls "Filter pulls by base branch name."
// source: spec:/components/schemas/pull-request-simple "Pull Request Simple"
export async function pulls_list(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const p = ctx.params;
  const state = str(p.state) ?? 'open';
  const all = ctx.rowsRaw('pull').filter((x) => x._repo === repo.full_name && (state === 'all' || x.state === state)
    && (!str(p.head) || (x.head as Row).label === p.head) && (!str(p.base) || (x.base as Row).ref === p.base));
  const key = (x: Row): string => String(str(p.sort) === 'updated' ? x.updated_at : x.created_at);
  all.sort((a, b) => key(a).localeCompare(key(b)) || Number(a.id) - Number(b.id));
  return json(page(ctx, str(p.direction) === 'asc' ? all : all.reverse()).map((x) => {
    const { additions: _a, deletions: _d, changed_files: _c, commits: _m, comments: _k, review_comments: _r, maintainer_can_modify: _x, mergeable: _y, rebaseable: _z, mergeable_state: _w, merged: _v, merged_by: _u, ...simple } = shown(ctx, x);
    return simple;
  }));
}

const STATE_OF: Record<string, string> = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED', COMMENT: 'COMMENTED' };

/** pulls/create-review: a review of the head as it stands (approving, requesting changes or commenting, a body needed
 *  for the last two), or pending with no event, which has no submitted_at; its author may not approve or request
 *  changes on their own pull request (where the documentation stops, "Can not approve your own pull request" are
 *  GitHub's words). A submitted review takes the reviewer off the requested ones. */
// source: https://docs.github.com/en/rest/pulls/reviews "The review actions include: APPROVE , REQUEST_CHANGES , or COMMENT . By leaving this blank, you set the review action state to PENDING"
// source: https://docs.github.com/en/rest/pulls/reviews "Required when using REQUEST_CHANGES or COMMENT for the event parameter."
// source: https://docs.github.com/en/rest/pulls/reviews "Pull request reviews created in the PENDING state are not submitted and therefore do not include the submitted_at property in the response."
// source: https://docs.github.com/en/rest/pulls/reviews "Defaults to the most recent commit in the pull request when you do not specify a value."
// source: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews "Pull request authors cannot approve their own pull requests."
export async function pulls_create_review(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  const p = pullByNumber(ctx, repo, ctx.call.params.pull_number);
  if (!p) return notFound(ctx);
  const b = bodyOf(ctx);
  const event = str(b.event);
  const state = event ? STATE_OF[event] : 'PENDING';
  if (!state) return invalid('PullRequestReview', 'event', 'invalid');
  const by = actorLogin(c);
  if (by === (p.user as Row).login && (state === 'APPROVED' || state === 'CHANGES_REQUESTED')) return invalid('PullRequestReview', 'event', 'custom', `Can not ${state === 'APPROVED' ? 'approve' : 'request changes on'} your own pull request`);
  if ((state === 'CHANGES_REQUESTED' || state === 'COMMENTED') && !str(b.body)) return invalid('PullRequestReview', 'body', 'custom', 'Review Comment body is required for this event');
  const full = String(repo.full_name);
  const id = mint(ctx, 'pull-request-review');
  const v = await ctx.write('pull-request-review', String(id), {
    id, node_id: nodeId('PullRequestReview', id), user: account(ctx, by), body: str(b.body) ?? '', state, html_url: `https://github.com/${full}/pull/${String(p.number)}#pullrequestreview-${id}`,
    pull_request_url: `https://api.github.com/repos/${full}/pulls/${String(p.number)}`, author_association: association(ctx, repo, by), ...(state === 'PENDING' ? {} : { submitted_at: nowIso(ctx) }),
    commit_id: str(b.commit_id) ?? (p.head as Row).sha, _links: { html: { href: `https://github.com/${full}/pull/${String(p.number)}#pullrequestreview-${id}` }, pull_request: { href: `https://api.github.com/repos/${full}/pulls/${String(p.number)}` } },
    _repo: full, _pull: String(p.number),
  }, state === 'PENDING' ? 'review.pending' : 'review.submitted');
  if (state !== 'PENDING') await ctx.write('pull-request', String(p.id), { requested_reviewers: ((p.requested_reviewers as Row[]) ?? []).filter((r) => r.login !== by), updated_at: nowIso(ctx) }, 'pull.reviewed');
  return json(shown(ctx, v, 'pull-request-review'));
}

/** pulls/merge: the head merged into the base by someone who can write (shared.ts mergePull). */
// source: https://docs.github.com/en/rest/pulls/pulls "200 if merge was successful"
export async function pulls_merge(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const p = pullByNumber(ctx, repo, ctx.call.params.pull_number);
  if (!p) return notFound(ctx);
  const merged = await mergePull(ctx, repo, p, actorLogin(who(ctx)!), bodyOf(ctx));
  return merged instanceof Response ? merged : json({ sha: merged.sha, merged: true, message: 'Pull Request successfully merged' });
}
