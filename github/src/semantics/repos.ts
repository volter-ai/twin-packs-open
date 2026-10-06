// GitHub's repos operations (https://docs.github.com/en/rest/repos): a repository read with the caller's permissions
// and edited, its branches, contents (a file read and committed, the README read as it is or rendered) and commits,
// releases and their assets. Statuses, hooks, deploy keys, rulesets and environments are in repos-ops.ts. A repository
// is made through REST or GraphQL (shared.ts makeRepo), as the SDK and `gh repo create` make one.
import { git, type HandlerContext } from '@volter/world-core';
import { renderReadme } from '../engine/markdown.ts';
import { nodeId, permissionsOf } from '../engine/objects.ts';
import { account, actorLogin, bodyOf, commitFiles, commitsBetween, editRepo, fail, filesAt, gitOf, hasScope, invalid, json, makeRepo, membershipOf, mint, notFound, nowIso, page, pushed, repoOfPath, roleIn, type Row, rulesOn, shown, str, tipOf, who } from './shared.ts';

/** A repository as GitHub answers it: the stored one, with the caller's permissions. */
const answer = (ctx: HandlerContext, repo: Row): Row => ({ ...shown(ctx, repo), permissions: permissionsOf(roleIn(ctx, repo, who(ctx))) });

// source: spec:/components/schemas/repository "A repository on GitHub."
const repositoryListAnswer = (ctx: HandlerContext, repo: Row): Row => {
  const { organization: _organization, ...listed } = answer(ctx, repo);
  return listed;
};
// source: spec:/components/schemas/minimal-repository "Minimal Repository"
const organizationListAnswer = (ctx: HandlerContext, repo: Row): Row => {
  const { allow_squash_merge: _squash, allow_merge_commit: _merge, allow_rebase_merge: _rebase, allow_auto_merge: _auto,
    allow_update_branch: _update, use_squash_pr_title_as_default: _title, squash_merge_commit_title: _squashTitle,
    squash_merge_commit_message: _squashMessage, merge_commit_title: _mergeTitle, merge_commit_message: _mergeMessage,
    organization: _organization, ...listed } = answer(ctx, repo);
  return listed;
};

/** A repository belonging to the signed-in person, through the REST SDK's creation door. */
// source: spec:repos/create-for-authenticated-user "Creates a new repository for the authenticated user."
// source: spec:repos/create-for-authenticated-user "scope to create a public repository"
// source: spec:repos/create-for-authenticated-user "scope to create a private repository."
export async function repos_create_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const caller = who(ctx);
  if (!caller) return fail(ctx, 401, 'Requires authentication');
  // Where the documentation stops: use GitHub's documented permission-refusal envelope.
  if (caller.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  const body = bodyOf(ctx);
  const privateRepo = body.private === true || body.visibility === 'private';
  if (!hasScope(caller, privateRepo ? 'repo' : 'public_repo')) return fail(ctx, 403, 'Resource not accessible by integration');
  const made = await makeRepo(ctx, caller.login, caller, {
    name: str(body.name), private: privateRepo, description: str(body.description) ?? null, homepage: str(body.homepage) ?? null,
    has_issues: body.has_issues, has_projects: body.has_projects, has_wiki: body.has_wiki, has_discussions: body.has_discussions,
    license: str(body.license_template), auto_init: body.auto_init === true,
  });
  return made instanceof Response ? made : json(answer(ctx, made), 201);
}

/** repos/create-in-org: a repository of an organization, by a member who may create one there (an owner, or a member
 *  the organization lets create repositories); its README and license committed when asked (201). */
// source: https://docs.github.com/en/rest/repos/repos "Creates a new repository in the specified organization. The authenticated user must be a member of the organization."
// Where the documentation stops: a member the organization does not let create repositories is refused in GitHub's words
export async function repos_create_in_org(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  if (!ctx.row('org', org)) return notFound(ctx);
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  const m = c.kind === 'user' ? membershipOf(ctx, org, c.login) : undefined;
  if (c.kind === 'user' && (m?.state !== 'active' || (m.role !== 'admin' && m._can_create_repositories !== true))) return fail(ctx, 403, 'You need admin access to the organization before adding a repository to it.');
  const b = bodyOf(ctx);
  const made = await makeRepo(ctx, org, c, {
    name: str(b.name), private: b.private === true || b.visibility === 'private', description: str(b.description) ?? null, homepage: str(b.homepage) ?? null,
    has_issues: b.has_issues, has_projects: b.has_projects, has_wiki: b.has_wiki, has_discussions: b.has_discussions, license: str(b.license_template), auto_init: b.auto_init === true,
  });
  return made instanceof Response ? made : json(answer(ctx, made), 201);
}

/** The repositories a person has a role in of their own: their own, their organizations' (as a member), those a team of
 *  theirs reaches. */
function ownedOrJoined(ctx: HandlerContext, login: string, r: Row): boolean {
  const owner = String((r.owner as Row).login);
  if (owner === login || membershipOf(ctx, owner, login)?.state === 'active') return true;
  return ctx.rowsRaw('team_repo').some((tr) => tr._repository_id === String(r.id) && ctx.row('team_member', `${String(tr._team)}::${login}`)?.state === 'active');
}

/** repos/list-for-authenticated-user: the repositories the caller has explicit permission to, each with its permissions,
 *  sorted by full name unless asked otherwise. */
