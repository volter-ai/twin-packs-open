// GitHub's GraphQL API (https://docs.github.com/en/graphql) over the same state as REST: what the demand and the life
// send — a repository with its discussions and categories and its pull requests by branch (Open Autonomy's community
// desk; `gh pr create`, `gh pr view` and `gh pr merge`), and the mutations they make (createRepository as `gh repo
// create` sends it, createDiscussion, addDiscussionComment, createPullRequest, mergePullRequest), each written through
// the shared helper its REST twin uses. Any other root field answers GraphQL's undefinedField (the manifest's
// `graphql.unmodeled`). A resolver answers a view: the GraphQL fields of a stored subject, with `__typename` for the
// Node and Actor interfaces; `stored` names each view's plain fields for the kernel's default resolver.
import { git, GraphqlError, type GraphqlPart, type HandlerContext } from '@volter/world-core';
import { atLeast, nodeId } from '../engine/objects.ts';
import {
  account, actorLogin, approvalsOf, makeRepo, membershipOf, mergePull, mint, nextNumber, nowIso, openPull, ownerOf, protectionRefusal, repoNamed, roleIn,
  rulesetApprovals, who, type Caller, type Row,
} from './shared.ts';

type C = HandlerContext;

// ── errors and callers ──────────────────────────────────────────────────────────────────────────────

/** A helper's refusal as GitHub's GraphQL error: its message, typed as GitHub types them. Where the documentation
 *  stops: GitHub's GraphQL guides name no error types; the types are those its answers carry. */
async function settle<T>(x: T | Response): Promise<T> {
  if (!(x instanceof Response)) return x;
  const body = (await x.json().catch(() => ({}))) as Row;
  const errors = Array.isArray(body.errors) ? (body.errors as Row[]) : [];
  const message = String(errors[0]?.message ?? body.message ?? 'Something went wrong while executing your query.');
  throw new GraphqlError(message, x.status === 404 ? 'NOT_FOUND' : x.status === 403 ? 'FORBIDDEN' : 'UNPROCESSABLE');
}

/** The caller, who every mutation needs (around.ts has refused a request with none). */
function caller(ctx: C): Caller {
  return who(ctx)!;
}

/** A mutation refused for want of a role ("… does not have the correct permissions to execute `X`"). Where the
 *  documentation stops: the guides say a token lacking access is told so, not in which words; these are GitHub's. */
function needs(ctx: C, repo: Row, role: 'read' | 'write' | 'admin', mutation: string): void {
  const c = caller(ctx);
  if (!atLeast(roleIn(ctx, repo, c), role)) throw new GraphqlError(`${actorLogin(c)} does not have the correct permissions to execute \`${mutation}\``, 'FORBIDDEN');
}

// ── node ids ────────────────────────────────────────────────────────────────────────────────────────

/** A node id read back: the World's ids are GitHub's legacy form, base64 of `0<length>:<Type><id>`, which REST answers
 *  as `node_id` and GraphQL as `id`. */
// source: https://docs.github.com/en/graphql/guides/using-global-node-ids "In REST, the global node ID field is named node_id . In GraphQL, it's an id field on the node interface."
function decodeId(id: unknown): { type: string; key: string } | undefined {
  let text: string;
  try { text = atob(String(id ?? '')); } catch { return undefined; }
  const m = /^0(\d+):/.exec(text);
  if (!m) return undefined;
  const at = m[0].length;
  const n = Number(m[1]);
  return { type: text.slice(at, at + n), key: text.slice(at + n) };
}

/** The stored subject a mutation's node id names, with its type. */
function rowOf(ctx: C, id: unknown): { type: string; row: Row } | undefined {
  const d = decodeId(id);
  if (!d) return undefined;
  // accounts are kept by their login: their numeric id is their own field
  const byId = (stored: string): Row | undefined => ctx.rowsRaw(stored).find((r) => String(stored === 'user' || stored === 'org' ? ctx.own(r).id : r.id) === d.key);
  const stored: Record<string, string> = { Repository: 'repository', PullRequest: 'pull', User: 'user', Organization: 'org', Discussion: 'discussion', DiscussionComment: 'discussion_comment' };
  if (d.type === 'DiscussionCategory') { const c = categoryOf(ctx, d.key); return c ? { type: d.type, row: c } : undefined; }
  const s = stored[d.type];
  const row = s ? byId(s) : undefined;
  return row ? { type: d.type, row } : undefined;
}

