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

/** pulls/list-files: the numbered pull's actual Git comparison, paged as diff-entry objects. */
// source: spec:pulls/list-files "Lists the files in a specified pull request."
// source: spec:pulls/list-files "Responses include a maximum of 3000 files."
// source: spec:/components/parameters/per-page "The number of results per page (max 100)."
// source: spec:/components/parameters/page "The page number of the results to fetch."
export async function pulls_list_files(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const pull = pullByNumber(ctx, repo, ctx.call.params.pull_number);
  if (!pull || pull.deleted === true) return notFound(ctx);
  const base = pull.base as Row | undefined;
  const head = pull.head as Row | undefined;
  if (!base || !head) return notFound(ctx);
  const headName = str((head.repo as Row | null)?.full_name) ?? str(pull._head_repo) ?? String(repo.full_name);
  const headRepo = ctx.rowsRaw('repository').find((r) => r.full_name === headName);
  // Open pulls follow their branch tips; a closed pull keeps its recorded comparison even after a merge or deletion.
  const baseSha = (pull.state === 'open' && str(base.ref) ? tipOf(ctx, repo, String(base.ref)) : undefined) ?? str(base.sha);
  const headSha = (pull.state === 'open' && headRepo && str(head.ref) ? tipOf(ctx, headRepo, String(head.ref)) : undefined) ?? str(head.sha);
  if (!baseSha || !headSha) return notFound(ctx);
  const files = await git.diffFiles(gitOf(ctx, repo).store, baseSha, headSha, { patch: true });
  if (files === null) return notFound(ctx);
  const all = files.slice(0, 3000);
  const per = Math.min(100, Math.max(1, Math.trunc(Number(ctx.params.per_page) || 30)));
  const number = Math.max(1, Math.trunc(Number(ctx.params.page) || 1));
  const rows = page({ ...ctx, params: { ...ctx.params, per_page: per, page: number } }, all).map((file) => {
    const path = file.filename.split('/').map(encodeURIComponent).join('/');
    const full = String(repo.full_name);
    return {
      sha: file.sha ?? null, filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions,
      changes: file.additions + file.deletions, blob_url: `https://github.com/${full}/blob/${headSha}/${path}`,
      raw_url: `https://github.com/${full}/raw/${headSha}/${path}`,
      contents_url: `https://api.github.com/repos/${full}/contents/${path}?ref=${headSha}`,
      ...(file.patch === undefined ? {} : { patch: file.patch }),
    };
  });
  const last = Math.max(1, Math.ceil(all.length / per));
  const headers = new Headers();
  if (all.length > per) {
    const at = (n: number): string => {
      const url = new URL(ctx.call.request.url);
      url.searchParams.set('page', String(n));
      return url.toString();
    };
    const links = [...(number > 1 ? [`<${at(number - 1)}>; rel="prev"`] : []),
      ...(number < last ? [`<${at(number + 1)}>; rel="next"`, `<${at(last)}>; rel="last"`] : []),
      ...(number > 1 ? [`<${at(1)}>; rel="first"`] : [])];
    if (links.length) headers.set('link', links.join(', '));
  }
  return Response.json(rows, { headers });
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