// source: https://docs.github.com/en/rest/repos/repos "The authenticated user has explicit permission to access repositories they own, repositories where they are a collaborator, and repositories that they can access through an organization membership."
// source: https://docs.github.com/en/rest/repos/repos "Default : full_name"
export async function repos_list_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (c.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  const visibility = str(ctx.params.visibility) ?? 'all';
  const all = ctx.rowsRaw('repository').filter((r) => ownedOrJoined(ctx, c.login, r) && (visibility === 'all' || (visibility === 'private') === (r.private === true)));
  all.sort((a, b) => (str(ctx.params.sort) === 'created' ? String(b.created_at).localeCompare(String(a.created_at)) : String(a.full_name).localeCompare(String(b.full_name))));
  return json(page(ctx, all).map((r) => repositoryListAnswer(ctx, r)));
}

/** repos/list-for-org: an organization's repositories the caller can see (its public ones to anyone, its private ones to
 *  those with a role there), by `type`. */
// source: https://docs.github.com/en/rest/repos/repos "Lists repositories for the specified organization."
// source: https://docs.github.com/en/rest/repos/repos "Can be one of : all , public , private , forks , sources , member"
export async function repos_list_for_org(ctx: HandlerContext): Promise<Response> {
  const org = String(ctx.call.params.org ?? '');
  if (!ctx.row('org', org)) return notFound(ctx);
  const type = str(ctx.params.type) ?? 'all';
  const c = who(ctx);
  const all = ctx.rowsRaw('repository').filter((r) => String((r.owner as Row).login) === org && roleIn(ctx, r, c) !== undefined
    && (type === 'all' || (type === 'private' ? r.private === true : type === 'public' ? r.private !== true : type === 'forks' ? r.fork === true : type === 'sources' ? r.fork !== true : true)));
  all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return json(page(ctx, all).map((r) => organizationListAnswer(ctx, r)));
}

/** repos/get: the repository with the caller's permissions. */
export async function repos_get(ctx: HandlerContext): Promise<Response> {
  return json(answer(ctx, repoOfPath(ctx)));
}

/** repos/update: its name (a rename moves its children with it), description, homepage, visibility, features, default
 *  branch and merge settings, by an admin. */
export async function repos_update(ctx: HandlerContext): Promise<Response> {
  const next = await editRepo(ctx, repoOfPath(ctx), bodyOf(ctx));
  return next instanceof Response ? next : json(answer(ctx, next));
}


// ── branches (https://docs.github.com/en/rest/branches) ─────────────────────────────────────────────

/** repos/get-branch: its tip commit, and its branch protection (the World's repositories hold none: their rules are
 *  rulesets, which a branch's answer does not carry). */
// Where the documentation stops: "Branch not found" are GitHub's words for a branch the repository does not have
export async function repos_get_branch(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const branch = String(ctx.call.params.branch ?? '');
  const sha = tipOf(ctx, repo, branch);
  if (!sha) return fail(ctx, 404, 'Branch not found');
  const full = String(repo.full_name);
  return json({
    name: branch, commit: await commitAnswer(ctx, repo, sha), _links: { self: `https://api.github.com/repos/${full}/branches/${branch}`, html: `https://github.com/${full}/tree/${branch}` },
    protected: false, protection: { enabled: false, required_status_checks: { enforcement_level: 'off', contexts: [], checks: [] } },
    protection_url: `https://api.github.com/repos/${full}/branches/${branch}/protection`,
  });
}

// ── contents and commits ─────────────────────────────────────────────────────────────────────────────

