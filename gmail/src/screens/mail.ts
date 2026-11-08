// Gmail's webmail (mail.google.com/mail): the signed-in person's inbox, one message with its links, and its attachments,
// under the person's Google session (googleoauth's SID cookie, read through the kernel's cross-pack read: ADR 0032 §2).
// A browser with no Google session is sent to Google's sign-in, which returns it here.
//
//   GET /mail, /mail/u/0/                          the inbox, newest first
//   GET /mail/u/0/inbox/<id>                       one message: its sender, recipients, subject and body, links followable
//   GET /mail/u/0/inbox/<id>/attachments/<index>   one attachment's bytes, downloaded
//
// Where the documentation stops: Gmail draws its pages in the browser and names a message in the page's fragment
// (`#inbox/<id>`); the twin renders each on the server at a path of its own, so a person (or a walk) opens and clicks it
// as a page. A message's HTML is sanitized on the server by the kernel's HTML grammar and shown inline in the message
// body, as Gmail shows it, its links opening a new tab; the body is the containing boundary of everything it draws.
// Composing, replying, labels, search and the other folders are not built.
import { html, type HandlerContext } from '@volter/world-core';
import { MESSAGE, type Row, signedInAccount } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type HtmlNode = Awaited<ReturnType<typeof html.parseFragment>>[number];
type HtmlElement = Extract<HtmlNode, { type: 'element' }>;

// What Gmail keeps of a received message (ADR 0032 §4): these elements go with their content; these are kept; any other
// element is unwrapped, its children kept. Only these attributes stay, so no received class or id poses as the
// webmail's own element.
const DROPPED = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'head', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'textarea', 'option', 'template', 'noscript', 'svg', 'math', 'video', 'audio', 'source', 'track', 'canvas']);
const KEPT = new Set(['a', 'abbr', 'address', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'tt', 'u', 'ul', 'wbr']);
const ATTRIBUTES = new Set(['href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'color', 'face', 'size', 'dir', 'lang', 'style']);

/** A style attribute as Gmail keeps it (ADR 0032 §4): without a remote load, a script or positioning, for an ordinary
 *  spelling. This is fidelity with Gmail, not the boundary: the message body contains whatever a style draws (BODY) and
 *  the page's CSP refuses every load, so an escaped spelling this misses stays inside the body and loads nothing. */
const style = (value: string): string => value.split(';').map((declaration) => declaration.trim()).filter((declaration) => {
  if (!declaration) return false;
  const lower = declaration.toLowerCase();
  if (lower.includes('url(') || lower.includes('expression(') || lower.includes('@import')) return false;
  const property = lower.slice(0, lower.indexOf(':') === -1 ? lower.length : lower.indexOf(':')).trim();
  return property !== 'position' && property !== 'behavior' && property !== '-moz-binding';
}).join('; ');

// The message body is the containing boundary of what the message draws: paint containment makes it the containing
// block of every positioned descendant, `position: fixed` included, and clips what they paint to it (CSS Containment
// Level 2 §3.3, https://www.w3.org/TR/css-contain-2/#containment-paint); its own stacking context keeps the message's
// z-index inside it.
const BODY = 'contain:paint;overflow:hidden;isolation:isolate;position:relative';

const scheme = (value: string): string => { try { return new URL(value).protocol; } catch { return ''; } };

function keep(nodes: HtmlNode[]): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') { out.push(node); continue; }
    if (DROPPED.has(node.name)) continue;
    const children = keep(node.children);
    if (!KEPT.has(node.name)) { out.push(...children); continue; }
    const attributes: HtmlElement['attributes'] = [];
    for (const { name, value, namespace } of node.attributes) {
      // a namespaced attribute (xlink:href, xml:lang) is no attribute the message's HTML keeps
      if (namespace || !ATTRIBUTES.has(name)) continue;
      if (name === 'href' && !['http:', 'https:', 'mailto:'].includes(scheme(value))) continue;
      if (name === 'src' && !(node.name === 'img' && scheme(value) === 'data:')) continue;
      if (name === 'style') { const kept = style(value); if (kept) attributes.push({ name, value: kept }); continue; }
      attributes.push({ name, value });
    }
    if (node.name === 'a') attributes.push({ name: 'target', value: '_blank' }, { name: 'rel', value: 'noreferrer noopener' });
    out.push({ type: 'element', name: node.name, namespace: node.namespace, attributes, children });
  }
  return out;
}

/** A received message's HTML as Gmail shows it (ADR 0032 §4): sanitized on the server and shown inline in its body. */
async function sanitized(source: string): Promise<string> {
  return html.serialize(keep(await html.parseFragment(source)));
}

