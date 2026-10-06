// The objects GitHub answers, as its REST reference gives them (https://docs.github.com/en/rest): pure shapes made from
// what a handler knows when it writes, stored as they are answered (shape parity), their URLs under GitHub's hosts.

type Row = Record<string, unknown>;

export const API = 'https://api.github.com';
export const WEB = 'https://github.com';

/** A global node id in GitHub's legacy form: base64 of `0<type length>:<Type><id>` ("MDQ6VXNlcjE=" is User 1). */
export const nodeId = (type: string, id: number | string): string => btoa(`0${type.length}:${type}${String(id)}`);

/** An account as GitHub names it in another object (a "simple user", https://docs.github.com/en/rest/users/users). */
export function simpleUser(u: Row): Row {
  const login = String(u.login);
  const type = String(u.type ?? 'User');
  const bot = type === 'Bot';
  return {
    login, id: u.id, node_id: u.node_id ?? nodeId(type, Number(u.id)),
    avatar_url: `https://avatars.githubusercontent.com/${bot ? 'in' : 'u'}/${String(u.id)}?v=4`, gravatar_id: '', url: `${API}/users/${encodeURIComponent(login)}`,
    html_url: `${WEB}/${bot ? `apps/${login.replace(/\[bot\]$/, '')}` : login}`, followers_url: `${API}/users/${login}/followers`,
    following_url: `${API}/users/${login}/following{/other_user}`, gists_url: `${API}/users/${login}/gists{/gist_id}`, starred_url: `${API}/users/${login}/starred{/owner}{/repo}`,
    subscriptions_url: `${API}/users/${login}/subscriptions`, organizations_url: `${API}/users/${login}/orgs`, repos_url: `${API}/users/${login}/repos`,
    events_url: `${API}/users/${login}/events{/privacy}`, received_events_url: `${API}/users/${login}/received_events`, type, user_view_type: 'public', site_admin: false,
  };
}

/** A person's account as GitHub keeps it (public-user; its private fields answered to themselves only). */
export function userShape(login: string, id: number, at: string, type: 'User' | 'Bot' = 'User'): Row {
  return {
    ...simpleUser({ login, id, type }), name: null, company: null, blog: '', location: null, email: null, hireable: null, bio: null, twitter_username: null,
    public_repos: 0, public_gists: 0, followers: 0, following: 0, created_at: at, updated_at: at,
  };
}

/** An organization as GitHub names it elsewhere. */
export function simpleOrg(o: Row): Row {
  const login = String(o.login);
  return {
    login, id: o.id, node_id: nodeId('Organization', Number(o.id)), url: `${API}/orgs/${login}`, repos_url: `${API}/orgs/${login}/repos`,
    events_url: `${API}/orgs/${login}/events`, hooks_url: `${API}/orgs/${login}/hooks`, issues_url: `${API}/orgs/${login}/issues`,
    members_url: `${API}/orgs/${login}/members{/member}`, public_members_url: `${API}/orgs/${login}/public_members{/member}`,
    avatar_url: `https://avatars.githubusercontent.com/u/${String(o.id)}?v=4`, description: o.description ?? null,
  };
}