/** A commit as the REST API answers it, without files. */
async function commitAnswer(ctx: HandlerContext, repo: Row, sha: string): Promise<Row | undefined> {
  const raw = await gitOf(ctx, repo).store.read(sha);
  if (!raw || raw.type !== 'commit') return undefined;
  const c = git.decodeCommit(raw.payload);
  const full = String(repo.full_name);
  const person = (i: { name: string; email: string; time: number }): Row => ({ name: i.name, email: i.email, date: new Date(i.time * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') });
  const user = (email: string, name: string): Row | null => { const u = ctx.rowsRaw('user').find((x) => x.email === email || x.login === name); return u ? account(ctx, String(u.login)) : null; };
  return {
    sha, node_id: nodeId('Commit', sha), url: `https://api.github.com/repos/${full}/commits/${sha}`, html_url: `https://github.com/${full}/commit/${sha}`, comments_url: `https://api.github.com/repos/${full}/commits/${sha}/comments`,
    commit: { author: person(c.author), committer: person(c.committer), message: c.message.replace(/\n$/, ''), tree: { sha: c.tree, url: `https://api.github.com/repos/${full}/git/trees/${c.tree}` }, url: `https://api.github.com/repos/${full}/git/commits/${sha}`, comment_count: 0, verification: { verified: false, reason: 'unsigned', signature: null, payload: null, verified_at: null } },
    author: user(c.author.email, c.author.name), committer: user(c.committer.email, c.committer.name),
    parents: c.parents.map((p) => ({ sha: p, url: `https://api.github.com/repos/${full}/commits/${p}`, html_url: `https://github.com/${full}/commit/${p}` })),
  };
}

/** A ref a path names — a branch, a tag, a full ref or a commit — as its commit. */
// source: https://docs.github.com/en/rest/commits/commits "The commit reference. Can be a commit SHA, branch name ( heads/BRANCH_NAME ), or tag name ( tags/TAG_NAME )."
async function commitOf(ctx: HandlerContext, repo: Row, ref: string): Promise<string | undefined> {
  const { refs, store } = gitOf(ctx, repo);
  const named = refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}`) ?? refs.get(ref);
  if (named) { const o = await store.read(named); return o?.type === 'tag' ? git.decodeTag(o.payload).object : named; }
  if (/^[0-9a-f]{40}$/.test(ref)) return (await store.has(ref)) ? ref : undefined;
  // an abbreviated sha (GitHub takes one, as git does): the one commit reachable from the repository's refs it begins
  if (!/^[0-9a-f]{4,39}$/i.test(ref)) return undefined;
  const prefix = ref.toLowerCase();
  const seen = new Set<string>();
  const queue = refs.list().map((r) => r.sha);
  const found = new Set<string>();
  while (queue.length && seen.size < 5000) {
    const sha = queue.shift()!;
    if (seen.has(sha)) continue;
    seen.add(sha);
    const o = await store.read(sha);
    if (o?.type === 'tag') { queue.push(git.decodeTag(o.payload).object); continue; }
    if (o?.type !== 'commit') continue;
    if (sha.startsWith(prefix)) found.add(sha);
    queue.push(...git.decodeCommit(o.payload).parents);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** The files changed between two commits, as GitHub lists them. */
async function fileChanges(ctx: HandlerContext, repo: Row, from: string | undefined, to: string): Promise<Row[]> {
  const { store } = gitOf(ctx, repo);
  const full = String(repo.full_name);
  let files: git.DiffFile[] = [];
  if (from) files = (await git.diffFiles(store, from, to, { patch: true })) ?? [];
  else for (const ch of await git.diffTrees(store, null, git.decodeCommit((await store.read(to))!.payload).tree)) {
    const text = new TextDecoder().decode((await store.read(ch.newSha!))?.payload ?? new Uint8Array());
    files.push({ filename: ch.path, status: 'added', additions: text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0, deletions: 0, sha: ch.newSha, patch: git.unifiedPatch('', text) });
  }
  return files.map((f) => ({
    sha: f.sha ?? null, filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.additions + f.deletions,
    blob_url: `https://github.com/${full}/blob/${to}/${f.filename}`, raw_url: `https://github.com/${full}/raw/${to}/${f.filename}`,
    contents_url: `https://api.github.com/repos/${full}/contents/${f.filename}?ref=${to}`, ...(f.patch ? { patch: f.patch } : {}),
  }));
}

