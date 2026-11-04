// Scrape: a page's content in the formats LibreChat asks for, markdown and rawHtml. THE TWIN BROWSES NO WEB AND RUNS NO
// MODEL: the page is one the World put in (the pages door); any other is not reached, and the scrape fails as one of an
// unreachable site does. Any other format is not produced, and the answer's `warning` says so.
// Where the documentation stops: the failure is a 500 with the code SCRAPE_ALL_ENGINES_FAILED, as the API answers a site
// it cannot reach.
import type { HandlerContext } from '@volter/world-core';
import { fcError, markdownOf, PAGE, type Row } from './shared.ts';

const PAGE_FORMATS = new Set(['markdown', 'rawHtml']);

function pageOf(ctx: HandlerContext, url: string): { html: string; markdown: string; title: string } | undefined {
  const held = ctx.rowsRaw(PAGE).find((p) => p.deleted !== true && p.url === url);
  if (!held) return undefined;
  const html = String(held.html);
  return { html, markdown: markdownOf(html), title: String(held.title ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '') };
}

// source: spec:scrapeAndExtractFromUrl "Scrape a single URL and optionally extract information using an LLM"
export async function scrapeAndExtractFromUrl(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url)) return fcError(400, 'Bad Request: url must be a valid http(s) URL', 'BAD_REQUEST');
  // source: https://docs.firecrawl.dev/api-reference/endpoint/scrape "markdown"
  const formats = (Array.isArray(b.formats) ? b.formats : ['markdown']).map((f) => (typeof f === 'string' ? f : String((f as Row).type ?? '')));
  const page = pageOf(ctx, b.url);
  if (!page) return fcError(500, `All scraping engines failed! The twin reaches no page outside the World: ${b.url}`, 'SCRAPE_ALL_ENGINES_FAILED');
  const skipped = formats.filter((f) => !PAGE_FORMATS.has(f));
  const data: Row = {
    ...(formats.includes('markdown') ? { markdown: page.markdown } : {}),
    ...(formats.includes('rawHtml') ? { rawHtml: page.html } : {}),
    metadata: { title: page.title, language: 'en', sourceURL: b.url, url: b.url, statusCode: 200, contentType: 'text/html', scrapeId: ctx.crypto.uuidFrom(`firecrawl-scrape:${ctx.occurredAt}:${b.url}`), proxyUsed: 'basic', cacheState: 'miss', creditsUsed: 1 },
    ...(skipped.length ? { warning: `twin: ${skipped.join(', ')} not produced; no browser or model runs` } : {}),
  };
  return Response.json({ success: true, data });
}
