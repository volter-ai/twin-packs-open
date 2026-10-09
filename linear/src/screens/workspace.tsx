// Authored by /root/journey_evidence_finish, 2026-10-09, from Linear's public help and screenshots.
// Primary visual/action references and their limits: ../../spec/screen-references.json.
// This workspace reads the same native rows as GraphQL; its property form calls the same issueUpdate action.
// source: https://linear.app/docs/my-issues "My issues"
// source: https://linear.app/docs/assigning-issues "properties sidebar"
// source: https://linear.app/docs/issue-property "team-specific"
import { GraphqlError, type HandlerContext } from '@volter/world-core';
import { flowPage, markdownHtml, redirect } from '@volter/world-ui';
import {
  browserFormKey, browserPerson, browserSignIn, COMMENT, ISSUE, issueBy, mine, ORG, PRIORITY_LABELS,
  relation, type Caller, type Row, STATE, TEAM, updateIssue, USER, visibleRows,
} from '../semantics/shared.ts';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const part = (value: unknown): string => encodeURIComponent(String(value ?? ''));
const href = (ctx: HandlerContext, path: string): string => `${ctx.publicBase}${path}`;
const urlKey = (org: Row): string => `/${part(org.urlKey)}`;
const teamPath = (org: Row, team: Row): string => `${urlKey(org)}/team/${part(team.key)}/all`;
const issuePath = (org: Row, issue: Row): string => `${urlKey(org)}/issue/${part(issue.identifier)}`;
const own = (ctx: HandlerContext, row: Row | undefined): Row => row ? ctx.own(row) : {};
const joined = (ctx: HandlerContext, c: Caller, row: Row, field: string, type: string): Row | undefined => {
  const id = relation(row, field);
  if (!id) return undefined;
  return visibleRows(ctx, type, c).find((candidate) => candidate.id === ctx.resolve(type, String(id)));
};
const date = (value: unknown): string => {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (!['GET', 'HEAD', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD, POST' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const form = new URLSearchParams(ctx.text);
  let person = browserPerson(ctx);
  if (!person) {
    if (request.method !== 'POST' || form.get('action') !== 'login') return login(ctx, path);
    const signed = await browserSignIn(ctx, form.get('email') ?? '', form.get('password') ?? '');
    if (!signed) return login(ctx, path, 'Invalid email or password', form.get('email') ?? '');
    // The next navigation reads identity from the existing HttpOnly browser session.
    return redirect(href(ctx, path), signed.cookie);
  }
  const org = ctx.row(ORG, String(person._org));
  if (!org || org.deleted === true) return message('Workspace not found', 404);
  const c: Caller = { org: String(org.id), user: String(person.id), scope: ['read', 'write'] };
  const teams = visibleRows(ctx, TEAM, c).filter((team) => !team.archivedAt).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (path === '/' || path === '/login') return redirect(href(ctx, teams[0] ? teamPath(org, teams[0]) : urlKey(org)));
  const segments = path.split('/').slice(1).map((segment) => {
    try { return decodeURIComponent(segment); } catch { return ''; }
  });
  if (segments[0] !== String(org.urlKey)) return message('Workspace not found', 404);
  if (segments.length === 1) {
    if (request.method === 'POST') return message('Unsupported workspace action', 400);
    if (teams[0]) return redirect(href(ctx, teamPath(org, teams[0])));
    return shell(ctx, org, person, teams, '', `<header class="view-header"><h1>All issues</h1></header><div class="empty"><h2>No teams yet</h2><p>This workspace has no teams.</p></div>`);
  }
  if (segments[1] === 'team' && segments[2] && segments[3] === 'all' && segments.length === 4) {
    const team = teams.find((candidate) => candidate.key === segments[2] || candidate.id === ctx.resolve(TEAM, segments[2]!));
    if (!team) return message('Team not found', 404);
    if (request.method === 'POST') return message('Unsupported issue-list action', 400);
    const rows = visibleRows(ctx, ISSUE, c).filter((issue) => ctx.resolve(TEAM, String(relation(issue, 'team'))) === team.id && !issue.archivedAt);
    return issueList(ctx, c, org, person, teams, rows, path, String(team.name), 'All issues', url.searchParams.get('q') ?? '');
  }
  if (segments[1] === 'my-issues' && segments.length <= 3) {
    const tab = segments[2] ?? 'assigned';
    if (!['assigned', 'created'].includes(tab)) return message('Issue view not found', 404);
    if (request.method === 'POST') return message('Unsupported issue-list action', 400);
    const rows = visibleRows(ctx, ISSUE, c).filter((issue) => !issue.archivedAt && ctx.resolve(USER, String(relation(issue, tab === 'assigned' ? 'assignee' : 'creator'))) === person!.id);
    return issueList(ctx, c, org, person, teams, rows, path, 'My issues', tab === 'assigned' ? 'Assigned' : 'Created', url.searchParams.get('q') ?? '', tab);
  }
  if (segments[1] === 'issue' && segments[2] && (segments.length === 3 || segments.length === 4)) {
    let issue: Row;
    try { issue = issueBy(ctx, c, segments[2]); } catch (error) {
      if (error instanceof GraphqlError) return message(error.message, 404);
      throw error;
    }
    let error = '';
    if (request.method === 'POST') {
      if (form.get('action') !== 'update' || form.get('formKey') !== browserFormKey(ctx)) return message('Unable to update issue: invalid form', 403);
      const unsupported = [...form.keys()].find((field) => !['action', 'formKey', 'stateId', 'assigneeId'].includes(field));
      if (unsupported) return message(`Unsupported issue field: ${unsupported}`, 400);
      const input: Row = {};
      if (form.has('stateId')) input.stateId = form.get('stateId');
      if (form.has('assigneeId')) input.assigneeId = form.get('assigneeId') || null;
      if (!Object.keys(input).length) return message('No issue properties supplied', 400);
      try {
        await updateIssue(ctx, c, issue.id, input);
        // The GET rereads the stored row, and GraphQL/SDK callers see that same issueUpdate effect.
        return redirect(href(ctx, issuePath(org, issue)));
      } catch (failure) {
        if (!(failure instanceof GraphqlError)) throw failure;
        error = failure.message;
      }
    }
    return issueDetail(ctx, c, org, person, teams, issue, error);
  }
  return message('Page not found', 404);
}

function login(ctx: HandlerContext, path: string, error = '', email = ''): Response {
  // The password form is the pack's existing synthetic identity door, shared with OAuth consent.
  return page('Linear', `<main class="login"><div class="login-brand">Linear</div><h1>Log in to Linear</h1>${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}<form method="post" action="${esc(href(ctx, path))}"><input type="hidden" name="action" value="login"><label>Email address<input name="email" type="email" autocomplete="username" value="${esc(email)}" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Continue</button></form></main>`, error ? 400 : 200);
}

function shell(ctx: HandlerContext, org: Row, person: Row, teams: Row[], selected: string, content: string, status = 200): Response {
  return page(`${String(org.name)} · Linear`, `<div class="workspace"><aside class="sidebar"><a class="workspace-name" href="${esc(href(ctx, urlKey(org)))}">${esc(org.name)}</a><nav aria-label="Workspace"><a class="nav-link ${selected.startsWith(`${urlKey(org)}/my-issues`) ? 'selected' : ''}" href="${esc(href(ctx, `${urlKey(org)}/my-issues/assigned`))}">My issues</a><div class="nav-heading">Your teams</div>${teams.map((team) => `<a class="nav-link ${selected === teamPath(org, team) ? 'selected' : ''}" href="${esc(href(ctx, teamPath(org, team)))}"><span class="team-key">${esc(team.key)}</span>${esc(team.name)}</a>`).join('')}</nav><div class="person"><span>${esc(person.name)}</span></div></aside><main class="main">${content}</main></div>`, status);
}

function issueList(ctx: HandlerContext, c: Caller, org: Row, person: Row, teams: Row[], rows: Row[], path: string, heading: string, label: string, query: string, tab?: string): Response {
  const filtered = rows.filter((issue) => `${String(issue.identifier)} ${String(issue.title)}`.toLowerCase().includes(query.toLowerCase()));
  const states = visibleRows(ctx, STATE, c).sort((a, b) => Number(a.position) - Number(b.position) || String(a.name).localeCompare(String(b.name)));
  const groups = [...states.map((state) => ({ state, rows: filtered.filter((issue) => ctx.resolve(STATE, String(relation(issue, 'state'))) === state.id) })), { state: undefined, rows: filtered.filter((issue) => !joined(ctx, c, issue, 'state', STATE)) }].filter((group) => group.rows.length);
  const tabs = tab ? `<nav class="tabs" aria-label="My issues"><strong>My issues</strong>${['assigned', 'created'].map((name) => `<a class="${name === tab ? 'active' : ''}" href="${esc(href(ctx, `${urlKey(org)}/my-issues/${name}`))}" ${name === tab ? 'aria-current="page"' : ''}>${name === 'assigned' ? 'Assigned' : 'Created'}</a>`).join('')}</nav>` : `<nav class="tabs" aria-label="Team issue view"><strong>All issues</strong></nav>`;
  const list = tab === 'created'
    ? filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.identifier).localeCompare(String(a.identifier))).map((row) => issueRow(ctx, c, org, row)).join('')
    : groups.map(({ state, rows: groupRows }) => `<section class="issue-group"><h2>${statusDot(own(ctx, state))}${esc(state?.name ?? 'No status')}<span class="count">${groupRows.length}</span></h2>${groupRows.sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.identifier).localeCompare(String(b.identifier))).map((row) => issueRow(ctx, c, org, row)).join('')}</section>`).join('');
  return shell(ctx, org, person, teams, path, `<header class="view-header"><h1>${esc(heading)} <span class="breadcrumb">› ${esc(label)}</span></h1></header>${tabs}<div class="list-toolbar"><form method="get" action="${esc(href(ctx, path))}"><label class="sr-only" for="issue-query">Filter issues by title or identifier</label><input id="issue-query" type="search" name="q" value="${esc(query)}" placeholder="Filter issues…"><button type="submit">Filter</button></form><span class="count">${filtered.length} ${filtered.length === 1 ? 'issue' : 'issues'}</span></div>${list || `<div class="empty"><h2>${query ? 'No matching issues' : 'No issues'}</h2><p>${query ? 'Try another title or identifier.' : tab === 'assigned' ? 'You have no assigned issues in this workspace.' : 'There are no issues in this view.'}</p></div>`}`);
}