/** repos/get-content: a file (base64) at a ref, or a directory's entries. */
// source: https://docs.github.com/en/rest/repos/contents "The name of the commit/branch/tag. Default: the repository’s default branch."
// Where the documentation stops: "No commit found for the ref" are GitHub's words for a ref the repository does not have
export async function repos_get_content(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const ref = str(ctx.params.ref) ?? String(repo.default_branch ?? 'main');
  const sha = await commitOf(ctx, repo, ref);
  if (!sha) return fail(ctx, 404, `No commit found for the ref ${ref}`);
  const path = String(ctx.call.params.path ?? '').replace(/^\/+|\/+$/g, '');
  const files = await filesAt(ctx, repo, sha);
  const full = String(repo.full_name);
  const store = gitOf(ctx, repo).store;
  const accept = ctx.call.request.headers.get('accept') ?? '';
  const object = /application\/vnd\.github(?:\.v3)?\.object/.test(accept);
  const links = (p: string, blob: string, type: string): Row => ({ url: `https://api.github.com/repos/${full}/contents/${p}?ref=${ref}`, html_url: `https://github.com/${full}/${type === 'dir' ? 'tree' : 'blob'}/${ref}/${p}`, git_url: `https://api.github.com/repos/${full}/git/${type === 'dir' ? 'trees' : 'blobs'}/${blob}`, download_url: type === 'dir' ? null : `https://raw.githubusercontent.com/${full}/${ref}/${p}` });
  const f = files.get(path);
  if (f) {
    const l = links(path, f.sha, 'file');
    // source: https://docs.github.com/en/rest/repos/contents "If the content is a submodule, the submodule_git_url field identifies the location of the submodule repository"
    if (f.mode === '160000') {
      const config = files.get('.gitmodules');
      const source = config ? new TextDecoder().decode((await store.read(config.sha))!.payload) : '';
      const url = git.parseSubmodules(source).find((module) => module.path === path)?.url ?? '';
      const hosted = /^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
      // source: https://docs.github.com/en/rest/repos/contents "If the submodule repository is not hosted on github.com, the Git URLs"
      const remote = hosted ? { html_url: `https://github.com/${hosted[1]}/tree/${f.sha}`, git_url: `https://api.github.com/repos/${hosted[1]}/git/trees/${f.sha}` } : { html_url: null, git_url: null };
      return json({ type: 'submodule', size: 0, name: path.split('/').pop(), path, sha: f.sha, ...l, ...remote, download_url: null, submodule_git_url: url, _links: { self: l.url, git: remote.git_url, html: remote.html_url } });
    }
    let bytes = (await store.read(f.sha))!.payload;
    let blob = f.sha;
    // source: https://docs.github.com/en/rest/repos/contents "If the content is a symlink and the symlink's target is a normal file in the repository, then the API responds with the content of the file."
    if (f.mode === '120000') {
      const target = new TextDecoder().decode(bytes);
      const resolved = git.symlinkPath(path, target);
      const linked = resolved === undefined ? undefined : files.get(resolved);
      if (linked && (linked.mode === '100644' || linked.mode === '100755')) { bytes = (await store.read(linked.sha))!.payload; blob = linked.sha; }
      // source: https://docs.github.com/en/rest/repos/contents "Otherwise, the API responds with an object describing the symlink itself."
      else return json({ type: 'symlink', size: bytes.length, name: path.split('/').pop(), path, sha: f.sha, target, ...l, _links: { self: l.url, git: l.git_url, html: l.html_url } });
    }
    // source: https://docs.github.com/en/rest/repos/contents "application/vnd.github.raw+json : Returns the raw file contents for files and symlinks."
    if (/application\/vnd\.github(?:\.v3)?\.raw/.test(accept)) return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' } });
    // source: https://docs.github.com/en/rest/repos/contents "when using the object media type, the content field will be an empty"
    const large = object && bytes.length > 1024 * 1024;
    const shownLinks = links(path, blob, 'file');
    return json({ type: 'file', encoding: large ? 'none' : 'base64', size: bytes.length, name: path.split('/').pop(), path, content: large ? '' : base64Of(bytes), sha: blob, ...shownLinks, _links: { self: shownLinks.url, git: shownLinks.git_url, html: shownLinks.html_url } });
  }
  const prefix = path ? `${path}/` : '';
  const names = new Map<string, { type: 'file' | 'dir'; sha: string; size: number }>();
  const commit = git.decodeCommit((await store.read(sha))!.payload);
  let tree = commit.tree;
  for (const component of path.split('/').filter(Boolean)) {
    const entry = git.decodeTree((await store.read(tree))!.payload).find((entry) => entry.name === component);
    if (!entry || !['40000', '040000'].includes(entry.mode)) return notFound(ctx);
    tree = entry.sha;
  }
  for (const entry of git.decodeTree((await store.read(tree))!.payload)) {
    const dir = ['40000', '040000'].includes(entry.mode);
    names.set(entry.name, { type: dir ? 'dir' : 'file', sha: entry.sha, size: dir || entry.mode === '160000' ? 0 : (await store.read(entry.sha))!.payload.length });
  }
  const entries = [...names].sort(([a], [b]) => a.localeCompare(b)).map(([name, entry]) => { const l = links(`${prefix}${name}`, entry.sha, entry.type); return { type: entry.type, name, path: `${prefix}${name}`, sha: entry.sha, size: entry.size, ...l, _links: { self: l.url, git: l.git_url, html: l.html_url } }; });
  // source: https://docs.github.com/en/rest/repos/contents "the response will be an object with an entries attribute containing the array of objects."
  // source: spec:/components/examples/content-file-response-if-content-is-a-directory-object "https://raw.githubusercontent.com/octocat/octorepo/main/src"
  if (object) { const l: Row = { ...links(path, tree, 'dir'), download_url: `https://raw.githubusercontent.com/${full}/${ref}/${path}` }; return json({ type: 'dir', size: 0, name: path.split('/').pop() || '', path, sha: tree, ...l, _links: { self: l.url, git: l.git_url, html: l.html_url }, entries }); }
  return json(entries);
}

/** A file's bytes as base64, wrapped as the contents API wraps them (sixty characters a line). */
const base64Of = (bytes: Uint8Array): string => { let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin).replace(/(.{60})/g, '$1\n'); };

/** The README GitHub shows for a repository at a commit: README with any extension and in any case, in .github/, then
 *  the root, then docs/. */
// source: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes "If you put your README file in your repository's hidden .github , root, or docs directory, GitHub will recognize and automatically surface your README to repository visitors."
function readmeIn(files: Map<string, { mode: string; sha: string }>, dir = ''): string | undefined {
  for (const where of dir ? [dir] : ['.github/', '', 'docs/']) {
    const hit = [...files.keys()].filter((p) => p.startsWith(where) && !p.slice(where.length).includes('/') && /^readme(\.[^/]*)?$/i.test(p.slice(where.length))).sort()[0];
    if (hit) return hit;
  }
  return undefined;
}

/** repos/get-readme: the repository's README at a ref (the default branch unless named) — as a file (base64), its raw
 *  bytes, or rendered as GitHub renders it ("application/vnd.github.raw+json", "application/vnd.github.html+json"); a
 *  repository without one, 404. */