/** The subject a mutation's input names, of the types it takes ("Could not resolve to a node with the global id of";
 *  where the documentation stops, GitHub's words). */
function named(ctx: C, id: unknown, ...types: string[]): { type: string; row: Row } {
  const hit = rowOf(ctx, id);
  if (!hit || !types.includes(hit.type)) throw new GraphqlError(`Could not resolve to a node with the global id of '${String(id)}'`, 'NOT_FOUND');
  return hit;
}

const repoOfRow = (ctx: C, row: Row): Row => ctx.rowsRaw('repository').find((r) => r.full_name === row._repo)!;

// ── views ───────────────────────────────────────────────────────────────────────────────────────────

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function repositoryView(r: Row): Row {
  return { __typename: 'Repository', _row: r, id: r.node_id, databaseId: r.id, name: r.name, nameWithOwner: r.full_name, url: r.html_url, isPrivate: r.private === true, description: r.description ?? null, homepageUrl: r.homepage || null, createdAt: r.created_at, updatedAt: r.updated_at, pushedAt: iso(r.pushed_at), isFork: r.fork === true, isArchived: r.archived === true, isTemplate: r.is_template === true, visibility: String(r.visibility ?? (r.private ? 'private' : 'public')).toUpperCase(), stargazerCount: Number(r.stargazers_count ?? 0), forkCount: Number(r.forks_count ?? 0), hasIssuesEnabled: r.has_issues !== false, hasWikiEnabled: r.has_wiki !== false, hasProjectsEnabled: r.has_projects !== false, hasDiscussionsEnabled: r.has_discussions === true, sshUrl: r.ssh_url, mergeCommitAllowed: r.allow_merge_commit !== false, rebaseMergeAllowed: r.allow_rebase_merge !== false, squashMergeAllowed: r.allow_squash_merge !== false, autoMergeAllowed: r.allow_auto_merge === true, deleteBranchOnMerge: r.delete_branch_on_merge === true, };
}

/** A person, a bot or an organization as an Actor (`author`, `owner`). */
function accountView(ctx: C, login: string): Row | null {
  const u = ctx.row('user', login) ?? ctx.row('org', login);
  if (!u) return null;
  const type = ctx.row('org', login) ? 'Organization' : u.type === 'Bot' ? 'Bot' : 'User';
  const a = account(ctx, login);
  return { __typename: type, _row: u, id: a.node_id, databaseId: a.id, login: type === 'Bot' ? login.replace(/\[bot\]$/, '') : login, name: u.name ?? null, email: u.email ?? '', url: a.html_url, avatarUrl: a.avatar_url, bio: u.bio ?? null, company: u.company ?? null, location: u.location ?? null, createdAt: u.created_at ?? null };
}

function pullView(p: Row): Row {
  const head = p.head as Row;
  const base = p.base as Row;
  return {
    __typename: 'PullRequest', _row: p, id: p.node_id, databaseId: p.id, number: p.number, title: p.title, body: p.body ?? '', state: p.merged === true ? 'MERGED' : String(p.state).toUpperCase(),
    isDraft: p.draft === true, url: p.html_url, headRefName: head.ref, baseRefName: base.ref, headRefOid: head.sha, baseRefOid: base.sha, merged: p.merged === true, mergedAt: iso(p.merged_at),
    closedAt: iso(p.closed_at), closed: p.state === 'closed', createdAt: p.created_at, updatedAt: p.updated_at, additions: Number(p.additions ?? 0), deletions: Number(p.deletions ?? 0),
    changedFiles: Number(p.changed_files ?? 0), mergeable: p.state !== 'open' ? 'UNKNOWN' : p.mergeable === false ? 'CONFLICTING' : 'MERGEABLE', locked: p.locked === true,
    isCrossRepository: String(p._head_repo) !== String(p._repo), maintainerCanModify: p.maintainer_can_modify === true, permalink: p.html_url,
  };
}

