// What every family of Tavily's API shares: its API keys (made on app.tavily.com), its error body, and the web as the
// World knows it. THE TWIN SEARCHES NO WEB: its web is the pages a World puts in (the pages door).
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
export const PAGE = '_web_page';
const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// ── keys ───────────────────────────────────────────────────────────────────────────────────────
// source: spec:/components/securitySchemes/bearerAuth "where <token> is your Tavily API key (e.g., Bearer tvly-YOUR_API_KEY)."
// Only the tvly- prefix is documented; the throwaway key uses 32 opaque letters/digits.
// the World keeps it by its SHA-256 (the row's id is minted) and draws it from a secret it holds.

const keyValue = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> =>
  `tvly-${ctx.crypto.base62From(await ctx.secret(label), 32)}`;
export async function makeKey(ctx: HandlerContext, name: string): Promise<string> {
  const id = ctx.mint(KEY);
  const label = `tavily-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, label, created: ctx.occurredAt, sha256: sha256(ctx, key) }, id);
  return key;
}
export async function heldKey(ctx: HandlerContext, name: string): Promise<string | undefined> {
  const row = ctx.rows(KEY).find((k) => k.name === name);
  if (!row) return undefined;
  const key = await keyValue(ctx, String(row.label));
  return sha256(ctx, key) === row.sha256 ? key : inconsistentKey();
}
/** The key a request carries: `Authorization: Bearer …`, or the body's `api_key`. Where the documentation stops: the
 *  API takes the key in the body too, as LibreChat's Tavily tools send it
 *  (api/app/clients/tools/structured/TavilySearchResults.js, `api_key: this.apiKey`). */
export function keyOf(ctx: Pick<HandlerContext, 'rows' | 'crypto' | 'call' | 'body'>): { given: boolean; row?: Row } {
  const bearer = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const body = ctx.body && typeof ctx.body === 'object' ? (ctx.body as Row).api_key : undefined;
  const value = bearer ?? (typeof body === 'string' && body ? body : undefined);
  if (!value) return { given: false };
  const row = ctx.rows(KEY).find((k) => k.sha256 === sha256(ctx, value));
  return { given: true, row };
}

// source: spec:search "Bad Request - Your request is invalid."
/** Tavily's error body: `{detail: {error}}`. */
export const tavilyError = (status: number, error: string): Response => Response.json({ detail: { error } }, { status });

// ── the World's web ────────────────────────────────────────────────────────────────────────────

export const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// Page URLs have passed the pages door's http(s) validation.
export const hostOf = (url: string): string => new URL(url).hostname.replace(/^www\./, '');

// source: spec:search "Chunks are short content snippets (maximum 500 characters each) pulled directly from the source."
// The deterministic corpus has paragraph chunks; lexical relevance stands in for Tavily's semantic relevance.
export function chunks(content: string, query: string, limit: number): string {
  const terms = new Set(words(query));
  return content.split(/\n\s*\n/).flatMap((p) => p.match(/[\s\S]{1,500}/g) ?? [])
    .map((text, i) => ({ text, i, score: words(text).filter((w) => terms.has(w)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((c) => c.text).join(' [...] ');
}

// source: spec:extract "returns plain text"
// The pages door accepts the cleaned Markdown plus an optional exact text rendering; this fallback removes formatting.
export const plain = (content: string): string => content.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/^[#>]+\s*/gm, '').replace(/[*_`]/g, '');
export const pageContent = (p: Row, format: unknown, advanced = false): string => {
  const markdown = String((advanced ? p.advanced_content : undefined) ?? p.raw_content ?? p.content);
  return format === 'text' ? String(p.text_content ?? plain(markdown)) : markdown;
};
// source: spec:search "Accepts an ISO 639-1 code"
export const languageMatches = (held: unknown, asked: unknown): boolean => {
  const code = String(held ?? '').toLowerCase();
  const name = /^[a-z]{2}(?:-[a-z]{2})?$/.test(code) ? new Intl.DisplayNames(['en'], { type: 'language' }).of(code) : code;
  return [code, String(name).toLowerCase()].includes(String(asked).toLowerCase());
};
export const pageImages = (p: Row): Row[] => (Array.isArray(p.images) ? p.images : []).map((i) => typeof i === 'string' ? { url: i, description: '' } : i as Row);

// source: spec:extract "A list of URLs that could not be processed."
// Held synthetic pages are lookup fixtures. All other destinations go through the World's vendor-call boundary.
export async function webPage(ctx: HandlerContext, url: string): Promise<Row | undefined> {
  const held = ctx.rows(PAGE).find((p) => p.url === url);
  if (held) return held;
  try {
    const response = await ctx.vendorFetch(url);
    if (!response.ok) return undefined;
    const content = await response.text();
    return { url, content, raw_content: content };
  } catch {
    // Headers may arrive before the source disconnects; a failed body read is a failed extraction too.
    // source: spec:extract "A list of URLs that could not be processed."
    return undefined;
  }
}

// source: spec:search "Boost search results from a specific country."
export const countryNames: readonly string[] = ["afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia and herzegovina", "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi", "cambodia", "cameroon", "canada", "cape verde", "central african republic", "chad", "chile", "china", "colombia", "comoros", "congo", "costa rica", "croatia", "cuba", "cyprus", "czech republic", "denmark", "djibouti", "dominican republic", "ecuador", "egypt", "el salvador", "equatorial guinea", "eritrea", "estonia", "ethiopia", "fiji", "finland", "france", "gabon", "gambia", "georgia", "germany", "ghana", "greece", "guatemala", "guinea", "haiti", "honduras", "hungary", "iceland", "india", "indonesia", "iran", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kuwait", "kyrgyzstan", "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg", "madagascar", "malawi", "malaysia", "maldives", "mali", "malta", "mauritania", "mauritius", "mexico", "moldova", "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar", "namibia", "nepal", "netherlands", "new zealand", "nicaragua", "niger", "nigeria", "north korea", "north macedonia", "norway", "oman", "pakistan", "panama", "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "qatar", "romania", "russia", "rwanda", "saudi arabia", "senegal", "serbia", "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea", "south sudan", "spain", "sri lanka", "sudan", "sweden", "switzerland", "syria", "taiwan", "tajikistan", "tanzania", "thailand", "togo", "trinidad and tobago", "tunisia", "turkey", "turkmenistan", "uganda", "ukraine", "united arab emirates", "united kingdom", "united states", "uruguay", "uzbekistan", "venezuela", "vietnam", "yemen", "zambia", "zimbabwe"];

// Issued credentials are derived from the held secret; a mismatched hash indicates corrupted bookkeeping.
function inconsistentKey(): never {
  throw new Error('Tavily credential bookkeeping is inconsistent.');
}