// source: https://docs.github.com/en/rest/repos/contents "Gets the preferred README for a repository."
// source: https://docs.github.com/en/rest/repos/contents "application/vnd.github.html+json : Returns the README in HTML. Markup languages are rendered to HTML using GitHub's open-source Markup library ."
export async function repos_get_readme(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const ref = str(ctx.params.ref) ?? String(repo.default_branch ?? 'main');
  const sha = await commitOf(ctx, repo, ref);
  if (!sha) return fail(ctx, 404, `No commit found for the ref ${ref}`);
  const files = await filesAt(ctx, repo, sha);
  const path = readmeIn(files);
  if (!path) return notFound(ctx);
  const f = files.get(path)!;
  const bytes = (await gitOf(ctx, repo).store.read(f.sha))!.payload;
  const accept = ctx.call.request.headers.get('accept') ?? '';
  if (/application\/vnd\.github(\.v3)?\.raw/.test(accept)) return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'application/vnd.github.raw; charset=utf-8' } });
  if (/application\/vnd\.github(\.v3)?\.html/.test(accept)) {
    const camo = (url: string): string => `https://camo.githubusercontent.com/${ctx.crypto.digest('sha256', new TextEncoder().encode(url), 'hex')}/${[...new TextEncoder().encode(url)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    return new Response(renderReadme(new TextDecoder().decode(bytes), path, camo), { status: 200, headers: { 'content-type': 'application/vnd.github.html; charset=utf-8' } });
  }
  const full = String(repo.full_name);
  const l = { url: `https://api.github.com/repos/${full}/contents/${path}?ref=${ref}`, html_url: `https://github.com/${full}/blob/${ref}/${path}`, git_url: `https://api.github.com/repos/${full}/git/blobs/${f.sha}`, download_url: `https://raw.githubusercontent.com/${full}/${ref}/${path}` };
  return json({ type: 'file', encoding: 'base64', size: bytes.length, name: path.split('/').pop(), path, content: base64Of(bytes), sha: f.sha, ...l, _links: { self: l.url, git: l.git_url, html: l.html_url } });
}

/** repos/create-or-update-file-contents: a file committed to a branch (the default unless named) — made (201), or
 *  replaced (200) when the request names the blob it replaces: without it 422, with another 409. A branch the
 *  repository lacks, 404; a branch a ruleset closes to pushes, refused as a push is. The commit is the caller's unless an
 *  author and committer are named. Where the documentation stops: the refusals' words are GitHub's. */
// source: https://docs.github.com/en/rest/repos/contents "Creates a new file or replaces an existing file in a repository."
// source: https://docs.github.com/en/rest/repos/contents "Required if you are updating a file . The blob SHA of the file being replaced."
// source: https://docs.github.com/en/rest/repos/contents "The new file content, using Base64 encoding."
export async function repos_create_or_update_file_contents(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const path = String(ctx.call.params.path ?? '').replace(/^\/+|\/+$/g, '');
  const message = str(b.message);
  if (!message) return invalid('Commit', 'message', 'missing_field');
  if (typeof b.content !== 'string') return invalid('Commit', 'content', 'missing_field');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(b.content.replace(/\s/g, '')), (ch) => ch.charCodeAt(0)); } catch { return invalid('Commit', 'content', 'invalid'); }
  const branch = str(b.branch) ?? String(repo.default_branch ?? 'main');
  const tip = tipOf(ctx, repo, branch);
  if (!tip && gitOf(ctx, repo).refs.list().some((r) => r.name.startsWith('refs/heads/'))) return fail(ctx, 404, `Branch ${branch} not found`);
  const held = tip ? (await filesAt(ctx, repo, tip)).get(path) : undefined;
  if (held && !str(b.sha)) return fail(ctx, 422, 'Invalid request.\n\n"sha" wasn\'t supplied.');
  if (held && b.sha !== held.sha) return fail(ctx, 409, `${path} does not match ${String(b.sha)}`);
  const c = who(ctx)!;
  if (tip && rulesOn(ctx, repo, `refs/heads/${branch}`, c).some((r) => r.type === 'pull_request' || r.type === 'update')) return fail(ctx, 409, 'Repository rule violations found\n\nChanges must be made through a pull request.');
  const by = actorLogin(c);
  const u = ctx.row('user', by);
  const author = (b.author as Row | undefined) ?? (b.committer as Row | undefined);
  // source: https://docs.github.com/en/rest/repos/contents "If the committer information is omitted, the authenticated user's information is used."
  const committer = (b.committer as Row | undefined) ?? { name: u?.name ?? by, email: u?.email ?? `${by}@users.noreply.github.com` };
  const sha = await commitFiles(ctx, repo, branch, { message, committer: { name: String(committer.name), email: String(committer.email) }, author: { name: String(author?.name ?? u?.name ?? by), email: String(author?.email ?? u?.email ?? `${by}@users.noreply.github.com`) }, actor: by, files: { [path]: bytes } });
  const full = String(repo.full_name);
  const blob = (await filesAt(ctx, repo, sha)).get(path)!.sha;
  const commit = (await commitAnswer(ctx, repo, sha))!;
  const l = { url: `https://api.github.com/repos/${full}/contents/${path}?ref=${branch}`, html_url: `https://github.com/${full}/blob/${branch}/${path}`, git_url: `https://api.github.com/repos/${full}/git/blobs/${blob}`, download_url: `https://raw.githubusercontent.com/${full}/${branch}/${path}` };
  const inner = commit.commit as Row;
  return json({
    content: { name: path.split('/').pop(), path, sha: blob, size: bytes.length, ...l, type: 'file', _links: { self: l.url, git: l.git_url, html: l.html_url } },
    commit: { sha, node_id: commit.node_id, url: inner.url, html_url: commit.html_url, author: inner.author, committer: inner.committer, tree: inner.tree, message, parents: commit.parents, verification: inner.verification },
  }, held ? 200 : 201);
}