/** A commit of a repository as a Commit (its status checks rolled up by a resolver). */
function commitView(repo: Row, sha: string, message = '', at: string | null = null): Row {
  return { __typename: 'Commit', _repo: repo.full_name, _repository_id: repo.id, id: nodeId('Commit', sha), oid: sha, abbreviatedOid: sha.slice(0, 7), message, messageHeadline: message.split('\n')[0] ?? '', committedDate: at, url: `https://github.com/${String(repo.full_name)}/commit/${sha}` };
}

/** GitHub's default discussion categories, a repository's once discussions are on; Q&A the one whose discussions take
 *  an answer. */
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "Announcements Updates and news from project maintainers Announcement"
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "General Anything and everything relevant to the project Open-ended discussion"
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "Ideas Ideas to change or improve the project Open-ended discussion"
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "Polls Polls with multiple options for the community to vote for and discuss Polls"
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "Q&A Questions for the community to answer, with a question/answer format Question and Answer"
// source: https://docs.github.com/en/discussions/managing-discussions-for-your-community/managing-categories-for-discussions "Show and tell Creations, experiments, or tests relevant to the project Open-ended discussion"
const CATEGORIES = [
  { name: 'Announcements', slug: 'announcements', emoji: ':mega:', answerable: false },
  { name: 'General', slug: 'general', emoji: ':hash:', answerable: false },
  { name: 'Ideas', slug: 'ideas', emoji: ':bulb:', answerable: false },
  { name: 'Polls', slug: 'polls', emoji: ':ballot_box:', answerable: false },
  { name: 'Q&A', slug: 'q-a', emoji: ':pray:', answerable: true },
  { name: 'Show and tell', slug: 'show-and-tell', emoji: ':raised_hands:', answerable: false },
];

function categoryView(repo: Row, i: number): Row {
  const c = CATEGORIES[i]!;
  const key = `${String(repo.id)}-${i}`;
  return { __typename: 'DiscussionCategory', _repo: repo.full_name, _index: i, id: nodeId('DiscussionCategory', key), name: c.name, slug: c.slug, emoji: c.emoji, isAnswerable: c.answerable, description: null, createdAt: repo.created_at, updatedAt: repo.created_at };
}

/** A category by its key (`<repository id>-<index>`), of a repository whose discussions are on. */
function categoryOf(ctx: C, key: string): Row | undefined {
  const [repoId, index] = key.split('-');
  const repo = ctx.rowsRaw('repository').find((r) => String(r.id) === repoId);
  return repo && repo.has_discussions === true && CATEGORIES[Number(index)] ? categoryView(repo, Number(index)) : undefined;
}

const discussionView = (d: Row): Row => ({ __typename: 'Discussion', _row: d, id: d.node_id, databaseId: d.id, number: d.number, title: d.title, body: d.body, url: d.html_url, createdAt: d.created_at, updatedAt: d.updated_at, answerChosenAt: iso(d.answer_chosen_at), closed: false, locked: false });
const discussionCommentView = (c: Row): Row => ({ __typename: 'DiscussionComment', _row: c, id: c.node_id, databaseId: c.id, body: c.body, url: c.html_url, createdAt: c.created_at, updatedAt: c.updated_at, isAnswer: c.is_answer === true });

// ── reads a view needs ──────────────────────────────────────────────────────────────────────────────

const src = (s: Row): Row => s._row as Row;

/** The latest review decision of each reviewer, and the reviews a ruleset over the base asks for: APPROVED,
 *  CHANGES_REQUESTED or REVIEW_REQUIRED; null when no rule asks for reviews and none decides. */