/** The license texts `license_template` names (https://docs.github.com/en/rest/licenses): the life's. */
export const LICENSES: Record<string, { key: string; name: string; spdx_id: string; text: (year: number, holder: string) => string }> = {
  mit: {
    key: 'mit', name: 'MIT License', spdx_id: 'MIT',
    text: (year, holder) => `MIT License\n\nCopyright (c) ${year} ${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
  },
};

/** A repository's URLs, by its full name. */
export function repoUrls(full: string): Row {
  const url = `${API}/repos/${full}`;
  return {
    html_url: `${WEB}/${full}`, url, forks_url: `${url}/forks`, keys_url: `${url}/keys{/key_id}`, collaborators_url: `${url}/collaborators{/collaborator}`, teams_url: `${url}/teams`,
    hooks_url: `${url}/hooks`, issue_events_url: `${url}/issues/events{/number}`, events_url: `${url}/events`, assignees_url: `${url}/assignees{/user}`,
    branches_url: `${url}/branches{/branch}`, tags_url: `${url}/tags`, blobs_url: `${url}/git/blobs{/sha}`, git_tags_url: `${url}/git/tags{/sha}`,
    git_refs_url: `${url}/git/refs{/sha}`, trees_url: `${url}/git/trees{/sha}`, statuses_url: `${url}/statuses/{sha}`, languages_url: `${url}/languages`,
    stargazers_url: `${url}/stargazers`, contributors_url: `${url}/contributors`, subscribers_url: `${url}/subscribers`, subscription_url: `${url}/subscription`,
    commits_url: `${url}/commits{/sha}`, git_commits_url: `${url}/git/commits{/sha}`, comments_url: `${url}/comments{/number}`, issue_comment_url: `${url}/issues/comments{/number}`,
    contents_url: `${url}/contents/{+path}`, compare_url: `${url}/compare/{base}...{head}`, merges_url: `${url}/merges`, archive_url: `${url}/{archive_format}{/ref}`,
    downloads_url: `${url}/downloads`, issues_url: `${url}/issues{/number}`, pulls_url: `${url}/pulls{/number}`, milestones_url: `${url}/milestones{/number}`,
    notifications_url: `${url}/notifications{?since,all,participating}`, labels_url: `${url}/labels{/name}`, releases_url: `${url}/releases{/id}`, deployments_url: `${url}/deployments`,
    git_url: `git://github.com/${full}.git`, ssh_url: `git@github.com:${full}.git`, clone_url: `${WEB}/${full}.git`, svn_url: `${WEB}/${full}`,
  };
}

/** A new repository (full-repository, https://docs.github.com/en/rest/repos/repos#get-a-repository): its owner the
 *  account's simple form. */
export function repositoryShape(id: number, name: string, owner: Row, f: Row, at: string): Row {
  const full = `${String(owner.login)}/${name}`;
  return {
    id, node_id: nodeId('Repository', id), name, full_name: full, private: f.private === true, owner, description: f.description ?? null, fork: f.fork === true, ...repoUrls(full),
    homepage: f.homepage ?? null, size: 0, stargazers_count: 0, watchers_count: 0, language: null, has_issues: f.has_issues !== false, has_projects: f.has_projects !== false,
    has_downloads: true, has_wiki: f.has_wiki !== false, has_pages: false, has_discussions: f.has_discussions === true, forks_count: 0, mirror_url: null, archived: false, disabled: false,
    open_issues_count: 0, license: typeof f.license === 'string' && LICENSES[f.license] ? { key: f.license, name: LICENSES[f.license]!.name, spdx_id: LICENSES[f.license]!.spdx_id, url: `${API}/licenses/${f.license}`, node_id: nodeId('License', 13) } : null,
    allow_forking: true, is_template: false, web_commit_signoff_required: false, topics: [], visibility: f.private === true ? 'private' : 'public', forks: 0, open_issues: 0, watchers: 0,
    default_branch: f.default_branch ?? 'main', created_at: at, updated_at: at, pushed_at: at, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true,
    allow_auto_merge: false, delete_branch_on_merge: false, allow_update_branch: false, use_squash_pr_title_as_default: false, squash_merge_commit_title: 'COMMIT_OR_PR_TITLE',
    squash_merge_commit_message: 'COMMIT_MESSAGES', merge_commit_title: 'MERGE_MESSAGE', merge_commit_message: 'PR_TITLE', network_count: 0, subscribers_count: 1,
    ...(f.parent ? { parent: f.parent, source: f.source ?? f.parent } : {}), ...(owner.type === 'Organization' ? { organization: owner } : {}),
  };
}