/** repos/get-commit: a commit (by sha, branch or tag) with its stats and files. */
// source: https://docs.github.com/en/rest/commits/commits "The commit reference. Can be a commit SHA, branch name ( heads/BRANCH_NAME ), or tag name ( tags/TAG_NAME )."
// Where the documentation stops: "No commit found for SHA" are GitHub's words for a ref the repository does not hold
export async function repos_get_commit(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const ref = String(ctx.call.params.ref ?? '');
  const sha = await commitOf(ctx, repo, ref);
  const c = sha ? await commitAnswer(ctx, repo, sha) : undefined;
  if (!sha || !c) return fail(ctx, 422, `No commit found for SHA: ${ref}`);
  // source: https://docs.github.com/en/rest/commits/commits "application/vnd.github.sha : Returns the commit's SHA-1 hash."
  const accept = ctx.call.request.headers.get('accept') ?? '';
  if (accept.includes('application/vnd.github.sha')) return new Response(sha, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  // source: https://docs.github.com/en/rest/commits/commits "application/vnd.github.diff : Returns the diff of the commit."
  if (accept.includes('application/vnd.github.diff')) return new Response(await git.diffText(gitOf(ctx, repo).store, String((c.parents as Row[])[0]?.sha ?? '') || null, sha), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  // source: https://docs.github.com/en/rest/commits/commits "application/vnd.github.patch : Returns the patch of the commit."
  if (accept.includes('application/vnd.github.patch')) return new Response(await git.formatPatch(gitOf(ctx, repo).store, sha), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const files = await fileChanges(ctx, repo, ((c.parents as Row[])[0]?.sha as string | undefined), sha);
  const additions = files.reduce((n, f) => n + Number(f.additions), 0);
  const deletions = files.reduce((n, f) => n + Number(f.deletions), 0);
  return json({ ...c, stats: { total: additions + deletions, additions, deletions }, files });
}

/** repos/compare-commits: `base...head`: the head's commits the base lacks (oldest first), how far each is ahead and
 *  behind, and the files changed from their merge base. */
// source: https://docs.github.com/en/rest/commits/commits "This parameter expects the format BASE...HEAD ."
// source: https://docs.github.com/en/rest/commits/commits "When calling this endpoint without any paging parameter ( per_page or page ), the returned list is limited to 250 commits"
export async function repos_compare_commits(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const spec = String(ctx.call.params.basehead ?? '');
  const m = /^(.+?)\.\.\.?(.+)$/.exec(spec);
  if (!m) return notFound(ctx);
  const side = (ref: string): string => (ref.includes(':') ? ref.split(':').slice(1).join(':') : ref);
  const [base, head] = [await commitOf(ctx, repo, side(m[1]!)), await commitOf(ctx, repo, side(m[2]!))];
  if (!base || !head) return notFound(ctx);
  const merge = await git.mergeBase(gitOf(ctx, repo).store, base, head);
  const ahead = await commitsBetween(ctx, repo, base, head);
  const behind = await commitsBetween(ctx, repo, head, base);
  const commits: Row[] = [];
  for (const c of ahead.slice().reverse().slice(0, 250)) { const a = await commitAnswer(ctx, repo, c.sha); if (a) commits.push(a); }
  const accept = ctx.call.request.headers.get('accept') ?? '';
  // source: https://docs.github.com/en/rest/commits/commits "application/vnd.github.diff : Returns the diff of the commit."
  if (accept.includes('application/vnd.github.diff')) return new Response(await git.diffText(gitOf(ctx, repo).store, merge ?? base, head), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  // source: https://docs.github.com/en/rest/commits/commits "application/vnd.github.patch : Returns the patch of the commit."
  if (accept.includes('application/vnd.github.patch')) {
    const patches = await Promise.all(commits.map((commit, index) => git.formatPatch(gitOf(ctx, repo).store, String(commit.sha), { number: index + 1, total: commits.length })));
    return new Response(patches.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const full = String(repo.full_name);
  return json({
    url: `https://api.github.com/repos/${full}/compare/${spec}`, html_url: `https://github.com/${full}/compare/${spec}`, permalink_url: `https://github.com/${full}/compare/${base.slice(0, 7)}...${head.slice(0, 7)}`,
    diff_url: `https://github.com/${full}/compare/${spec}.diff`, patch_url: `https://github.com/${full}/compare/${spec}.patch`, base_commit: await commitAnswer(ctx, repo, base),
    merge_base_commit: merge ? await commitAnswer(ctx, repo, merge) : null, status: !ahead.length && !behind.length ? 'identical' : !behind.length ? 'ahead' : !ahead.length ? 'behind' : 'diverged',
    ahead_by: ahead.length, behind_by: behind.length, total_commits: ahead.length, commits, files: merge ? await fileChanges(ctx, repo, merge, head) : [],
  });
}

// ── releases (https://docs.github.com/en/rest/releases) ────────────────────────────────────────────

/** A release's notes as "Generate release notes" writes them: the pull requests merged into the default branch since the
 *  previous release, each with its author, the people contributing for the first time, and the changelog's link. */
// source: https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes "Automatically generated release notes provide an automated alternative to manually writing release notes for your GitHub releases."
function generatedNotes(ctx: HandlerContext, repo: Row, tag: string): string {
  const full = String(repo.full_name);
  const previous = ctx.rowsRaw('release').filter((r) => r._repo === repo.full_name && r.draft !== true).at(-1);
  const since = previous ? String(previous.published_at ?? previous.created_at) : '';
  const merged = ctx.rowsRaw('pull').filter((p) => p._repo === repo.full_name && p.merged === true && (p.base as Row).ref === String(repo.default_branch ?? 'main') && String(p.merged_at) > since);
  const lines = ["## What's Changed", ...merged.map((p) => `* ${String(p.title)} by @${String((p.user as Row).login)} in https://github.com/${full}/pull/${String(p.number)}`)];
  const firsts = merged.filter((p) => !ctx.rowsRaw('pull').some((q) => q._repo === repo.full_name && (q.user as Row).login === (p.user as Row).login && q.merged === true && String(q.merged_at) < String(p.merged_at)));
  if (firsts.length) lines.push('', '## New Contributors', ...firsts.map((p) => `* @${String((p.user as Row).login)} made their first contribution in https://github.com/${full}/pull/${String(p.number)}`));
  lines.push('', `**Full Changelog**: https://github.com/${full}/${previous ? `compare/${String(previous.tag_name)}...${tag}` : `commits/${tag}`}`);
  return lines.join('\n');
}

const releaseUrls = (full: string, id: number, tag: string): Row => ({
  url: `https://api.github.com/repos/${full}/releases/${id}`, assets_url: `https://api.github.com/repos/${full}/releases/${id}/assets`, upload_url: `https://uploads.github.com/repos/${full}/releases/${id}/assets{?name,label}`,
  html_url: `https://github.com/${full}/releases/tag/${tag}`, tarball_url: `https://api.github.com/repos/${full}/tarball/${tag}`, zipball_url: `https://api.github.com/repos/${full}/zipball/${tag}`,
});

/** A release as answered: stored, with its assets. */
const releaseAnswer = (ctx: HandlerContext, rel: Row): Row => ({ ...shown(ctx, rel), assets: ctx.rowsRaw('release_asset').filter((a) => a._release === String(rel.id)).map((row) => shown(ctx, row)) });

/** repos/create-release: a release of a tag, the tag made at `target_commitish` when it does not exist yet; named by the
 *  tag unless named; its notes generated when asked, after the body given. Its created_at is its commit's date. */
// source: https://docs.github.com/en/rest/releases/releases "tag_name string Required"
// source: https://docs.github.com/en/rest/releases/releases "Unused if the Git tag already exists. Default: the repository's default branch."
// source: https://docs.github.com/en/rest/releases/releases "If name is specified, the specified name will be used; otherwise, a name will be automatically generated. If body is specified, the body will be pre-pended to the automatically generated notes."
// source: https://docs.github.com/en/rest/releases/releases "The created_at attribute is the date of the commit used for the release, and not the date when the release was drafted or published."
export async function repos_create_release(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const b = bodyOf(ctx);
  const tag = str(b.tag_name);
  if (!tag) return invalid('Release', 'tag_name', 'missing_field');
  if (ctx.rowsRaw('release').some((x) => x._repo === repo.full_name && x.tag_name === tag)) return invalid('Release', 'tag_name', 'already_exists');
  const target = str(b.target_commitish) ?? String(repo.default_branch ?? 'main');
  const { refs } = gitOf(ctx, repo);
  const sha = await commitOf(ctx, repo, refs.get(`refs/tags/${tag}`) ? tag : target);
  if (!sha) return invalid('Release', 'target_commitish', 'invalid');
  if (!refs.get(`refs/tags/${tag}`) && b.draft !== true) {
    refs.set(`refs/tags/${tag}`, sha);
    await pushed(ctx, repo, [{ name: `refs/tags/${tag}`, old: git.ZERO_SHA, new: sha }], actorLogin(who(ctx)!));
  }
  const committed = (await commitAnswer(ctx, repo, sha))!;
  const id = mint(ctx, 'release');
  const at = nowIso(ctx);
  const rel = await ctx.write('release', String(id), {
    ...releaseUrls(String(repo.full_name), id, tag), id, author: account(ctx, actorLogin(who(ctx)!)), node_id: nodeId('Release', id), tag_name: tag, target_commitish: target,
    name: str(b.name) ?? tag, draft: b.draft === true, immutable: false, prerelease: b.prerelease === true, created_at: ((committed.commit as Row).committer as Row).date, updated_at: at, published_at: b.draft === true ? null : at,
    body: b.generate_release_notes === true ? [str(b.body), generatedNotes(ctx, repo, tag)].filter(Boolean).join('\n\n') : (str(b.body) ?? null), _repo: repo.full_name,
  }, b.draft === true ? 'release.created' : 'release.published');
  return json(releaseAnswer(ctx, rel), 201);
}

/** repos/list-releases: newest first; drafts only to those who can write. */
// source: https://docs.github.com/en/rest/releases/releases "Information about published releases are available to everyone. Only users with push access will receive listings for draft releases."
export async function repos_list_releases(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const writes = ['write', 'maintain', 'admin'].includes(String(roleIn(ctx, repo, who(ctx))));
  return json(page(ctx, ctx.rowsRaw('release').filter((r) => r._repo === repo.full_name && (writes || r.draft !== true)).reverse().map((r) => releaseAnswer(ctx, r))));
}

/** repos/get-latest-release: the newest published release that is not a prerelease, by its created_at. */
// source: https://docs.github.com/en/rest/releases/releases "The latest release is the most recent non-prerelease, non-draft release, sorted by the created_at attribute."
export async function repos_get_latest_release(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const rel = ctx.rowsRaw('release').filter((r) => r._repo === repo.full_name && r.draft !== true && r.prerelease !== true).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || Number(a.id) - Number(b.id)).at(-1);
  return rel ? json(releaseAnswer(ctx, rel)) : notFound(ctx);
}

/** repos/get-release-by-tag: a published release by its tag. */
// source: https://docs.github.com/en/rest/releases/releases "Get a published release with the specified tag."
export async function repos_get_release_by_tag(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const rel = ctx.rowsRaw('release').find((r) => r._repo === repo.full_name && r.tag_name === ctx.call.params.tag && r.draft !== true);
  return rel ? json(releaseAnswer(ctx, rel)) : notFound(ctx);
}

/** repos/upload-release-asset: the asset's bytes, posted to the release's upload URL on uploads.github.com, its name
 *  the `name` parameter, its type the request's Content-Type; a name the release has already, 422. */
// source: https://docs.github.com/en/rest/releases/assets "GitHub expects the asset data in its raw binary form, rather than JSON. You will send the raw binary content of the asset as the request body."
// source: https://docs.github.com/en/rest/releases/assets "Use the required Content-Type header to provide the media type of the asset."
// source: https://docs.github.com/en/rest/releases/assets "422 Response if you upload an asset with the same filename as another uploaded asset"
export async function repos_upload_release_asset(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const rel = ctx.rowsRaw('release').find((r) => r._repo === repo.full_name && String(r.id) === String(ctx.call.params.release_id));
  if (!rel) return notFound(ctx);
  const name = str(ctx.params.name) ?? new URL(ctx.call.request.url).searchParams.get('name') ?? '';
  if (!name) return invalid('ReleaseAsset', 'name', 'missing_field');
  if (ctx.rowsRaw('release_asset').some((a) => a._release === String(rel.id) && a.name === name)) return invalid('ReleaseAsset', 'name', 'already_exists');
  const bytes = new Uint8Array(await ctx.call.request.clone().arrayBuffer());
  const digest = ctx.crypto.digest('sha256', bytes, 'hex');
  await ctx.blobs.put(`assets/${digest}`, bytes);
  const id = mint(ctx, 'release-asset');
  const full = String(repo.full_name);
  const a = await ctx.write('release_asset', String(id), {
    url: `https://api.github.com/repos/${full}/releases/assets/${id}`, browser_download_url: `https://github.com/${full}/releases/download/${String(rel.tag_name)}/${encodeURIComponent(name)}`,
    id, node_id: nodeId('ReleaseAsset', id), name, label: str(ctx.params.label) ?? '', state: 'uploaded', content_type: ctx.call.request.headers.get('content-type') ?? 'application/octet-stream',
    size: bytes.byteLength, digest: `sha256:${digest}`, download_count: 0, created_at: nowIso(ctx), updated_at: nowIso(ctx), uploader: account(ctx, actorLogin(who(ctx)!)), _release: String(rel.id), _repo: repo.full_name,
  }, 'release_asset.create');
  return json(shown(ctx, a), 201);
}

/** repos/list-release-assets: a release's assets, as uploaded; a release the repository does not have, 404. */
// source: https://docs.github.com/en/rest/releases/assets "To find the release_id query the GET /repos/{owner}/{repo}/releases/latest endpoint ."
export async function repos_list_release_assets(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const rel = ctx.rowsRaw('release').find((r) => r._repo === repo.full_name && String(r.id) === String(ctx.call.params.release_id) && r.deleted !== true);
  if (!rel) return notFound(ctx);
  return json(page(ctx, ctx.rowsRaw('release_asset').filter((a) => a._release === String(rel.id) && a.deleted !== true)).map((row) => shown(ctx, row)));
}

/** repos/get-release-asset: its metadata, or its bytes when asked for `application/octet-stream` (the download counted). */
// source: https://docs.github.com/en/rest/releases/assets "Alternatively, set the Accept header of the request to application/octet-stream . The API will either redirect the client to the location, or stream it directly if possible."
export async function repos_get_release_asset(ctx: HandlerContext): Promise<Response> {
  const repo = repoOfPath(ctx);
  const a = ctx.rowsRaw('release_asset').find((x) => x._repo === repo.full_name && String(x.id) === String(ctx.call.params.asset_id));
  if (!a) return notFound(ctx);
  if ((ctx.call.request.headers.get('accept') ?? '').includes('application/octet-stream')) {
    const bytes = await ctx.blobs.get(`assets/${String(a.digest).replace(/^sha256:/, '')}`);
    if (!bytes) return notFound(ctx);
    // its downloads, counted from its history: this one and each before it
    const downloads = ctx.history('release_asset', String(a.id)).filter((w) => w.operation === 'release_asset.download').length + 1;
    await ctx.write('release_asset', String(a.id), { download_count: downloads }, 'release_asset.download');
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename=${String(a.name)}` } });
  }
  return json(shown(ctx, a));
}
