// A REPOSITORY'S PAGE — github.com/{owner}/{repo}: Code, Issues and Pull requests share its stored state. Code shows the
// default branch's latest commit and its files and folders (each with the last commit that touched it), and its README
// rendered, the About sidebar beside them. Files, directories and branch selection read those same stored Git objects.
// A private repository is its members' alone: anyone else finds no page, as on GitHub. Git transport stays in ./git.ts.
import { git, type HandlerContext } from '@volter/world-core';
import { flowPage, markdownHtml } from '@volter/world-ui';
import { gitOf, issueByNumber, pullByNumber, repoNamed, roleIn, type Row } from '../semantics/shared.ts';
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
.tabs > span, .tabs > a { display: flex; align-items: center; gap: 8px; padding: 0 8px 8px; color: #1f2328; border-bottom: 2px solid transparent; }
.tabs > a:hover { text-decoration: none; background: #f6f8fa; }
.tabs .on { border-bottom-color: #fd8c73; font-weight: 600; }
.tabs button { border: 0; background: none; font: inherit; color: #59636e; padding: 0 8px 8px; cursor: not-allowed; }
.tabs { overflow-x: auto; white-space: nowrap; }
.count { background: rgba(129,139,152,0.12); border-radius: 2em; padding: 0 6px; font-size: 12px; font-weight: 500; }
.body { max-width: 1280px; margin: 0 auto; padding: 24px 32px; display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 24px; }
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border: 1px solid #d1d9e0; border-radius: 6px; background: #f6f8fa; font-weight: 500; color: #1f2328; }
.btn.green { background: #1f883d; border-color: rgba(31,35,40,0.15); color: #fff; margin-left: auto; }
.btn:disabled { cursor: not-allowed; opacity: .65; }
.branch { position: relative; } .branch summary { cursor: pointer; list-style: none; }
.branch-menu { position: absolute; z-index: 1; min-width: 240px; max-width: 320px; max-height: 320px; overflow: auto; background: #fff; border: 1px solid #d1d9e0; border-radius: 6px; padding: 8px; }
.branch-menu a { display: block; padding: 6px 8px; color: #1f2328; overflow-wrap: anywhere; }
.breadcrumbs { margin: 0 0 16px; overflow-wrap: anywhere; }
.file-view { grid-column: 1 / -1; min-width: 0; }
.file-head { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #f6f8fa; border-bottom: 1px solid #d1d9e0; }
.file-head .raw { margin-left: auto; } .source { overflow: auto; margin: 0; padding: 16px; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
.source .line { display: flex; min-height: 1.7em; } .source .line:target { background: #fff8c5; }
.source .line-no { flex: 0 0 48px; color: #59636e; text-align: right; padding-right: 16px; user-select: none; }
.source code { white-space: pre; } .files .name a { color: #1f2328; }
@media (max-width: 800px) { .head { padding: 16px 16px 0; } .body { grid-template-columns: minmax(0, 1fr); padding: 16px; } .about { border-top: 1px solid #d1d9e0; padding-top: 16px; } .files td.when { display: none; } .files td { padding: 8px; } .bar { flex-wrap: wrap; } .markdown { padding: 16px; } }
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
.work { display: block; }
.work-list-head { display: flex; gap: 20px; padding: 16px; background: #f6f8fa; }
.work-list-head a { color: #59636e; } .work-list-head a[aria-current] { color: #1f2328; font-weight: 600; }
.work-item { display: flex; gap: 12px; padding: 12px 16px; border-top: 1px solid #d1d9e0; }
.work-item:hover { background: #f6f8fa; } .work-item > div { min-width: 0; flex: 1; }
.work-item h2 { display: inline; font-size: 16px; line-height: 1.5; margin: 0 8px 0 0; }
.work-item h2 a { color: #1f2328; } .work-item .muted { display: block; font-size: 12px; margin-top: 4px; }
.state-dot { flex: 0 0 14px; height: 14px; border: 2px solid currentColor; border-radius: 50%; color: #1f883d; margin-top: 5px; }
.state-dot.closed { color: #8250df; } .state-dot.draft { color: #59636e; }
.conversation-heading { margin: 0 0 24px; padding-bottom: 16px; border-bottom: 1px solid #d1d9e0; }
.conversation-heading h1 { margin: 0 0 8px; font-size: 32px; font-weight: 400; overflow-wrap: anywhere; }
.state-pill { display: inline-flex; align-items: center; gap: 8px; color: #fff; background: #1f883d; border-radius: 2em; padding: 5px 12px; font-weight: 500; margin-right: 8px; }
.state-pill.closed { background: #8250df; } .state-pill.draft { background: #59636e; }
.conversation-grid { display: grid; grid-template-columns: minmax(0, 1fr) 256px; gap: 24px; }
.comment-head { display: flex; gap: 6px; align-items: center; padding: 8px 16px; background: #f6f8fa; border-bottom: 1px solid #d1d9e0; }
.comment-head .label { margin-left: auto; } .comment-body { padding: 16px; font-size: 14px; }
.conversation-grid aside section { padding: 16px 0; border-bottom: 1px solid #d1d9e0; }
.conversation-grid aside h2 { color: #59636e; font-size: 12px; margin: 0 0 8px; }
.conversation-tabs { display: flex; gap: 8px; border-bottom: 1px solid #d1d9e0; margin-bottom: 16px; overflow-x: auto; }
.conversation-tabs > a, .conversation-tabs > button { padding: 8px 12px; white-space: nowrap; font: inherit; }
.conversation-tabs > a { color: #1f2328; } .conversation-tabs > a[aria-current] { border: 1px solid #d1d9e0; border-bottom: 0; border-radius: 6px 6px 0 0; }
.conversation-tabs > button { border: 0; background: none; color: #59636e; cursor: not-allowed; }
.conversation-heading code { padding: 2px 4px; background: #ddf4ff; border-radius: 6px; color: #0969da; }
.patch { margin: 0; overflow: auto; padding: 0; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
.patch code { display: block; padding: 0 16px; min-height: 1.7em; white-space: pre; }
.patch .added { background: #dafbe1; } .patch .removed { background: #ffebe9; } .patch .hunk { background: #ddf4ff; }
.patch-summary { display: flex; gap: 16px; align-items: center; margin-bottom: 16px; }
.patch-summary button { margin-left: auto; }
@media (max-width: 800px) { .conversation-grid { grid-template-columns: minmax(0, 1fr); } .conversation-heading h1 { font-size: 24px; } }
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
  let parts: string[];
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return refused(404, 'Not Found'); }
  const view = parts[2];
  const fileRoute = ['tree', 'blob', 'raw'].includes(view ?? '') && parts.length >= 4;
  const workRoute = ((view === 'issues' || view === 'pulls') && parts.length === 3)
    || ((view === 'issues' || view === 'pull') && parts.length === 4 && /^[1-9]\d*$/.test(parts[3]!))
    || (view === 'pull' && parts.length === 5 && /^[1-9]\d*$/.test(parts[3]!) && parts[4] === 'files');
  const wantsPage = (ctx.call.request.method === 'GET' || ctx.call.request.method === 'HEAD') && !parts[1]?.endsWith('.git')
    && (parts.length === 2 || fileRoute || workRoute) && (view === 'raw' || (ctx.call.request.headers.get('accept') ?? '').includes('text/html'));
  if (!wantsPage) return gitScreen(ctx);
  const [owner, name] = parts as [string, string];
  const repo = repoNamed(ctx, owner, name);
  if (!repo || repo.deleted === true) return refused(404, 'Not Found');
  const login = person(ctx);
  const role = login ? roleIn(ctx, repo, { kind: 'user', login, scopes: '*', token: '' }) : undefined;
  if (repo.private === true && !role) return refused(404, 'Not Found');
  const full = String(repo.full_name);
  const now = Date.parse(ctx.occurredAt) / 1000;
  const issues = ctx.rowsRaw('issue').filter((i) => i._repo === full && i.deleted !== true);
  const openIssues = issues.filter((i) => !i.pull_request && i.state === 'open').length;
  const openPulls = issues.filter((i) => Boolean(i.pull_request) && i.state === 'open').length;
  const base = ctx.publicBase.replace(/\/$/, '');
  const repoPath = `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const here = (suffix = ''): string => `${base}${repoPath}${suffix}`;
  const tab = view === 'issues' ? 'Issues' : view === 'pulls' || view === 'pull' ? 'Pull requests' : 'Code';
  const tabs: Array<[string, number | undefined, string | undefined]> = [['Code', undefined, ''], ['Issues', openIssues, '/issues'], ['Pull requests', openPulls, '/pulls'], ['Actions', undefined, undefined], ['Projects', undefined, undefined], ['Security', undefined, undefined], ['Insights', undefined, undefined], ...(role === 'admin' ? [['Settings', undefined, undefined] as [string, undefined, undefined]] : [])];
  const header = <div className="head">
    <div className="title"><Icon d={icon.repo} /><span className="owner">{String((repo.owner as Row).login)}</span><span className="muted">/</span><a className="name" href={here()}>{String(repo.name)}</a><span className="label">{repo.private === true ? 'Private' : 'Public'}</span></div>
    <nav className="tabs" aria-label="Repository">{tabs.map(([t, n, suffix]) => suffix !== undefined
      ? <a key={t} href={here(suffix)} className={tab === t ? 'on' : undefined} aria-current={tab === t ? 'page' : undefined}>{t}{n ? <span className="count">{n}</span> : null}</a>
      : <button key={t} disabled title={`${t} is not available in this mirror`}>{t}</button>)}</nav>
  </div>;
  // source: https://docs.github.com/en/get-started/using-github/communicating-on-github "In the Conversation tab of the pull request, the author explains why they created the pull request."
  // The public examples establish the title/state, conversation cards, metadata sidebar and Files changed layout.
  // UI mutation, reviews and checks are outside this slice; no successful action or check is invented for them.
  if (workRoute) {
    const isPull = view === 'pulls' || view === 'pull';
    const listPath = isPull ? '/pulls' : '/issues';
    const link = (i: Row): string => here(`/${i.pull_request ? 'pull' : 'issues'}/${Number(i.number)}`);
    const atTime = (value: unknown): string => ago(now, Date.parse(String(value)) / 1000);
    const user = (i: Row): string => String((i.user as Row | undefined)?.login ?? '');
    const labels = (i: Row) => ((i.labels as Row[] | undefined) ?? []).map((l) => <span key={String(l.id ?? l.name)} className="label">{String(l.name)}</span>);
    if (parts.length === 3) {
      const closed = /\bis:closed\b/.test(url.searchParams.get('q') ?? '');
      const all = issues.filter((i) => Boolean(i.pull_request) === isPull);
      const selected = all.filter((i) => i.state === (closed ? 'closed' : 'open')).sort((a, b) => Number(b.number) - Number(a.number));
      const body = <>{header}<main className="body work">
        <div className="box">
          <nav className="work-list-head" aria-label={`${tab} state`}>
            <a href={here(listPath)} aria-current={!closed ? 'page' : undefined}>{all.filter((i) => i.state === 'open').length} Open</a>
            <a href={here(`${listPath}?q=${encodeURIComponent(`is:${isPull ? 'pr' : 'issue'} is:closed`)}`)} aria-current={closed ? 'page' : undefined}>{all.filter((i) => i.state === 'closed').length} Closed</a>
          </nav>
          {selected.length ? selected.map((i) => <article className="work-item" key={String(i.id)}>
            <span className={`state-dot${closed ? ' closed' : ''}`} aria-hidden="true" />
            <div><h2><a href={link(i)}>{String(i.title)}</a></h2>{labels(i)}<span className="muted">#{Number(i.number)} {closed ? 'closed' : 'opened'} {atTime(closed ? i.closed_at ?? i.updated_at : i.created_at)} by {user(i)}</span></div>
            {Number(i.comments) > 0 ? <span className="muted">{Number(i.comments)} {Number(i.comments) === 1 ? 'comment' : 'comments'}</span> : null}
          </article>) : <div className="empty"><h2>No {closed ? 'closed' : 'open'} {isPull ? 'pull requests' : 'issues'}</h2><p className="muted">{closed ? 'Closed' : 'Open'} {isPull ? 'pull requests' : 'issues'} will appear here.</p></div>}
        </div>
      </main></>;
      return flowPage({ title: `${tab} · ${full}`, css: [CSS], body });
    }
    const issue = issueByNumber(ctx, repo, parts[3]);
    const pull = isPull ? pullByNumber(ctx, repo, parts[3]) : undefined;
    if (!issue || issue.deleted === true || Boolean(issue.pull_request) !== isPull || (isPull && (!pull || pull.deleted === true))) return refused(404, 'Not Found');
    const record = pull ?? issue;
    const comments = ctx.rowsRaw('issue_comment').filter((c) => c._repo === full && c._issue === String(issue.number) && c.deleted !== true).sort((a, b) => Number(a.id) - Number(b.id));
    const state = pull?.merged === true ? 'Merged' : record.state === 'closed' ? 'Closed' : pull?.draft === true ? 'Draft' : 'Open';
    const stateClass = state === 'Closed' || state === 'Merged' ? 'closed' : state === 'Draft' ? 'draft' : '';
    const card = (c: Row, original = false) => <article className="box" id={original ? 'issue-body' : `issuecomment-${String(c.id)}`} key={String(c.id)}>
      <div className="comment-head"><b>{user(c)}</b><span className="muted">commented {atTime(c.created_at)}</span>{c.author_association && c.author_association !== 'NONE' ? <span className="label">{String(c.author_association).toLowerCase()}</span> : null}</div>
      <div className="markdown comment-body" dangerouslySetInnerHTML={{ __html: markdownHtml(String(c.body ?? '*No description provided.*')) }} />
    </article>;
    const assignees = (issue.assignees as Row[] | undefined) ?? [];
    const milestone = issue.milestone as Row | undefined;
    const filesView = parts[4] === 'files';
    // GitHub's published comparison uses the merge base; reuse the kernel comparison used by the pack's API.
    const diff = filesView && pull ? await (async () => {
      const { store } = gitOf(ctx, repo);
      const base = String((pull.base as Row).sha), head = String((pull.head as Row).sha);
      return git.diffFiles(store, (await git.mergeBase(store, base, head)) ?? base, head, { patch: true });
    })() : undefined;
    if (filesView && diff === null) return refused(404, 'Not Found');
    const body = <>{header}<main className="body work">
      <div className="conversation-heading">
        <h1>{String(record.title)} <span className="muted">#{Number(issue.number)}</span></h1>
        <span className={`state-pill ${stateClass}`}>{state}</span>
        {pull ? <span className="muted"><b>{user(record)}</b> {pull.merged === true ? 'merged' : 'wants to merge'} {Number(pull.commits ?? 0)} {Number(pull.commits) === 1 ? 'commit' : 'commits'} into <code>{String((pull.base as Row).label)}</code> from <code>{String((pull.head as Row).label)}</code></span>
          : <span className="muted"><b>{user(issue)}</b> opened this issue {atTime(issue.created_at)} · {comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>}
      </div>
      {pull ? <nav className="conversation-tabs" aria-label="Pull request">
        <a href={here(`/pull/${Number(issue.number)}`)} aria-current={!filesView ? 'page' : undefined}>Conversation <span className="count">{comments.length + 1}</span></a>
        <button disabled title="Commits is not available in this mirror">Commits <span className="count">{Number(pull.commits)}</span></button>
        <button disabled title="Checks is not available in this mirror">Checks</button>
        <a href={here(`/pull/${Number(issue.number)}/files`)} aria-current={filesView ? 'page' : undefined}>Files changed <span className="count">{Number(pull.changed_files)}</span></a>
      </nav> : null}
      {filesView ? <section aria-label="Files changed">
        <div className="patch-summary"><b>{diff?.length ?? 0} changed {diff?.length === 1 ? 'file' : 'files'}</b><span>+{diff?.reduce((n, f) => n + f.additions, 0)} −{diff?.reduce((n, f) => n + f.deletions, 0)}</span><button className="btn green" disabled title="Submitting reviews is not available in this mirror">Review changes</button></div>
        {diff?.map((f) => <article className="box" key={f.filename}>
          <div className="file-head"><b>{f.filename}</b><span className="muted">{f.status} · +{f.additions} −{f.deletions}</span></div>
          {f.patch !== undefined ? <pre className="patch">{f.patch.split('\n').map((line, i) => <code key={i} className={line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : undefined}>{line}</code>)}</pre> : <div className="empty muted">No text patch is available for this file.</div>}
        </article>)}
        {!diff?.length ? <p className="muted">No changed files in this comparison.</p> : null}
      </section> : <div className="conversation-grid">
        <section aria-label="Conversation">{card(record, true)}{comments.map((c) => card(c))}</section>
        <aside aria-label="Issue metadata">
          <section><h2>Assignees</h2>{assignees.length ? assignees.map((a) => <div key={String(a.login)}>{String(a.login)}</div>) : <span className="muted">No one assigned</span>}</section>
          <section><h2>Labels</h2>{(issue.labels as Row[] | undefined)?.length ? labels(issue) : <span className="muted">None yet</span>}</section>
          <section><h2>Milestone</h2>{milestone ? String(milestone.title) : <span className="muted">No milestone</span>}</section>
        </aside>
      </div>}
    </main></>;
    return flowPage({ title: `${String(record.title)} · ${isPull ? 'Pull request' : 'Issue'} #${Number(issue.number)} · ${full}`, css: [CSS], body });
  }
  const { store, refs } = gitOf(ctx, repo);
  let branch = String(repo.default_branch ?? 'main');
  const all = refs.list();
  const branchNames = all.filter((r) => r.name.startsWith('refs/heads/')).map((r) => r.name.slice('refs/heads/'.length)).sort();
  const branches = all.filter((r) => r.name.startsWith('refs/heads/')).length;
  const tags = all.filter((r) => r.name.startsWith('refs/tags/')).length;

  // the branch's history, newest first along its first parents: the latest commit, how many there are, and for each
  // entry at the root the newest commit that changed it
  let tip = refs.get(`refs/heads/${branch}`);
  let path = '';
  if (fileRoute) {
    tip = null;
    const rest = parts.slice(3);
    // Branch names can contain slashes: use the longest existing branch prefix, as the raw-content screen does.
    for (let n = rest.length; n > 0 && !tip; n -= 1) {
      const candidate = rest.slice(0, n).join('/');
      tip = refs.get(`refs/heads/${candidate}`) ?? (/^[0-9a-f]{40}$/.test(candidate) ? candidate : null);
      if (tip) { branch = candidate; path = rest.slice(n).join('/'); }
    }
    if (!tip) return refused(404, 'Not Found');
  }
  const at = (kind: 'tree' | 'blob' | 'raw', item = '', ref = branch): string => here(`/${kind}/${encodeURIComponent(ref)}${item ? '/' + item.split('/').map(encodeURIComponent).join('/') : ''}`);
  const objectAt = async (commit: git.Commit, item: string): Promise<Awaited<ReturnType<typeof store.read>>> => {
    let object = await store.read(commit.tree);
    for (const part of item.split('/').filter(Boolean)) {
      if (object?.type !== 'tree') return null;
      const entry = git.decodeTree(object.payload).find((e) => e.name === part);
      if (!entry || entry.mode === '160000') return null;
      object = await store.read(entry.sha);
    }
    return object;
  };
  const tipObject = tip ? await store.read(tip) : null;
  if (fileRoute && tipObject?.type !== 'commit') return refused(404, 'Not Found');
  const selected = tipObject?.type === 'commit' ? await objectAt(git.decodeCommit(tipObject.payload), path) : null;
  if (fileRoute && (view === 'tree' ? selected?.type !== 'tree' : selected?.type !== 'blob')) return refused(404, 'Not Found');
  if (view === 'raw' && selected?.type === 'blob') return new Response(selected.payload as Uint8Array<ArrayBuffer>, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' },
  });
  const file = selected?.type === 'blob' ? selected.payload : undefined;
  let latest: { sha: string; c: git.Commit } | undefined;
  let entries: git.TreeEntry[] = [];
  const touched = new Map<string, { sha: string; c: git.Commit }>();
  let commits = 0;
  const treeOf = async (commit: git.Commit): Promise<Map<string, string>> => {
    const t = await objectAt(commit, file ? path.split('/').slice(0, -1).join('/') : path);
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
        const t = await objectAt(c, file ? path.split('/').slice(0, -1).join('/') : path);
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
  const readmeEntry = file ? undefined : path ? readmeIn(entries) : readmeIn(await folder('.github')) ?? readmeIn(entries) ?? readmeIn(await folder('docs'));
  const readmeBlob = readmeEntry ? await store.read(readmeEntry.sha) : undefined;
  const readmeText = readmeBlob?.type === 'blob' ? new TextDecoder().decode(readmeBlob.payload) : undefined;
  const firstLine = (c: git.Commit): string => c.message.split('\n')[0] ?? '';

  const body = (
    <>
      {header}
      <main className="body">
        <div className={file ? 'file-view' : undefined}>
          <div className="bar">
            <details className="branch"><summary className="btn"><Icon d={icon.branch} />{branch} ▾</summary><div className="branch-menu" aria-label="Branches"><b>Switch branches</b>{branchNames.map((ref) => <a key={ref} href={at('tree', '', ref)} aria-current={ref === branch ? 'true' : undefined}>{ref}</a>)}</div></details>
            <span className="muted"><Icon d={icon.branch} /> <b>{branches}</b> {branches === 1 ? 'Branch' : 'Branches'}</span>
            <span className="muted"><b>{tags}</b> {tags === 1 ? 'Tag' : 'Tags'}</span>
            <button className="btn green" disabled title="The clone dropdown is not available in this mirror">Code</button>
          </div>
          {path ? <nav className="breadcrumbs" aria-label="File path"><a href={at('tree')}>{String(repo.name)}</a>{path.split('/').map((part, i, parts) => <span key={i}> / {i < parts.length - 1 ? <a href={at('tree', parts.slice(0, i + 1).join('/'))}>{part}</a> : <b>{part}</b>}</span>)}</nav> : null}
          {file ? <div className="box"><div className="file-head"><Icon d={icon.file} /><b>{path.split('/').at(-1)}</b><span className="muted">{file.length} bytes</span><button className="btn" disabled title="Blame is not available in this mirror">Blame</button><a className="btn raw" href={at('raw', path)}>Raw</a></div>{file.includes(0) ? <div className="empty muted">Binary file. <a href={at('raw', path)}>View raw content</a></div> : /\.(md|markdown)$/i.test(path) ? <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(new TextDecoder().decode(file)) }} /> : <pre className="source">{new TextDecoder().decode(file).split('\n').map((line, i) => <span className="line" id={`L${i + 1}`} key={i}><a className="line-no" href={`#L${i + 1}`}>{i + 1}</a><code>{line}</code></span>)}</pre>}</div> : latest ? (
            <div className="box">
              <div className="latest">
                <span className="avatar" aria-hidden="true" /><b>{latest.c.author.name}</b>
                <span className="msg">{firstLine(latest.c)}</span>
                <span className="muted">{latest.sha.slice(0, 7)} · {ago(now, latest.c.committer.time)}</span>
                <span className="muted"><Icon d={icon.history} /> <b>{commits}{commits >= LIMIT ? '+' : ''}</b> {commits === 1 ? 'Commit' : 'Commits'}</span>
              </div>
              <table className="files"><tbody>
                {path ? <tr><td className="name" colSpan={3}><a href={at('tree', path.split('/').slice(0, -1).join('/'))}>..</a></td></tr> : null}
                {listed.map((e) => {
                  const last = touched.get(e.name);
                  return (
                    <tr key={e.name} className={isDir(e.mode) ? 'dir' : 'file'}>
                      <td className="name"><Icon d={isDir(e.mode) ? icon.dir : icon.file} /> {e.mode === '160000' ? <span title="Submodule navigation is not available">{e.name}</span> : <a href={at(isDir(e.mode) ? 'tree' : 'blob', path ? `${path}/${e.name}` : e.name)}>{e.name}</a>}</td>
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
        {!file ? <aside className="about">
          <h2>About</h2>
          {typeof repo.description === 'string' && repo.description ? <p>{repo.description}</p> : <p className="muted">No description, website, or topics provided.</p>}
          {typeof repo.homepage === 'string' && repo.homepage ? <p><a href={repo.homepage}>{repo.homepage.replace(/^https?:\/\//, '')}</a></p> : null}
          {Array.isArray(repo.topics) && repo.topics.length ? <div className="topics">{(repo.topics as string[]).map((t) => <span key={t} className="topic">{t}</span>)}</div> : null}
          {readmeText !== undefined ? <div className="line"><Icon d={icon.book} />Readme</div> : null}
          <div className="line"><b>{Number(repo.stargazers_count ?? 0)}</b> stars</div>
          <div className="line"><b>{Number(repo.watchers_count ?? 0)}</b> watching</div>
          <div className="line"><b>{Number(repo.forks_count ?? 0)}</b> forks</div>
        </aside> : null}
      </main>
    </>
  );
  return flowPage({ title: `${full}${typeof repo.description === 'string' && repo.description ? `: ${repo.description}` : ''}`, css: [CSS], body });
}