// source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets "require that all pull requests receive a specific number of approving reviews before someone merges the pull request"
function reviewDecision(ctx: C, p: Row): string | null {
  const latest = new Map<string, string>();
  for (const v of ctx.rowsRaw('review').filter((x) => x._repo === p._repo && x._pull === String(p.number) && (x.state === 'APPROVED' || x.state === 'CHANGES_REQUESTED'))) latest.set(String((v.user as Row).login), String(v.state));
  if ([...latest.values()].includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  const repo = repoOfRow(ctx, p);
  // a ruleset's pull request rule (counting the approvals at the head when a push dismisses the stale ones)
  const ruled = rulesetApprovals(ctx, repo, String((p.base as Row).ref), who(ctx));
  return ruled ? (approvalsOf(ctx, repo, p, ruled.stale).approved >= ruled.count ? 'APPROVED' : 'REVIEW_REQUIRED') : null;
}

/** A commit's check runs (the latest of each App and name) and statuses (the latest of each context), rolled up as
 *  GitHub combines a commit's statuses: FAILURE when one failed, PENDING while one runs, else SUCCESS; null with none. */
// source: https://docs.github.com/en/rest/commits/statuses "failure if any of the contexts report as error or failure"
// source: https://docs.github.com/en/rest/commits/statuses "success if the latest status for all contexts is success"
function rollup(ctx: C, commit: Row): Row | null {
  const runs = new Map<string, Row>();
  for (const r of ctx.rowsRaw('check_run').filter((x) => x._repo === commit._repo && x.head_sha === commit.oid)) runs.set(`${String((r.app as Row).id)}:${String(r.name)}`, r);
  const statuses = new Map<string, Row>();
  for (const s of ctx.rowsRaw('commit_status').filter((x) => x._repo === commit._repo && x._sha === commit.oid)) statuses.set(String(s.context), s);
  if (!runs.size && !statuses.size) return null;
  const contexts: Row[] = [
    ...[...runs.values()].map((r) => ({ __typename: 'CheckRun', id: r.node_id, databaseId: r.id, name: r.name, status: String(r.status).toUpperCase(), conclusion: r.conclusion ? String(r.conclusion).toUpperCase() : null, detailsUrl: r.details_url, startedAt: iso(r.started_at), completedAt: iso(r.completed_at), isRequired: false })),
    ...[...statuses.values()].map((s) => ({ __typename: 'StatusContext', id: s.node_id, context: s.context, state: String(s.state).toUpperCase(), targetUrl: s.target_url ?? null, description: s.description ?? null, createdAt: s.created_at, isRequired: false })),
  ];
  const failed = contexts.some((c) => ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR', 'STARTUP_FAILURE'].includes(String(c.conclusion ?? c.state)));
  const pending = contexts.some((c) => (c.__typename === 'CheckRun' ? c.status !== 'COMPLETED' : c.state === 'PENDING' || c.state === 'EXPECTED'));
  return { __typename: 'StatusCheckRollup', id: nodeId('StatusCheckRollup', String(commit.oid)), state: failed ? 'FAILURE' : pending ? 'PENDING' : 'SUCCESS', contexts, _commit: commit };
}

/** The pull requests of a repository a `pullRequests` connection takes by `states`, `headRefName` and `baseRefName`,
 *  newest last unless ordered DESC by creation (as `gh` finds a pull request by its branch). */
function pullsOf(ctx: C, repo: Row, a: Row): Row[] {
  const states = (a.states as string[] | undefined)?.map((s) => s.toLowerCase());
  const pulls = ctx.rowsRaw('pull').filter((p) => p._repo === repo.full_name
    && (!states || states.includes(p.merged === true ? 'merged' : String(p.state)))
    && (!a.headRefName || (p.head as Row).ref === a.headRefName) && (!a.baseRefName || (p.base as Row).ref === a.baseRefName));
  return ((a.orderBy as Row | undefined)?.direction === 'DESC' ? pulls.reverse() : pulls).map(pullView);
}

// ── mutations' own pieces ───────────────────────────────────────────────────────────────────────────

/** A discussion made in a category of a repository whose discussions are on (createDiscussion); its number the next of
 *  the repository's issues, pull requests and discussions. Where the documentation stops: the words of the refusals
 *  for a repository without discussions and for another repository's category are GitHub's. */
// source: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions "categoryId: ID! The ID of a DiscussionCategory within this repository."
async function createDiscussion(ctx: C, input: Row): Promise<Row> {
  const { row: repo } = named(ctx, input.repositoryId, 'Repository');
  needs(ctx, repo, 'read', 'CreateDiscussion');
  if (repo.has_discussions !== true) throw new GraphqlError('Repository does not have discussions enabled.', 'UNPROCESSABLE');
  const { row: category } = named(ctx, input.categoryId, 'DiscussionCategory');
  if (category._repo !== repo.full_name) throw new GraphqlError('Category does not belong to this repository', 'UNPROCESSABLE');
  const by = actorLogin(caller(ctx));
  const id = mint(ctx, 'discussion');
  const number = nextNumber(ctx, repo);
  const at = nowIso(ctx);
  await ctx.write('discussion', String(id), {
    id, node_id: nodeId('Discussion', id), number, title: String(input.title), body: String(input.body), html_url: `https://github.com/${String(repo.full_name)}/discussions/${number}`,
    user: account(ctx, by), category: { id: category.id, name: category.name, slug: category.slug }, answer_chosen_at: null, answer_chosen_by: null, created_at: at, updated_at: at, comments: 0,
    _repo: repo.full_name, _category: category._index, _answer: null,
  }, 'discussion.created');
  return { discussion: discussionView(ctx.row('discussion', String(id))!) };
}

/** A comment on a discussion, a top-level one unless it replies to another (addDiscussionComment). */
// source: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions "replyToId: ID The node ID of the discussion comment to reply to. If absent, the created comment will be a top-level comment."
async function addDiscussionComment(ctx: C, input: Row): Promise<Row> {
  const { row: d } = named(ctx, input.discussionId, 'Discussion');
  const repo = repoOfRow(ctx, d);
  needs(ctx, repo, 'read', 'AddDiscussionComment');
  const reply = input.replyToId ? named(ctx, input.replyToId, 'DiscussionComment').row : undefined;
  const by = actorLogin(caller(ctx));
  const id = mint(ctx, 'discussion-comment');
  const at = nowIso(ctx);
  await ctx.write('discussion_comment', String(id), {
    id, node_id: nodeId('DiscussionComment', id), body: String(input.body), html_url: `${String(d.html_url)}#discussioncomment-${id}`, user: account(ctx, by), created_at: at, updated_at: at,
    is_answer: false, parent_id: reply ? reply.id : null, _discussion: String(d.id), _repo: d._repo,
  }, 'discussion_comment.created');
  await ctx.write('discussion', String(d.id), { comments: Number(d.comments ?? 0) + 1, updated_at: at }, 'discussion.commented');
  return { comment: discussionCommentView(ctx.row('discussion_comment', String(id))!) };
}

// ── the resolvers ───────────────────────────────────────────────────────────────────────────────────

const resolvers: GraphqlPart<C>['resolvers'] = {
  // Where the documentation stops: the words of a repository not found are GitHub's
  'Query.repository': (_s, a, ctx) => {
    const r = repoNamed(ctx, String(a.owner), String(a.name));
    if (!r || !roleIn(ctx, r, who(ctx))) throw new GraphqlError(`Could not resolve to a Repository with the name '${String(a.owner)}/${String(a.name)}'.`, 'NOT_FOUND');
    return repositoryView(r);
  },

  'Repository.owner': (s, _a, ctx) => accountView(ctx, ownerOf(src(s))),
  'Repository.defaultBranchRef': (s, _a, ctx) => {
    const r = src(s);
    const name = String(r.default_branch ?? 'main');
    const sha = ctx.git(`r${String(r.id)}`).refs.get(`refs/heads/${name}`);
    return sha ? { __typename: 'Ref', id: nodeId('Ref', `${String(r.id)}:${name}`), name, prefix: 'refs/heads/', target: commitView(r, sha) } : null;
  },
  'Repository.viewerPermission': (s, _a, ctx) => { const role = roleIn(ctx, src(s), who(ctx)); return role ? role.toUpperCase() : null; },
  'Repository.pullRequests': (s, a, ctx) => pullsOf(ctx, src(s), a),
  'Repository.parent': (s, _a, ctx) => { const parent = src(s).parent as Row | undefined; const r = parent ? ctx.rowsRaw('repository').find((x) => x.full_name === parent.full_name) : undefined; return r ? repositoryView(r) : null; },
  'Repository.discussionCategories': (s) => { const r = src(s); return r.has_discussions === true ? CATEGORIES.map((_, i) => categoryView(r, i)) : []; },
  // source: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions "List the discussions within a repository. If categoryId is specified, only results within that category will be returned."
  // source: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions "orderBy : DiscussionOrder = { field : UPDATED_AT, direction : DESC }"
  'Repository.discussions': (s, a, ctx) => {
    const r = src(s);
    const order = (a.orderBy as Row | undefined) ?? { field: 'UPDATED_AT', direction: 'DESC' };
    const key = order.field === 'UPDATED_AT' ? 'updated_at' : 'created_at';
    const all = ctx.rowsRaw('discussion').filter((d) => d._repo === r.full_name && (a.categoryId == null || categoryView(r, Number(d._category)).id === a.categoryId))
      .sort((x, y) => String(x[key]).localeCompare(String(y[key])) || Number(x.number) - Number(y.number));
    return (order.direction === 'ASC' ? all : all.reverse()).map(discussionView);
  },
  // source: https://docs.github.com/en/graphql/guides/using-the-graphql-api-for-discussions "Get a discussion. Returns null if discussion with the specified ID does not exist."
  'Repository.discussion': (s, a, ctx) => {
    const d = ctx.rowsRaw('discussion').find((x) => x._repo === src(s).full_name && String(x.number) === String(a.number));
    return d ? discussionView(d) : null;
  },

  'PullRequest.reviewDecision': (s, _a, ctx) => reviewDecision(ctx, src(s)),
  'PullRequest.headRepositoryOwner': (s, _a, ctx) => { const r = ctx.rowsRaw('repository').find((x) => x.full_name === src(s)._head_repo); return r ? accountView(ctx, ownerOf(r)) : null; },
  'PullRequest.mergeStateStatus': (s, _a, ctx) => {
    // the MergeStateStatus enum: BEHIND, BLOCKED, CLEAN, DIRTY, DRAFT, HAS_HOOKS, UNKNOWN, UNSTABLE (the schema, spec/schema.graphql.gz)
    const p = src(s);
    if (p.state !== 'open') return 'UNKNOWN';
    if (p.draft === true) return 'DRAFT';
    if (p.mergeable === false) return 'DIRTY';
    const repo = repoOfRow(ctx, p);
    const c = who(ctx);
    if (protectionRefusal(ctx, repo, p, c && c.kind === 'user' ? c.login : '')) return 'BLOCKED';
    const checks = rollup(ctx, commitView(repo, String((p.head as Row).sha)));
    return checks && checks.state !== 'SUCCESS' ? 'UNSTABLE' : 'CLEAN';
  },
  'PullRequest.commits': async (s, _a, ctx) => {
    const p = src(s);
    const repo = repoOfRow(ctx, p);
    const head = String((p.head as Row).sha);
    const base = String((p.base as Row).sha);
    const store = ctx.git(`r${String(repo.id)}`).store;
    const out: Row[] = [];
    let at: string | undefined = head;
    const seen = new Set<string>();
    while (at && at !== base && !seen.has(at) && out.length < 250) {
      seen.add(at);
      // a fork's head commits are in the fork's store, not the base's: the walk stops where the base's store does
      const raw = await store.read(at);
      if (!raw || raw.type !== 'commit') break;
      const c = git.decodeCommit(raw.payload);
      out.unshift({ __typename: 'PullRequestCommit', id: nodeId('PullRequestCommit', `${String(p.id)}:${at}`), url: `${String(p.html_url)}/commits/${at}`, commit: commitView(repo, at, c.message.replace(/\n$/, ''), new Date(c.committer.time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')) });
      at = c.parents[0];
    }
    return out;
  },
  'Commit.statusCheckRollup': (s, _a, ctx) => rollup(ctx, s),
  'StatusCheckRollup.contexts': (s) => s.contexts as Row[],
  // a check run made by an App other than GitHub Actions belongs to no workflow run
  'CheckRun.checkSuite': (s) => (s.checkSuite as Row | undefined) ?? null,

  'Discussion.author': (s, _a, ctx) => accountView(ctx, String((src(s).user as Row).login)),
  'Discussion.comments': (s, _a, ctx) => ctx.rowsRaw('discussion_comment').filter((c) => c._discussion === String(src(s).id) && c.parent_id == null).map(discussionCommentView),
  'DiscussionComment.author': (s, _a, ctx) => accountView(ctx, String((src(s).user as Row).login)),

  // mutations: each through the helper its REST twin uses
  'Mutation.createPullRequest': async (_s, a, ctx) => {
    const input = a.input as Row;
    const { row: repo } = named(ctx, input.repositoryId, 'Repository');
    needs(ctx, repo, 'read', 'CreatePullRequest');
    const head = input.headRepositoryId ? `${ownerOf(named(ctx, input.headRepositoryId, 'Repository').row)}:${String(input.headRefName)}` : String(input.headRefName);
    const p = await settle(await openPull(ctx, repo, caller(ctx), { title: String(input.title), head, base: String(input.baseRefName), body: typeof input.body === 'string' ? input.body : null, draft: input.draft === true }));
    return { pullRequest: pullView(ctx.row('pull', String(p.id))!) };
  },
  'Mutation.mergePullRequest': async (_s, a, ctx) => {
    const input = a.input as Row;
    const { row: p } = named(ctx, input.pullRequestId, 'PullRequest');
    const repo = repoOfRow(ctx, p);
    needs(ctx, repo, 'write', 'MergePullRequest');
    const c = caller(ctx);
    await settle(await mergePull(ctx, repo, p, actorLogin(c), {
      merge_method: String(input.mergeMethod ?? 'MERGE').toLowerCase(), ...(typeof input.commitHeadline === 'string' ? { commit_title: input.commitHeadline } : {}),
      ...(typeof input.commitBody === 'string' ? { commit_message: input.commitBody } : {}), ...(typeof input.expectedHeadOid === 'string' ? { sha: input.expectedHeadOid } : {}),
    }));
    return { pullRequest: pullView(ctx.row('pull', String(p.id))!), actor: accountView(ctx, actorLogin(c)) };
  },
  // a repository of the caller, or of an organization they may create repositories in (as REST's create in an org)
  'Mutation.createRepository': async (_s, a, ctx) => {
    const input = a.input as Row;
    const c = caller(ctx);
    const owner = input.ownerId ? named(ctx, input.ownerId, 'User', 'Organization') : { type: 'User', row: ctx.row('user', actorLogin(c))! };
    const login = String(owner.row.login);
    if (owner.type === 'Organization') {
      const m = c.kind === 'user' ? membershipOf(ctx, login, c.login) : undefined;
      if (m?.state !== 'active' || (m.role !== 'admin' && m._can_create_repositories !== true)) throw new GraphqlError(`${actorLogin(c)} does not have the correct permissions to execute \`CreateRepository\``, 'FORBIDDEN');
    } else if (c.kind !== 'user' || c.login !== login) throw new GraphqlError(`${actorLogin(c)} does not have the correct permissions to execute \`CreateRepository\``, 'FORBIDDEN');
    const made = await settle(await makeRepo(ctx, login, c, {
      name: typeof input.name === 'string' ? input.name : undefined, private: String(input.visibility ?? 'PRIVATE') !== 'PUBLIC', description: typeof input.description === 'string' ? input.description : null,
      homepage: typeof input.homepageUrl === 'string' ? input.homepageUrl : null, has_issues: input.hasIssuesEnabled !== false, has_wiki: input.hasWikiEnabled !== false,
    }));
    return { clientMutationId: input.clientMutationId ?? null, repository: repositoryView(made) };
  },
  'Mutation.createDiscussion': (_s, a, ctx) => createDiscussion(ctx, a.input as Row),
  'Mutation.addDiscussionComment': (_s, a, ctx) => addDiscussionComment(ctx, a.input as Row),
};

// the fields each view holds as they are (the kernel's default resolver reads them)
const stored: Record<string, string[]> = {
  Repository: ['id', 'databaseId', 'name', 'nameWithOwner', 'url', 'isPrivate', 'description', 'homepageUrl', 'createdAt', 'updatedAt', 'pushedAt', 'isFork', 'isArchived', 'isTemplate', 'visibility', 'stargazerCount', 'forkCount', 'hasIssuesEnabled', 'hasWikiEnabled', 'hasProjectsEnabled', 'hasDiscussionsEnabled', 'sshUrl', 'mergeCommitAllowed', 'rebaseMergeAllowed', 'squashMergeAllowed', 'autoMergeAllowed', 'deleteBranchOnMerge'],
  User: ['id', 'databaseId', 'login', 'name', 'email', 'url', 'avatarUrl', 'bio', 'company', 'location', 'createdAt'],
  Bot: ['id', 'databaseId', 'login', 'url', 'avatarUrl', 'createdAt'],
  Organization: ['id', 'databaseId', 'login', 'name', 'email', 'url', 'avatarUrl', 'location', 'createdAt'],
  PullRequest: ['id', 'databaseId', 'number', 'title', 'body', 'state', 'isDraft', 'url', 'headRefName', 'baseRefName', 'headRefOid', 'baseRefOid', 'merged', 'mergedAt', 'closedAt', 'closed', 'createdAt', 'updatedAt', 'additions', 'deletions', 'changedFiles', 'mergeable', 'locked', 'isCrossRepository', 'maintainerCanModify', 'permalink'],
  PullRequestCommit: ['id', 'url', 'commit'],
  Commit: ['id', 'oid', 'abbreviatedOid', 'message', 'messageHeadline', 'committedDate', 'url'],
  Ref: ['id', 'name', 'prefix', 'target'],
  StatusCheckRollup: ['id', 'state'],
  CheckRun: ['id', 'databaseId', 'name', 'status', 'conclusion', 'detailsUrl', 'startedAt', 'completedAt', 'isRequired'],
  StatusContext: ['id', 'context', 'state', 'targetUrl', 'description', 'createdAt', 'isRequired'],
  // a check run's suite and its workflow run, which a check run an App reports has none of (CheckRun.checkSuite answers null)
  CheckSuite: ['id', 'workflowRun'],
  WorkflowRun: ['id', 'workflow'],
  Workflow: ['id', 'name'],
  Discussion: ['id', 'databaseId', 'number', 'title', 'body', 'url', 'createdAt', 'updatedAt', 'answerChosenAt', 'closed', 'locked'],
  DiscussionComment: ['id', 'databaseId', 'body', 'url', 'createdAt', 'updatedAt', 'isAnswer'],
  DiscussionCategory: ['id', 'name', 'slug', 'emoji', 'isAnswerable', 'description', 'createdAt', 'updatedAt'],
  CreatePullRequestPayload: ['clientMutationId', 'pullRequest'],
  MergePullRequestPayload: ['clientMutationId', 'pullRequest', 'actor'],
  CreateRepositoryPayload: ['clientMutationId', 'repository'],
  CreateDiscussionPayload: ['clientMutationId', 'discussion'],
  AddDiscussionCommentPayload: ['clientMutationId', 'comment'],
};

export const graphql: GraphqlPart<C> = { resolvers, stored };