/** A label (https://docs.github.com/en/rest/issues/labels). */
export function labelShape(id: number, full: string, f: { name: string; color: string; description: string | null; default?: boolean }): Row {
  return { id, node_id: nodeId('Label', id), url: `${API}/repos/${full}/labels/${encodeURIComponent(f.name)}`, name: f.name, color: f.color, default: f.default === true, description: f.description, archived_at: null, archived_by: null };
}

/** The labels a new repository has ("GitHub provides default labels in every new repository",
 *  https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels#about-default-labels). */
export const DEFAULT_LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' },
  { name: 'duplicate', color: 'cfd3d7', description: 'This issue or pull request already exists' },
  { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
  { name: 'good first issue', color: '7057ff', description: 'Good for newcomers' },
  { name: 'help wanted', color: '008672', description: 'Extra attention is needed' },
  { name: 'invalid', color: 'e4e669', description: "This doesn't seem right" },
  { name: 'question', color: 'd876e3', description: 'Further information is requested' },
  { name: 'wontfix', color: 'ffffff', description: 'This will not be worked on' },
];

/** A milestone (https://docs.github.com/en/rest/issues/milestones), its issue counts kept on it by the writes that change them. */
export function milestoneShape(id: number, number: number, full: string, creator: Row, f: Row, at: string): Row {
  return {
    url: `${API}/repos/${full}/milestones/${number}`, html_url: `${WEB}/${full}/milestone/${number}`, labels_url: `${API}/repos/${full}/milestones/${number}/labels`,
    id, node_id: nodeId('Milestone', id), number, state: f.state === 'closed' ? 'closed' : 'open', title: f.title, description: f.description ?? null, creator,
    open_issues: 0, closed_issues: 0, created_at: at, updated_at: at, closed_at: f.state === 'closed' ? at : null, due_on: f.due_on ?? null,
  };
}

