// What every family of Firecrawl's API shares: its API keys (made on the dashboard; `Authorization: Bearer fc-…`), its
// error body, and the pages a scrape reads. THE TWIN BROWSES NO WEB: a page is one the World put in (the pages door).
import type { HandlerContext } from '@volter/world-core';

export function accountFor(ctx: HandlerContext): Promise<Record<string, unknown>> {
  return ctx.tenant('_team', (organization) => ctx.record('_team', { name: organization.label, owner: organization.members[0]!, members: organization.members }));
}

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
export const PAGE = '_web_page';

// Where the documentation stops: a key is `fc-` and 32 hexadecimal digits, the form the dashboard shows; the World keeps it
// by its SHA-256 and draws it from a secret it holds.
const keyValue = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> =>
  `fc-${ctx.crypto.digest('sha256', await ctx.secret(label), 'hex').slice(0, 32)}`;
export async function makeKey(ctx: HandlerContext, name: string, owner: string): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `firecrawl-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, label, _team: owner, created: ctx.occurredAt, sha256: ctx.crypto.digest('sha256', key, 'hex') }, id);
  return id;
}
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (typeof row.label !== 'string') return undefined;
  const key = await keyValue(ctx, row.label);
  return ctx.crypto.digest('sha256', key, 'hex') === row.sha256 ? key : undefined;
}
// source: spec:scrapeAndExtractFromUrl "An unexpected error occurred on the server."
/** Firecrawl's error body: `{success: false, code?, error}`. */
export const fcError = (status: number, error: string, code?: string): Response =>
  Response.json({ success: false, ...(code ? { code } : {}), error }, { status });

// ── pages ──────────────────────────────────────────────────────────────────────────────────────

/** Markdown from HTML, near enough: headings, paragraphs, links and list items kept, every other tag dropped. */
export function markdownOf(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n${'#'.repeat(Number(n))} ${t.trim()}\n`)
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h: string, t: string) => `[${t.trim()}](${h})`)
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<(p|div|br|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