function issueRow(ctx: HandlerContext, c: Caller, org: Row, issue: Row): string {
  const state = own(ctx, joined(ctx, c, issue, 'state', STATE));
  const assignee = own(ctx, joined(ctx, c, issue, 'assignee', USER));
  const priority = PRIORITY_LABELS[Number(issue.priority)] ?? 'No priority';
  return `<a class="issue-row" href="${esc(href(ctx, issuePath(org, issue)))}"><span class="priority" title="${esc(priority)}" aria-label="${esc(priority)}">${Number(issue.priority) ? esc(priority) : '—'}</span><span class="identifier">${esc(issue.identifier)}</span>${statusDot(state)}<span class="issue-title">${esc(issue.title)}</span><span class="assignee" title="${esc(assignee.name ?? 'No assignee')}">${assignee.id ? esc(assignee.name) : '<span class="unassigned">No assignee</span>'}</span></a>`;
}

function issueDetail(ctx: HandlerContext, c: Caller, org: Row, person: Row, teams: Row[], issue: Row, error: string): Response {
  const team = mine(ctx, c, TEAM, relation(issue, 'team'), 'Team');
  const state = joined(ctx, c, issue, 'state', STATE);
  const assignee = joined(ctx, c, issue, 'assignee', USER);
  const states = visibleRows(ctx, STATE, c).filter((row) => ctx.resolve(TEAM, String(relation(row, 'team'))) === team.id).sort((a, b) => Number(a.position) - Number(b.position));
  // The current pack models workspace ownership and one assignee, not private-team membership enforcement.
  const people = visibleRows(ctx, USER, c).filter((row) => row.active !== false && row.isAssignable !== false).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  // Preserve an existing assignee in the selector even if no longer offered for a new assignment.
  if (assignee && !people.some((row) => row.id === assignee.id)) people.unshift(assignee);
  const comments = visibleRows(ctx, COMMENT, c).filter((row) => ctx.resolve(ISSUE, String(relation(row, 'issue'))) === issue.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const activity = comments.map((comment) => {
    const author = joined(ctx, c, comment, 'user', USER);
    return `<article class="comment"><div class="comment-heading"><strong>${esc(author?.name ?? 'Unknown author')}</strong><time datetime="${esc(comment.createdAt)}">${esc(date(comment.createdAt))}</time></div><div class="markdown">${markdownHtml(String(comment.body ?? ''))}</div></article>`;
  }).join('');
  return shell(ctx, org, person, teams, teamPath(org, team), `<header class="view-header"><a href="${esc(href(ctx, teamPath(org, team)))}">${esc(team.name)}</a><span class="breadcrumb">›</span><span>${esc(issue.identifier)}</span></header><div class="detail"><article class="issue-body">${issue.archivedAt ? '<p class="notice">Archived issue</p>' : ''}${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}<h1>${esc(issue.title)}</h1><div class="description markdown">${issue.description ? markdownHtml(String(issue.description)) : '<p class="muted">No description</p>'}</div><section class="activity"><h2>Activity</h2>${activity || '<p class="muted">No comments yet</p>'}</section></article><aside class="properties" aria-label="Issue properties"><h2>Properties</h2><form method="post" action="${esc(href(ctx, issuePath(org, issue)))}"><input type="hidden" name="action" value="update"><input type="hidden" name="formKey" value="${esc(browserFormKey(ctx))}"><label>Status<select name="stateId" required>${!state ? '<option value="" selected disabled>No status</option>' : ''}${states.map((row) => `<option value="${esc(row.id)}" ${row.id === state?.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><div class="property-read"><span>Priority</span><strong>${esc(PRIORITY_LABELS[Number(issue.priority)] ?? 'No priority')}</strong></div><label>Assignee<select name="assigneeId"><option value="" ${!assignee ? 'selected' : ''}>No assignee</option>${people.map((row) => `<option value="${esc(row.id)}" ${row.id === assignee?.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label><div class="property-read"><span>Team</span><strong>${esc(team.name)}</strong></div><button type="submit" class="save">Save properties</button></form><dl class="dates">${issue.createdAt ? `<dt>Created</dt><dd><time datetime="${esc(issue.createdAt)}">${esc(date(issue.createdAt))}</time></dd>` : ''}${issue.updatedAt ? `<dt>Updated</dt><dd><time datetime="${esc(issue.updatedAt)}">${esc(date(issue.updatedAt))}</time></dd>` : ''}</dl></aside></div>`, error ? 400 : 200);
}

function statusDot(state: Row): string {
  // Colors are the actual WorkflowState.color; refuse CSS syntax beyond a hex color.
  const color = /^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(String(state.color)) ? String(state.color) : '#898a93';
  return `<span class="status-dot ${esc(['backlog', 'unstarted', 'started', 'completed', 'canceled'].includes(String(state.type)) ? state.type : 'unstarted')}" style="--state-color:${color}" aria-label="${esc(state.name ?? 'No status')}"></span>`;
}

function page(title: string, html: string, status = 200): Response {
  return flowPage({ title, css: [CSS], status, body: <div dangerouslySetInnerHTML={{ __html: html }} /> });
}
const message = (text: string, status: number): Response => page('Linear', `<main class="message"><h1>${esc(text)}</h1></main>`, status);

const CSS = `
*{box-sizing:border-box}body{margin:0;background:#0f1011;color:#e3e3e5;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit;color:inherit}button,a,input,select{outline-offset:3px}button{cursor:pointer;border:1px solid #343438;border-radius:5px;background:#202124;padding:6px 12px}button:hover{background:#2a2b2f}input,select{border:1px solid #323339;border-radius:5px;background:#17181a;padding:7px 10px}.workspace{display:flex;min-height:100vh}.sidebar{width:224px;flex-shrink:0;background:#090a0b;padding:17px 12px;display:flex;flex-direction:column;border-right:1px solid #27282b}.workspace-name{display:block;font-size:15px;font-weight:600;padding:4px 10px 21px;overflow-wrap:anywhere}.nav-link{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:5px;margin:2px 0}.nav-link:hover,.nav-link.selected{background:#222326}.nav-heading{padding:25px 10px 8px;color:#898a93;font-size:12px}.team-key{font-size:10px;min-width:29px;color:#a5a6ad;border:1px solid #343438;border-radius:4px;padding:1px 3px;text-align:center}.person{margin-top:auto;padding:28px 10px 0;display:flex;align-items:center;gap:9px;font-size:12px;color:#a5a6ad}.avatar{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;flex-shrink:0;border-radius:50%;background:#34353d;color:#d6d6dc;font-size:10px;font-weight:500}.main{flex:1;min-width:0}.view-header{height:54px;padding:0 25px;border-bottom:1px solid #27282b;display:flex;align-items:center;gap:10px}.view-header h1{font-size:13px;font-weight:500;margin:0}.breadcrumb{color:#898a93;font-weight:400}.tabs{min-height:50px;display:flex;gap:6px;align-items:center;padding:9px 25px;border-bottom:1px solid #27282b}.tabs strong{margin-right:17px;font-weight:500}.tabs a{padding:4px 12px;border:1px solid #2d2e32;border-radius:5px;color:#9899a2}.tabs a.active{background:#202124;color:#eeeeef}.list-toolbar{height:57px;padding:10px 25px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #27282b}.list-toolbar form{display:flex;gap:6px}.list-toolbar input{width:230px}.count,.muted{color:#898a93}.issue-group h2{display:flex;align-items:center;gap:9px;background:#181a1c;margin:0;padding:10px 25px;font-size:13px;font-weight:500;border-bottom:1px solid #27282b}.issue-group h2 .count{margin-left:3px}.issue-row{display:flex;align-items:center;gap:10px;min-height:43px;padding:8px 25px;border-bottom:1px solid #202124}.issue-row:hover{background:#181a1d}.priority{color:#898a93;width:49px;font-size:10px;flex-shrink:0}.identifier{color:#9899a2;min-width:66px;font-size:12px;flex-shrink:0}.issue-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.assignee{margin-left:auto}.unassigned{font-size:11px;color:#7e8089}.status-dot{display:inline-block;width:13px;height:13px;flex-shrink:0;border:2px solid var(--state-color);border-radius:50%}.status-dot.backlog{border-style:dotted}.status-dot.started{background:linear-gradient(90deg,var(--state-color) 50%,transparent 50%)}.status-dot.completed{background:var(--state-color)}.status-dot.canceled{opacity:.65}.empty{padding:80px 25px;text-align:center;color:#898a93}.empty h2{font-size:15px;font-weight:500;color:#d0d0d5}.detail{display:grid;grid-template-columns:minmax(0,1fr) 245px;min-height:calc(100vh - 54px)}.issue-body{padding:48px 48px 70px;min-width:0;max-width:1000px;width:100%;margin:auto}.issue-body>h1{font-size:23px;line-height:1.4;font-weight:600;margin:0 0 22px;color:#eeeeef}.description{min-height:145px}.markdown{font-size:14px;line-height:1.75;overflow-wrap:anywhere}.markdown p{margin:0 0 16px}.markdown a{text-decoration:underline;color:#9aa4ef}.markdown pre{overflow:auto;padding:14px;background:#18191c;border:1px solid #303136;border-radius:5px}.markdown code{font-size:12px}.markdown img{max-width:100%}.markdown table{border-collapse:collapse}.markdown td,.markdown th{border:1px solid #343438;padding:5px 8px}.activity{border-top:1px solid #27282b;margin-top:40px;padding-top:25px}.activity h2{font-size:13px;font-weight:500;margin:0 0 21px}.comment{padding:0 0 22px;margin-bottom:20px;border-bottom:1px solid #242528}.comment-heading{display:flex;align-items:center;gap:12px;font-size:12px;margin:0 0 12px}.comment-heading strong{font-weight:500}.comment-heading time{color:#898a93;font-size:11px}.properties{padding:43px 24px;border-left:1px solid #27282b;background:#101113}.properties h2{color:#898a93;font-size:12px;font-weight:500;margin:0 0 18px}.properties label,.property-read{display:block;margin-bottom:18px;font-size:12px;color:#898a93}.properties select{display:block;width:100%;margin-top:7px;color:#e3e3e5}.property-read span{display:block;margin-bottom:7px}.property-read strong{font-size:13px;font-weight:400;color:#e3e3e5}.save{width:100%;font-size:12px}.dates{margin-top:28px;font-size:11px;color:#898a93}.dates dt{margin-top:12px}.dates dd{margin:3px 0 0;color:#b3b4bc}.notice{padding:9px 12px;border:1px solid #414237;border-radius:5px;color:#c7c9b3}.error{padding:10px 12px;border:1px solid #653535;border-radius:5px;color:#f3b6b6;background:#241515}.login{max-width:380px;margin:90px auto;padding:0 24px}.login-brand{text-align:center;font-size:19px;font-weight:600;margin-bottom:38px}.login h1{text-align:center;font-size:21px;font-weight:500;margin-bottom:28px}.login label{display:block;font-size:13px;margin-bottom:18px}.login input{display:block;margin-top:7px;width:100%;padding:10px 12px}.login button{width:100%}.primary{background:#5e6ad2;border-color:#5e6ad2;color:white}.message{margin:90px auto;padding:24px;max-width:500px}.message h1{font-size:19px;font-weight:500}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.sidebar{width:185px}.issue-body{padding:35px 27px}.detail{grid-template-columns:minmax(0,1fr) 210px}.properties{padding:34px 17px}}@media(max-width:640px){.workspace{display:block}.sidebar{width:auto;min-height:0;padding:12px}.workspace-name{padding-bottom:8px}.sidebar nav{display:flex;flex-wrap:wrap;gap:3px}.nav-heading{display:none}.person{padding:7px 10px}.view-header{padding:0 17px}.tabs,.list-toolbar{padding-left:17px;padding-right:17px}.list-toolbar input{width:175px}.issue-row,.issue-group h2{padding-left:17px;padding-right:17px}.priority{display:none}.unassigned{display:none}.detail{display:flex;flex-direction:column}.issue-body{padding:30px 22px}.properties{border-left:0;border-top:1px solid #27282b;padding:25px 22px}.properties form{max-width:340px}}
.issue-body{margin:0 auto}
`;