/** An issue (https://docs.github.com/en/rest/issues/issues#get-an-issue); a pull request's issue carries `pull_request`. */
export function issueShape(id: number, number: number, full: string, f: { title: string; body: string | null; user: Row; labels: Row[]; assignees: Row[]; milestone: Row | null; pull?: boolean; association: string }, at: string): Row {
  const url = `${API}/repos/${full}/issues/${number}`;
  return {
    url, repository_url: `${API}/repos/${full}`, labels_url: `${url}/labels{/name}`, comments_url: `${url}/comments`, events_url: `${url}/events`,
    html_url: `${WEB}/${full}/${f.pull ? 'pull' : 'issues'}/${number}`, id, node_id: nodeId(f.pull ? 'PullRequest' : 'Issue', id), number, title: f.title, user: f.user,
    labels: f.labels, state: 'open', locked: false, assignee: f.assignees[0] ?? null, assignees: f.assignees, milestone: f.milestone, comments: 0, created_at: at, updated_at: at,
    closed_at: null, author_association: f.association, active_lock_reason: null, body: f.body, closed_by: null, state_reason: null, timeline_url: `${url}/timeline`, pinned_comment: null,
    performed_via_github_app: null, reactions: { url: `${url}/reactions`, total_count: 0, '+1': 0, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
    ...(f.pull ? { draft: false, pull_request: { url: `${API}/repos/${full}/pulls/${number}`, html_url: `${WEB}/${full}/pull/${number}`, diff_url: `${WEB}/${full}/pull/${number}.diff`, patch_url: `${WEB}/${full}/pull/${number}.patch`, merged_at: null } } : {}),
  };
}

/** An issue comment (https://docs.github.com/en/rest/issues/comments). */
export function commentShape(id: number, full: string, number: number, pull: boolean, user: Row, body: string, association: string, at: string): Row {
  const url = `${API}/repos/${full}/issues/comments/${id}`;
  return {
    id, node_id: nodeId('IssueComment', id), url, html_url: `${WEB}/${full}/${pull ? 'pull' : 'issues'}/${number}#issuecomment-${id}`, body, user, created_at: at, updated_at: at,
    issue_url: `${API}/repos/${full}/issues/${number}`, author_association: association, performed_via_github_app: null, pin: null, minimized: null,
    reactions: { url: `${url}/reactions`, total_count: 0, '+1': 0, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
  };
}

/** A pull request (https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request): its head and base with their
 *  repositories; its size counts kept on it by the pushes that change them. */
export function pullShape(id: number, number: number, base: { repo: Row; ref: string; sha: string }, head: { repo: Row; ref: string; sha: string }, f: { title: string; body: string | null; user: Row; draft: boolean; association: string; stats: Row }, at: string): Row {
  const full = String(base.repo.full_name);
  const url = `${API}/repos/${full}/pulls/${number}`;
  // each side's repository is the repository as GitHub answers it (`repository`), as it stood when the pull request opened
  const side = (s: { repo: Row; ref: string; sha: string }): Row => ({ label: `${String((s.repo.owner as Row).login)}:${s.ref}`, ref: s.ref, sha: s.sha, user: s.repo.owner, repo: s.repo });
  return {
    url, id, node_id: nodeId('PullRequest', id), html_url: `${WEB}/${full}/pull/${number}`, diff_url: `${WEB}/${full}/pull/${number}.diff`, patch_url: `${WEB}/${full}/pull/${number}.patch`,
    issue_url: `${API}/repos/${full}/issues/${number}`, commits_url: `${url}/commits`, review_comments_url: `${url}/comments`, review_comment_url: `${API}/repos/${full}/pulls/comments{/number}`,
    comments_url: `${API}/repos/${full}/issues/${number}/comments`, statuses_url: `${API}/repos/${full}/statuses/${head.sha}`, number, state: 'open', locked: false, title: f.title,
    user: f.user, body: f.body, labels: [], milestone: null, active_lock_reason: null, created_at: at, updated_at: at, closed_at: null, merged_at: null, merge_commit_sha: null,
    assignee: null, assignees: [], requested_reviewers: [], requested_teams: [], head: side(head), base: side(base),
    _links: { self: { href: url }, html: { href: `${WEB}/${full}/pull/${number}` }, issue: { href: `${API}/repos/${full}/issues/${number}` }, comments: { href: `${API}/repos/${full}/issues/${number}/comments` }, review_comments: { href: `${url}/comments` }, review_comment: { href: `${API}/repos/${full}/pulls/comments{/number}` }, commits: { href: `${url}/commits` }, statuses: { href: `${API}/repos/${full}/statuses/${head.sha}` } },
    author_association: f.association, auto_merge: null, draft: f.draft, merged: false, mergeable: true, rebaseable: true, mergeable_state: 'clean', merged_by: null,
    comments: 0, review_comments: 0, maintainer_can_modify: String(head.repo.id) !== String(base.repo.id), ...f.stats,
  };
}

/** A person's standing in a repository as GitHub names it on their issues and comments ("author_association"). */
export type Association = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIMER' | 'FIRST_TIME_CONTRIBUTOR' | 'NONE';

/** The repository roles in order of what they allow (https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization). */
export const ROLES = ['read', 'triage', 'write', 'maintain', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** A role named as GitHub's APIs name it (`pull` is read, `push` write). */
export const roleOf = (p: unknown): Role | undefined => {
  const s = String(p ?? '');
  return s === 'pull' ? 'read' : s === 'push' ? 'write' : (ROLES as readonly string[]).includes(s) ? (s as Role) : undefined;
};

export const atLeast = (have: Role | undefined, need: Role): boolean => have !== undefined && ROLES.indexOf(have) >= ROLES.indexOf(need);

export const permissionsOf = (r: Role | undefined): Row => ({ admin: atLeast(r, 'admin'), maintain: atLeast(r, 'maintain'), push: atLeast(r, 'write'), triage: atLeast(r, 'triage'), pull: atLeast(r, 'read') });

/** The issue numbers a text says it closes: "close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves",
 *  "resolved", then `#<number>` (https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue#linking-a-pull-request-to-an-issue-using-a-keyword). */
export function closingNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