/** A plain-text body with its addresses followable, as Gmail links them. */
const linked = (text: string): string => esc(text).replace(/https?:\/\/[^\s<>"']+/g, (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`);

const when = (iso: unknown): string => {
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
};

function page(ctx: HandlerContext, title: string, email: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;font:14px/1.45 Roboto,Arial,sans-serif;background:#f6f8fc;color:#1f1f1f}header{display:flex;justify-content:space-between;align-items:center;padding:12px 20px}header .brand{font-size:22px;color:#444746}header .who{color:#444746}nav{position:absolute;width:220px;padding:8px 12px}nav a{display:block;padding:6px 16px;border-radius:16px;background:#d3e3fd;color:#001d35;font-weight:600;text-decoration:none}main{margin-left:244px;margin-right:16px;background:#fff;border-radius:16px;min-height:70vh;padding:8px 0}.row{display:grid;grid-template-columns:200px 1fr 120px;gap:12px;padding:10px 20px;border-bottom:1px solid #f1f3f4;color:inherit;text-decoration:none}.row.unread{font-weight:700}.row .date{text-align:right;color:#5e5e5e}.msg{padding:12px 24px}.msg h2.hP{font-size:22px;font-weight:400;margin:8px 0 16px}.meta{color:#5e5e5e;margin-bottom:16px}.body{border-top:1px solid #f1f3f4;padding-top:16px;overflow-wrap:anywhere;${BODY}}.body pre{white-space:pre-wrap;font:inherit}.files{margin-top:24px;display:flex;gap:12px;flex-wrap:wrap}.files a{border:1px solid #dadce0;border-radius:8px;padding:10px 14px;color:#1f1f1f;text-decoration:none}.empty{padding:24px}</style></head><body><header><span class="brand">Gmail</span><span class="who">${esc(email)}</span></header><nav><a href="${ctx.publicBase}/mail/u/0/" aria-current="page">Inbox</a></nav><main>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const url = new URL(request.url);
  const who = signedInAccount(ctx);
  if (!who) {
    // to Google's sign-in, which returns the person to the page they asked for
    const back = `https://mail.google.com${url.pathname}${url.search}`;
    return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/ServiceLogin?${new URLSearchParams({ service: 'mail', continue: back })}` } });
  }
  const mine = ctx.rowsRaw(MESSAGE).filter((m) => m.mailbox === who && m.deleted !== true)
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)) || String(b.id).localeCompare(String(a.id)));
  const path = url.pathname.replace(/\/+$/, '');
  const opened = /^\/mail\/u\/0\/inbox\/([^/]+)(?:\/attachments\/(\d+))?$/.exec(path);
  if (!opened) {
    if (path !== '/mail' && path !== '/mail/u/0') return page(ctx, 'Gmail', who, '<p class="empty" role="alert">Temporary Error (404)</p>', 404);
    const rows = mine.map((m) => `<a class="row${(m.labelIds as string[] | undefined)?.includes('UNREAD') ? ' unread' : ''}" href="${ctx.publicBase}/mail/u/0/inbox/${encodeURIComponent(String(m.id))}"><span class="from">${esc(m.from || (m.envelope as Row | undefined)?.from)}</span><span class="subject">${esc(m.subject || '(no subject)')}</span><span class="date">${esc(when(m.receivedAt))}</span></a>`).join('');
    return page(ctx, `Inbox - ${who} - Gmail`, who, rows || '<p class="empty">Your Primary tab is empty.</p>');
  }
  let id = '';
  try { id = decodeURIComponent(opened[1]!); } catch { /* no such message */ }
  const m = mine.find((x) => x.id === id);
  if (!m) return page(ctx, 'Gmail', who, '<p class="empty" role="alert">That message could not be found.</p>', 404);
  const files = (m.attachments as Row[] | undefined) ?? [];
  if (opened[2] !== undefined) {
    const index = Number(opened[2]);
    const key = (m._attachments as string[] | undefined)?.[index];
    const meta = files[index];
    const bytes = key === undefined ? undefined : await ctx.blobs.get(key);
    if (!meta || !bytes) return page(ctx, 'Gmail', who, '<p class="empty" role="alert">That attachment could not be found.</p>', 404);
    const name = String(meta.filename ?? `attachment-${index}`).replace(/["\r\n\\]/g, '');
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': String(meta.contentType ?? 'application/octet-stream'), 'content-disposition': `attachment; filename="${name}"` } });
  }
  const body = typeof m.html === 'string' && m.html ? await sanitized(m.html) : `<pre>${linked(String(m.text ?? ''))}</pre>`;
  const list = files.map((f, i) => `<a href="${ctx.publicBase}/mail/u/0/inbox/${encodeURIComponent(String(m.id))}/attachments/${i}" download="${esc(f.filename ?? '')}">${esc(f.filename ?? `attachment ${i + 1}`)} <small>Download</small></a>`).join('');
  return page(ctx, `${String(m.subject ?? '(no subject)')} - ${who} - Gmail`, who,
    `<article class="msg"><h2 class="hP">${esc(m.subject || '(no subject)')}</h2><div class="meta"><strong>${esc(m.from)}</strong> to ${esc(((m.to as string[] | undefined) ?? []).join(', ') || who)} · ${esc(when(m.receivedAt))}</div><div class="body a3s">${body}</div>${list ? `<div class="files" aria-label="Attachments">${list}</div>` : ''}</article>`);
}
