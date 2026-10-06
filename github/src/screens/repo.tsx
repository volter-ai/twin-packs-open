// A REPOSITORY'S PAGE — github.com/{owner}/{repo}, its Code tab: the repository's name and visibility, its tabs, the
// default branch's latest commit and its files and folders (each with the last commit that touched it), and its README
// rendered, the About sidebar beside them. A private repository is its members' alone: anyone else finds no page, as on
// GitHub. Every other request under the path (git over HTTP, a page deeper in) is git's (./git.ts).
import { git, type HandlerContext } from '@volter/world-core';
import { flowPage, markdownHtml } from '@volter/world-ui';
import { gitOf, repoNamed, roleIn, type Row } from '../semantics/shared.ts';
import { screen as gitScreen } from './git.ts';
import { person, refused } from './shared.tsx';

// Where the documentation stops: the page's measures and colours follow github.com's light theme as GitHub's own Primer
// design system names them; the per-file last commit is found within the branch's latest 300 commits
const CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; }
a { color: #0969da; text-decoration: none; } a:hover { text-decoration: underline; }
svg { fill: currentColor; vertical-align: text-bottom; }
.head { background: #f6f8fa; border-bottom: 1px solid #d1d9e0; padding: 16px 32px 0; }
.title { display: flex; align-items: center; gap: 8px; font-size: 20px; margin-bottom: 16px; }
.title .owner { font-weight: 400; } .title .name { font-weight: 600; }
.label { border: 1px solid #d1d9e0; border-radius: 2em; padding: 0 7px; font-size: 12px; font-weight: 500; line-height: 18px; color: #59636e; }
.tabs { display: flex; gap: 8px; }
.tabs span { display: flex; align-items: center; gap: 8px; padding: 0 8px 8px; color: #1f2328; border-bottom: 2px solid transparent; }
.tabs .on { border-bottom-color: #fd8c73; font-weight: 600; }
.count { background: rgba(129,139,152,0.12); border-radius: 2em; padding: 0 6px; font-size: 12px; font-weight: 500; }
.body { max-width: 1280px; margin: 0 auto; padding: 24px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 24px; }
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border: 1px solid #d1d9e0; border-radius: 6px; background: #f6f8fa; font-weight: 500; color: #1f2328; }
.btn.green { background: #1f883d; border-color: rgba(31,35,40,0.15); color: #fff; margin-left: auto; }
.muted { color: #59636e; }
.box { border: 1px solid #d1d9e0; border-radius: 6px; overflow: hidden; margin-bottom: 24px; }
.latest { display: flex; align-items: center; gap: 8px; background: #f6f8fa; padding: 16px; border-bottom: 1px solid #d1d9e0; }
.latest .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar { width: 20px; height: 20px; border-radius: 50%; background: #d1d9e0; display: inline-block; }
table.files { width: 100%; border-collapse: collapse; }
.files td { padding: 8px 16px; border-top: 1px solid #d1d9e0; white-space: nowrap; }
.files tr:first-child td { border-top: 0; }
.files td.name { width: 30%; } .files td.msg { color: #59636e; overflow: hidden; text-overflow: ellipsis; max-width: 0; width: 55%; } .files td.when { color: #59636e; text-align: right; }
.files .dir svg { color: #54aeff; } .files .file svg { color: #59636e; }
.readme-head { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #d1d9e0; font-weight: 600; }
.markdown { padding: 32px; font-size: 16px; line-height: 1.5; word-wrap: break-word; }
.markdown > :first-child { margin-top: 0; }
.markdown h1, .markdown h2 { padding-bottom: .3em; border-bottom: 1px solid #d1d9e0b3; font-weight: 600; }
.markdown h1 { font-size: 2em; } .markdown h2 { font-size: 1.5em; } .markdown h3 { font-size: 1.25em; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4 { margin: 24px 0 16px; line-height: 1.25; }
.markdown p, .markdown ul, .markdown ol, .markdown table, .markdown pre, .markdown blockquote { margin: 0 0 16px; }
.markdown code { font: 85% ui-monospace, SFMono-Regular, Menlo, monospace; background: rgba(129,139,152,0.2); padding: .2em .4em; border-radius: 6px; }
.markdown pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; } .markdown pre code { background: none; padding: 0; font-size: 85%; }
.markdown table { border-collapse: collapse; } .markdown td, .markdown th { border: 1px solid #d1d9e0; padding: 6px 13px; }
.markdown blockquote { color: #59636e; border-left: .25em solid #d1d9e0; padding: 0 1em; }
.markdown img { max-width: 100%; }
.about h2 { font-size: 16px; margin: 0 0 16px; }
.about p { margin: 0 0 16px; font-size: 16px; }
.topics { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.topic { background: #ddf4ff; color: #0969da; border-radius: 2em; padding: 0 10px; font-size: 12px; font-weight: 500; line-height: 22px; }
.about .line { display: flex; align-items: center; gap: 8px; color: #59636e; margin-bottom: 8px; }
.empty { padding: 32px; text-align: center; }
`;

// GitHub's Octicons (MIT), at 16px
const icon = {
  repo: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z',
  dir: 'M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z',
  file: 'M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z',
  branch: 'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  book: 'M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z',
  history: 'm.427 1.927 1.215 1.215a8.002 8.002 0 1 1-1.6 5.685.75.75 0 1 1 1.493-.154 6.5 6.5 0 1 0 1.18-4.458l1.358 1.358A.25.25 0 0 1 3.896 6H.25A.25.25 0 0 1 0 5.75V2.104a.25.25 0 0 1 .427-.177ZM7.75 4a.75.75 0 0 1 .75.75v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5A.75.75 0 0 1 7.75 4Z',
};
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={d} /></svg>;

/** "3 hours ago", as GitHub says a time, from the World's present. */
function ago(now: number, then: number): string {
  const s = Math.max(0, Math.round(now - then));
  const [n, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : s < 2592000 ? [Math.round(s / 86400), 'day'] : s < 31536000 ? [Math.round(s / 2592000), 'month'] : [Math.round(s / 31536000), 'year'];
  return n <= 0 ? 'now' : `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}
const isDir = (mode: string): boolean => mode === '40000' || mode === '040000';
const LIMIT = 300;

// source: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes "If you put your README file in your repository's hidden .github , root, or docs directory, GitHub will recognize and automatically surface your README to repository visitors."
export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  // the repository's own page, asked for by a person's browser; anything else under the path is git's
  const wantsPage = (ctx.call.request.method === 'GET' || ctx.call.request.method === 'HEAD') && parts.length === 2 && !parts[1]!.endsWith('.git')
    && (ctx.call.request.headers.get('accept') ?? '').includes('text/html');
  if (!wantsPage) return gitScreen(ctx);
  const [owner, name] = parts as [string, string];
  const repo = repoNamed(ctx, owner, name);
  if (!repo || repo.deleted === true) return refused(404, 'Not Found');
  const login = person(ctx);
  const role = login ? roleIn(ctx, repo, { kind: 'user', login, scopes: '*', token: '' }) : undefined;
  if (repo.private === true && !role) return refused(404, 'Not Found');
  const full = String(repo.full_name);
  const now = Date.parse(ctx.occurredAt) / 1000;
  const { store, refs } = gitOf(ctx, repo);
  const branch = String(repo.default_branch ?? 'main');
  const all = refs.list();
  const branches = all.filter((r) => r.name.startsWith('refs/heads/')).length;
  const tags = all.filter((r) => r.name.startsWith('refs/tags/')).length;
  const issues = ctx.rowsRaw('issue').filter((i) => i._repo === full && i.state === 'open' && i.deleted !== true);
  const openIssues = issues.filter((i) => !i.pull_request).length;
  const openPulls = issues.filter((i) => Boolean(i.pull_request)).length;

  // the branch's history, newest first along its first parents: the latest commit, how many there are, and for each
  // entry at the root the newest commit that changed it
  const tip = refs.get(`refs/heads/${branch}`);
  let latest: { sha: string; c: git.Commit } | undefined;
  let entries: git.TreeEntry[] = [];
  const touched = new Map<string, { sha: string; c: git.Commit }>();
  let commits = 0;
  const treeOf = async (commit: git.Commit): Promise<Map<string, string>> => {
    const t = await store.read(commit.tree);
    return new Map(t?.type === 'tree' ? git.decodeTree(t.payload).map((e) => [e.name, e.sha]) : []);
  };
  if (tip) {
    let sha: string | undefined = tip;
    let held: Map<string, string> | undefined;
    while (sha && commits < LIMIT) {
      const o = await store.read(sha);
      if (o?.type !== 'commit') break;
      const c = git.decodeCommit(o.payload);
      commits += 1;
      if (!latest) {
        latest = { sha, c };
        const t = await store.read(c.tree);
        entries = t?.type === 'tree' ? git.decodeTree(t.payload) : [];
      }
      if (touched.size < entries.length) {
        // the parent's tree is the next step's own: read once
        const here = held ?? await treeOf(c);
        const parent = c.parents[0] ? await store.read(c.parents[0]) : undefined;
        const before = parent?.type === 'commit' ? await treeOf(git.decodeCommit(parent.payload)) : new Map<string, string>();
        for (const e of entries) if (!touched.has(e.name) && here.get(e.name) !== before.get(e.name)) touched.set(e.name, { sha, c });
        held = before;
      } else held = undefined;
      sha = c.parents[0];
    }
  }
  // folders first, then files, each by name, as GitHub lists them
  const listed = [...entries].sort((a, b) => Number(isDir(b.mode)) - Number(isDir(a.mode)) || a.name.localeCompare(b.name));
  // the README GitHub surfaces: in .github, then the root, then docs; a Markdown one before any other in its folder
  const readmeIn = (listing: git.TreeEntry[]): git.TreeEntry | undefined => {
    const named = listing.filter((e) => !isDir(e.mode) && /^readme(\.[a-z]+)?$/i.test(e.name));
    return named.find((e) => /\.(md|markdown)$/i.test(e.name)) ?? named.find((e) => /^readme(\.txt)?$/i.test(e.name));
  };
  const folder = async (name: string): Promise<git.TreeEntry[]> => {
    const e = entries.find((x) => x.name === name && isDir(x.mode));
    const t = e ? await store.read(e.sha) : undefined;
    return t?.type === 'tree' ? git.decodeTree(t.payload) : [];
  };
  const readmeEntry = readmeIn(await folder('.github')) ?? readmeIn(entries) ?? readmeIn(await folder('docs'));
  const readmeBlob = readmeEntry ? await store.read(readmeEntry.sha) : undefined;
  const readmeText = readmeBlob?.type === 'blob' ? new TextDecoder().decode(readmeBlob.payload) : undefined;
  const firstLine = (c: git.Commit): string => c.message.split('\n')[0] ?? '';

  const tabs: Array<[string, number | undefined]> = [['Code', undefined], ['Issues', openIssues], ['Pull requests', openPulls], ['Actions', undefined], ['Projects', undefined], ['Security', undefined], ['Insights', undefined], ...(role === 'admin' ? [['Settings', undefined] as [string, undefined]] : [])];
  const body = (
    <>
      <div className="head">
        <div className="title"><Icon d={icon.repo} /><a className="owner" href={`/${String((repo.owner as Row).login)}`}>{String((repo.owner as Row).login)}</a><span className="muted">/</span><a className="name" href={`/${full}`}>{String(repo.name)}</a><span className="label">{repo.private === true ? 'Private' : 'Public'}</span></div>
        <nav className="tabs">{tabs.map(([t, n], i) => <span key={t} className={i === 0 ? 'on' : undefined}>{t}{n ? <span className="count">{n}</span> : null}</span>)}</nav>
      </div>
      <div className="body">
        <div>
          <div className="bar">
            <span className="btn"><Icon d={icon.branch} />{branch}</span>
            <span className="muted"><Icon d={icon.branch} /> <b>{branches}</b> {branches === 1 ? 'Branch' : 'Branches'}</span>
            <span className="muted"><b>{tags}</b> {tags === 1 ? 'Tag' : 'Tags'}</span>
            <span className="btn green">Code</span>
          </div>
          {latest ? (
            <div className="box">
              <div className="latest">
                <span className="avatar" aria-hidden="true" /><b>{latest.c.author.name}</b>
                <span className="msg">{firstLine(latest.c)}</span>
                <span className="muted">{latest.sha.slice(0, 7)} · {ago(now, latest.c.committer.time)}</span>
                <span className="muted"><Icon d={icon.history} /> <b>{commits}{commits >= LIMIT ? '+' : ''}</b> {commits === 1 ? 'Commit' : 'Commits'}</span>
              </div>
              <table className="files"><tbody>
                {listed.map((e) => {
                  const last = touched.get(e.name);
                  return (
                    <tr key={e.name} className={isDir(e.mode) ? 'dir' : 'file'}>
                      <td className="name"><Icon d={isDir(e.mode) ? icon.dir : icon.file} /> {e.name}</td>
                      <td className="msg">{last ? firstLine(last.c) : ''}</td>
                      <td className="when">{last ? ago(now, last.c.committer.time) : ''}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          ) : (
            <div className="box empty"><h3>This repository is empty.</h3><p className="muted">Push a branch to see its files here.</p></div>
          )}
          {readmeText !== undefined ? (
            <div className="box">
              <div className="readme-head"><Icon d={icon.book} />README</div>
              {/\.(md|markdown)$/i.test(readmeEntry!.name)
                ? <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(readmeText) }} />
                : <div className="markdown"><pre>{readmeText}</pre></div>}
            </div>
          ) : null}
        </div>
        <aside className="about">
          <h2>About</h2>
          {typeof repo.description === 'string' && repo.description ? <p>{repo.description}</p> : <p className="muted">No description, website, or topics provided.</p>}
          {typeof repo.homepage === 'string' && repo.homepage ? <p><a href={repo.homepage}>{repo.homepage.replace(/^https?:\/\//, '')}</a></p> : null}
          {Array.isArray(repo.topics) && repo.topics.length ? <div className="topics">{(repo.topics as string[]).map((t) => <span key={t} className="topic">{t}</span>)}</div> : null}
          {readmeText !== undefined ? <div className="line"><Icon d={icon.book} />Readme</div> : null}
          <div className="line"><b>{Number(repo.stargazers_count ?? 0)}</b> stars</div>
          <div className="line"><b>{Number(repo.watchers_count ?? 0)}</b> watching</div>
          <div className="line"><b>{Number(repo.forks_count ?? 0)}</b> forks</div>
        </aside>
      </div>
    </>
  );
  return flowPage({ title: `${full}${typeof repo.description === 'string' && repo.description ? `: ${repo.description}` : ''}`, css: [CSS], body });
}
