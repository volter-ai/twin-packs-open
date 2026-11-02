// A message as RFC 5322 and MIME make of it (its headers, its text and HTML, its attachments), from the bytes the relay
// accepted: pure, so the relay's front keeps it as one `message` subject (semantics/shared.ts `deliver`). The data
// arrives with its dot-stuffing undone (../stream.ts). Postfix adds a Received header on the way in; the World keeps the bytes as sent.
type Part = { headers: Record<string, string>; body: string };
export type Attachment = { filename: string | null; contentType: string; size: number; contentId: string | null; base64: string };
export type Parsed = { headers: Record<string, string>; subject: string; from: string; to: string[]; cc: string[]; text: string | null; html: string | null; attachments: Attachment[] };

/** Headers and body split at the first empty line; folded headers unfolded, names lowercased (RFC 5322 §2.2.3). */
// source: https://www.rfc-editor.org/rfc/rfc5322 "Unfolding is accomplished by simply removing any CRLF that is immediately followed by WSP"
function split(raw: string): Part {
  const at = raw.search(/\r?\n\r?\n/);
  const head = at < 0 ? raw : raw.slice(0, at);
  const body = at < 0 ? '' : raw.slice(at).replace(/^\r?\n\r?\n/, '');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] ??= utf8(bytesOf(line.slice(i + 1).trim()));
  }
  return { headers, body };
}

const param = (value: string, name: string): string | undefined => {
  const m = new RegExp(`;\\s*${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(value);
  const v = m?.[1] ?? m?.[2];
  return v?.startsWith("utf-8''") || v?.startsWith("UTF-8''") ? decodeURIComponent(v.slice(7)) : v;
};

const bytesOf = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);
const textFor = (b: Uint8Array, charset: string | undefined): string => { try { return new TextDecoder(charset ?? 'utf-8').decode(b); } catch { return utf8(b); } };

/** A part's body decoded by its Content-Transfer-Encoding: base64 and quoted-printable to bytes (RFC 2045 §6). */
function decoded(part: Part): Uint8Array {
  const enc = (part.headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  if (enc === 'base64') { try { return bytesOf(atob(part.body.replace(/\s+/g, ''))); } catch { return bytesOf(part.body); } }
  if (enc === 'quoted-printable') return bytesOf(part.body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16))).split('').map((c) => (c.charCodeAt(0) > 0xff ? '?' : c)).join(''));
  return bytesOf(part.body);
}

/** Encoded words in a header (`=?UTF-8?B?…?=`, `=?UTF-8?Q?…?=`), decoded (RFC 2047). */
// source: https://www.rfc-editor.org/rfc/rfc2047 "encoded-word = \"=?\" charset \"?\" encoding \"?\" encoded-text \"?=\""
export function words(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, _cs: string, e: string, t: string) => {
    try { return textFor(e.toUpperCase() === 'B' ? bytesOf(atob(t)) : bytesOf(t.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))), _cs); } catch { return t; }
  });
}

const addresses = (v: string | undefined): string[] => (v ? words(v).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim()).filter(Boolean) : []);

/** The message's parts: a multipart's each (recursively), else the one. */
function leaves(part: Part): Part[] {
  const type = part.headers['content-type'] ?? 'text/plain';
  const boundary = /^multipart\//i.test(type) ? param(type, 'boundary') : undefined;
  if (!boundary) return [part];
  const pieces = part.body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`));
  return pieces.slice(1, -1).filter((p) => p.trim()).flatMap((p) => leaves(split(p)));
}

export function parse(data: string): Parsed {
  const top = split(data);
  let text: string | null = null;
  let html: string | null = null;
  const attachments: Attachment[] = [];
  for (const leaf of leaves(top)) {
    const type = (leaf.headers['content-type'] ?? 'text/plain').split(';')[0]!.trim().toLowerCase();
    const disposition = leaf.headers['content-disposition'] ?? '';
    const filename = param(disposition, 'filename') ?? param(leaf.headers['content-type'] ?? '', 'name');
    const bytes = decoded(leaf);
    if (!/^attachment/i.test(disposition) && !filename && type === 'text/plain' && text === null) { text = textFor(bytes, param(leaf.headers['content-type'] ?? '', 'charset')); continue; }
    if (!/^attachment/i.test(disposition) && !filename && type === 'text/html' && html === null) { html = textFor(bytes, param(leaf.headers['content-type'] ?? '', 'charset')); continue; }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    attachments.push({ filename: filename ? words(filename) : null, contentType: type, size: bytes.length, contentId: leaf.headers['content-id']?.replace(/^<|>$/g, '') ?? null, base64: btoa(bin) });
  }
  return { headers: top.headers, subject: words(top.headers.subject ?? ''), from: addresses(top.headers.from)[0] ?? '', to: addresses(top.headers.to), cc: addresses(top.headers.cc), text, html, attachments };
}
