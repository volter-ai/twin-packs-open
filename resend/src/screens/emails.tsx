// Resend's read-only Emails workspace: the list and a selected email's details. The World authorizes its operator
// pages; this screen creates no Resend account or login and changes no API credential or routing rule.
// source: https://resend.com/docs/dashboard/emails/manage-emails "Select any email to view its details."
// source: https://resend.com/docs/dashboard/emails/manage-emails "Preview, Plain Text, and HTML"
// source: https://resend.com/changelog/list-sent-emails-endpoint "filters and sorting options"
import type { HandlerContext } from '@volter/world-core';
import { EMAIL, emailView, KEY, type Row } from '../semantics/shared.ts';
import { addresses, at, Badge, dateLabel, detailPath, page, statusLabel } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const stored = ctx.rowsRaw(EMAIL).filter((email) => email.deleted !== true);
  // Resend's team selector chooses a team already represented by this World's keys or emails. No team is fabricated.
  const teams = [...new Set([...ctx.rowsRaw(KEY), ...stored].map((row) => String(row._team ?? '')).filter(Boolean))].sort();
  const team = url.searchParams.get('team') || (teams.includes('World') ? 'World' : teams[0] ?? '');
  if (team && !teams.includes(team)) return page(ctx, 'Emails', teams, team, <p role="alert">Team not found</p>, 404);
  // The API's same kernel rows, ordering and vendor projection; no separate inbox, log fold or delivery inference.
  const emails = stored.filter((email) => email._team === team).reverse()
    .sort((a, b) => String(b._created_iso ?? b.created_at).localeCompare(String(a._created_iso ?? a.created_at)))
    .map((email) => emailView(ctx.own(email)));
  if (path === '/emails') return listing(ctx, url, teams, team, emails);
  const selected = /^\/emails\/([^/]+)$/.exec(path);
  let id = '';
  try { id = selected ? decodeURIComponent(selected[1]!) : ''; } catch { /* vendor's missing record page */ }
  const email = emails.find((row) => row.id === id);
  if (!email) return page(ctx, 'Email details', teams, team, <><a className="re-back" href={at(ctx, `/emails?${new URLSearchParams({ team })}`)}>Back to Emails</a><p role="alert">Email not found</p></>, 404);
  return details(ctx, url, teams, team, email);
}

function listing(ctx: HandlerContext, url: URL, teams: string[], team: string, emails: Row[]): Response {
  const query = url.searchParams.get('query') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const needle = query.toLowerCase();
  const rows = emails.filter((email) => (!status || email.last_event === status) && (!needle ||
    [email.id, email.subject, email.from, addresses(email.to)].some((value) => String(value ?? '').toLowerCase().includes(needle))));
  const statuses = [...new Set(emails.map((email) => String(email.last_event ?? '')).filter(Boolean))].sort();
  return page(ctx, 'Emails', teams, team, <>
    <form className="re-filters" method="get" action={at(ctx, '/emails')}>
      <input type="hidden" name="team" value={team}/>
      <input className="re-search" type="search" name="query" aria-label="Search emails" placeholder="Search..." defaultValue={query}/>
      <select name="status" aria-label="Email status" defaultValue={status}><option value="">All Statuses</option>{statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select>
      <button type="submit">Search</button>
    </form>
    <div className="re-table-scroll"><table><thead><tr><th>To</th><th>Status</th><th>Subject</th><th>Created</th></tr></thead><tbody>
      {rows.map((email) => <tr key={String(email.id)}>
        <td className="re-recipient"><a href={at(ctx, detailPath(email.id, team))}>{addresses(email.to)}</a></td>
        <td><Badge value={email.last_event}/></td>
        <td className="re-subject"><a href={at(ctx, detailPath(email.id, team))}>{String(email.subject ?? '') || '(No subject)'}</a></td>
        <td className="re-date">{dateLabel(email.created_at)} UTC</td>
      </tr>)}
      {!rows.length ? <tr><td colSpan={4} className="re-empty">{emails.length ? 'No emails match your search.' : 'No emails yet.'}</td></tr> : null}
    </tbody></table></div><p className="re-muted">{rows.length} {rows.length === 1 ? 'email' : 'emails'}</p>
  </>);
}

function details(ctx: HandlerContext, url: URL, teams: string[], team: string, email: Row): Response {
  const view = ['preview', 'text', 'html'].includes(url.searchParams.get('view') ?? '') ? url.searchParams.get('view')! : 'preview';
  // A recorded transition's time and state, read through the kernel's native history. No open/click totals or invented events.
  const events = ctx.history(EMAIL, String(email.id)).filter((entry) => typeof entry.fields?.last_event === 'string');
  const text = typeof email.text === 'string' ? email.text : '';
  const html = typeof email.html === 'string' ? email.html : '';
  // Native browser isolation, not a custom HTML parser: the sandbox grants no scripts, forms or origin privileges,
  // and CSP precedes the stored HTML and refuses all external assets. React escapes the srcDoc attribute and code views.
  const preview = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"></head><body>${html}</body></html>`;
  const field = (label: string, value: unknown, code = false) => <div><dt>{label}</dt><dd>{code ? <code>{String(value ?? '') || '—'}</code> : String(value ?? '') || '—'}</dd></div>;
  return page(ctx, 'Email details', teams, team, <>
    <a className="re-back" href={at(ctx, `/emails?${new URLSearchParams({ team })}`)}>Back to Emails</a>
    <dl className="re-details">
      {field('From', email.from)}{field('Subject', email.subject)}{field('To', addresses(email.to))}{field('Reply-to', addresses(email.reply_to))}
      {addresses(email.cc) ? field('Cc', addresses(email.cc)) : null}{addresses(email.bcc) ? field('Bcc', addresses(email.bcc)) : null}
      <div><dt>Status</dt><dd><Badge value={email.last_event}/></dd></div>{field('Created', `${dateLabel(email.created_at)} UTC`)}
      {field('Email ID', email.id, true)}{field('Message-ID', email.message_id, true)}
      {email.scheduled_at ? field('Scheduled', `${dateLabel(email.scheduled_at)} UTC`) : null}
      {Array.isArray(email.tags) && email.tags.length ? field('Tags', email.tags.map((tag) => `${String((tag as Row).name)}: ${String((tag as Row).value)}`).join(', ')) : null}
    </dl>
    {events.length ? <section aria-label="Email events"><h2>Email events</h2><ol className="re-events">{events.map((event, index) => <li key={index}><Badge value={event.fields!.last_event}/><span className="re-date">{dateLabel(event.occurredAt)} UTC</span></li>)}</ol></section> : null}
    <section className="re-content" aria-label="Email content"><nav className="re-tabs" aria-label="Email formats">
      {([['preview', 'Preview'], ['text', 'Plain Text'], ['html', 'HTML']] as const).map(([key, label]) => <a key={key} href={at(ctx, detailPath(email.id, team, key))} aria-current={view === key ? 'page' : undefined}>{label}</a>)}
    </nav>
      {view === 'preview' ? html ? <iframe className="re-preview" title="Email preview" sandbox="" srcDoc={preview}/> : <pre className="re-code">{text || 'No content available.'}</pre> :
        <pre className="re-code">{(view === 'html' ? html : text) || (view === 'html' ? 'No HTML content.' : 'No plain text content.')}</pre>}
    </section>
  </>);
}
