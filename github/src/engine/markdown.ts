// A README rendered as GitHub renders Markdown for the API's HTML media type
// (https://docs.github.com/en/rest/repos/contents#get-a-repository-readme, "application/vnd.github.html+json: Returns
// the README in HTML"), within the GitHub Flavored Markdown a README holds: headings, paragraphs, emphasis, inline code
// and fenced code, lists, block quotes, rules, links and images, and the HTML a README carries as it is. An image off
// GitHub is served through its camo proxy (`data-canonical-src` keeping the original address); a relative one is left
// as written. Pure computation: the proxy's digest is the caller's.

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The anchor GitHub gives a heading: its text lower-cased, spaces as hyphens, punctuation dropped. */
const slugOf = (text: string): string => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');

/** One line's inline Markdown as HTML: code spans, images, links, bold and italics; HTML tags passed as they are. */
function inline(text: string, camo: (url: string) => string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => { codes.push(`<code>${escape(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  // the HTML a README writes is kept; the rest of the text escaped
  s = s.split(/(<[^>]+>)/g).map((part, i) => (i % 2 ? part : part.replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/</g, '&lt;'))).join('');
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_, alt: string, src: string, title?: string) => {
    const off = /^https?:\/\//.test(src);
    const img = `<img src="${escape(off ? camo(src) : src)}" alt="${escape(alt)}"${title ? ` title="${escape(title)}"` : ''}${off ? ` data-canonical-src="${escape(src)}"` : ''} style="max-width: 100%;">`;
    return off ? `<a target="_blank" rel="noopener noreferrer nofollow" href="${escape(camo(src))}">${img}</a>` : `<a target="_blank" rel="noopener noreferrer" href="${escape(src)}">${img}</a>`;
  });
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_, label: string, href: string, title?: string) => `<a href="${escape(href)}"${/^https?:\/\//.test(href) ? ' rel="nofollow"' : ''}${title ? ` title="${escape(title)}"` : ''}>${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a?: string, b?: string) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\*)|(^|\W)_([^_\s][^_]*)_(?!\w)/g, (_, p1?: string, a?: string, p2?: string, b?: string) => `${p1 ?? p2 ?? ''}<em>${a ?? b}</em>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => codes[Number(n)]!);
}

/** A Markdown document as GitHub's README HTML: the rendered body inside GitHub's README wrapper. */
export function renderReadme(markdown: string, path: string, camo: (url: string) => string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;
  let quote: string[] = [];
  const flushPara = (): void => { if (para.length) out.push(`<p dir="auto">${para.map((l) => inline(l, camo)).join('\n')}</p>`); para = []; };
  const flushList = (): void => { if (list) out.push(`<${list.tag} dir="auto">\n${list.items.map((i) => `<li>${inline(i, camo)}</li>`).join('\n')}\n</${list.tag}>`); list = undefined; };
  const flushQuote = (): void => { if (quote.length) out.push(`<blockquote>\n<p dir="auto">${quote.map((l) => inline(l, camo)).join('\n')}</p>\n</blockquote>`); quote = []; };
  const flush = (): void => { flushPara(); flushList(); flushQuote(); };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fence = /^(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i += 1; i < lines.length && !lines[i]!.startsWith(fence[1]!); i += 1) body.push(lines[i]!);
      const lang = fence[2];
      out.push(`<div class="highlight${lang ? ` highlight-source-${lang}` : ''} notranslate position-relative overflow-auto" dir="auto"><pre>${escape(body.join('\n'))}</pre></div>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const n = heading[1]!.length;
      const text = inline(heading[2]!, camo);
      out.push(`<div class="markdown-heading" dir="auto"><h${n} tabindex="-1" class="heading-element" dir="auto">${text}</h${n}><a id="user-content-${slugOf(heading[2]!)}" class="anchor" aria-label="Permalink: ${escape(heading[2]!.replace(/<[^>]+>/g, ''))}" href="#${slugOf(heading[2]!)}"></a></div>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushPara(); flushQuote();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((bullet ?? ordered)![1]!);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushPara(); flushList(); quote.push(q[1]!); continue; }
    if (!line.trim()) { flush(); continue; }
    if (/^\s*<[a-zA-Z/!]/.test(line) && !para.length) { flush(); out.push(line); continue; }
    flushList(); flushQuote();
    para.push(line.trim());
  }
  flush();
  return `<div id="readme" class="md" data-path="${escape(path)}"><article class="markdown-body entry-content container-lg" itemprop="text">${out.join('\n')}</article></div>`;
}
