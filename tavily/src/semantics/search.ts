// A deterministic web corpus and labeled answer stubs; no web search or model executes.
import type { HandlerContext } from '@volter/world-core';
import { chunks, countryNames, hostOf, languageMatches, PAGE, pageContent, pageImages, tavilyError, words, type Row } from './shared.ts';

// source: spec:search "Execute a search query using Tavily Search."
export async function search(ctx: HandlerContext): Promise<Response> {
  const invalid = ctx.validate();
  if (invalid) return invalid;
  const input = ctx.body as Row;
  // source: spec:search "You can still set other parameters manually, and your explicit values will override the automatic ones."
  // Automatic judgment is scripted by the World; absent a script it keeps documented defaults.
  const scripted = ctx.scenario?.kind === 'handler' ? ctx.scenario.respond as Row : {};
  const b = { ...(input.auto_parameters === true ? scripted.parameters as Row : {}), ...input };
  if (!String(b.query).trim()) return tavilyError(400, 'Query is missing.');
  // source: spec:search "The category of the search."
  const topic = b.topic ?? 'general';
  if (!['general', 'news', 'finance'].includes(String(topic))) return tavilyError(400, "Invalid topic. Must be 'general', 'news' or 'finance'.");
  // source: spec:search "Controls the latency vs. relevance tradeoff"
  const depth = b.search_depth ?? 'basic';
  if (!['basic', 'advanced', 'fast', 'ultra-fast'].includes(String(depth))) return tavilyError(400, 'Invalid search_depth.');
  // source: spec:search "The maximum number of search results to return."
  const max = Number(b.max_results ?? 10);
  const include = (b.include_domains ?? []) as string[];
  const exclude = (b.exclude_domains ?? []) as string[];
  // source: spec:search "Maximum 300 domains."
  if (include.length > 300 || exclude.length > 150) return tavilyError(400, 'Too many domains.');
  // Where documentation stops: an array member of the wrong type uses the documented bad-request class.
  if ([...include, ...exclude].some((d) => typeof d !== 'string')) return tavilyError(400, 'Domains must be strings.');
  // source: spec:search "returns a 400 error."
  const mode = b.include_domains_mode ?? 'restrict';
  if (!['restrict', 'prefer'].includes(String(mode)) || (b.include_domains_mode !== undefined && !include.length)) return tavilyError(400, 'include_domains_mode requires include_domains and is restrict or prefer.');
  // source: spec:search "returns a 400 error otherwise."
  if (b.filter_by_language === true && !b.language) return tavilyError(400, 'filter_by_language requires language.');
  // source: spec:search "Available only if topic is"
  if (b.country && !countryNames.includes(String(b.country))) return tavilyError(400, 'Invalid country.');
  if (b.country && topic !== 'general') return tavilyError(400, 'country is available only with general topic.');
  // source: spec:search "Not supported for"
  if (b.safe_search === true && ['fast', 'ultra-fast'].includes(String(depth))) return tavilyError(400, 'safe_search is not supported for this search_depth.');
  // source: spec:search "The time range back from the current date"
  const ranges: Row = { day: 1, d: 1, week: 7, w: 7, month: 31, m: 31, year: 366, y: 366 };
  if (b.time_range !== undefined && b.time_range !== null && ranges[String(b.time_range)] === undefined) return tavilyError(400, 'Invalid time_range.');
  // source: spec:search "Required to be written in the format YYYY-MM-DD."
  if ([b.start_date, b.end_date].some((d) => d != null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(d)) || !Number.isFinite(Date.parse(String(d)))))) return tavilyError(400, 'Dates must be YYYY-MM-DD.');
  // source: spec:search "returns a more detailed answer."
  if (![undefined, false, true, 'basic', 'advanced'].includes(b.include_answer as never)) return tavilyError(400, 'Invalid include_answer.');
  // source: spec:search "returns the plain text from the results"
  if (![undefined, false, true, 'markdown', 'text'].includes(b.include_raw_content as never)) return tavilyError(400, 'Invalid include_raw_content.');
  const now = Date.parse(ctx.occurredAt);
  const range = ranges[String(b.time_range)];
  const after = b.start_date ? Date.parse(String(b.start_date)) : range ? now - Number(range) * 86400000 : -Infinity;
  const before = b.end_date ? Date.parse(String(b.end_date)) + 86400000 - 1 : Infinity;
  const within = (host: string, list: string[]): boolean => list.some((d) => host === d.replace(/^www\./, '') || host.endsWith(`.${d.replace(/^www\./, '')}`));
  const q = new Set(words(String(b.query)));
  // source: spec:search "Punctuation is typically ignored inside quotes."
  const phrases = [...String(b.query).matchAll(/"([^"]+)"/g)].map((m) => words(m[1]!).join(' '));
  const scored = ctx.rows(PAGE).filter((p) => topic === 'general' || p.topic === topic)
    .filter((p) => !include.length || mode === 'prefer' || within(hostOf(String(p.url)), include))
    .filter((p) => !within(hostOf(String(p.url)), exclude))
    // source: spec:search "By default, results with no detectable published date are not removed"
    .filter((p) => p.published_date ? Date.parse(String(p.published_date)) >= after && Date.parse(String(p.published_date)) <= before : b.filter_by_published_date !== true)
    .filter((p) => b.filter_by_language !== true || languageMatches(p.language, b.language))
    .filter((p) => b.safe_search !== true || p.unsafe !== true)
    .map((p, i) => {
      const text = words(`${p.title} ${p.content}`).join(' ');
      const w = new Set(words(text));
      const overlap = [...q].filter((x) => w.has(x)).length / q.size;
      // Ranking is a deterministic stand-in: preferences reorder ties before lexical relevance, never manufacture pages.
      const boost = Number(mode === 'prefer' && within(hostOf(String(p.url)), include)) + Number(Boolean(b.country) && p.country === b.country) + Number(Boolean(b.language) && languageMatches(p.language, b.language));
      return { p, i, text, boost, overlap, score: Math.round((0.1 + 0.85 * overlap) * 1e8) / 1e8 };
    }).filter((s) => s.overlap > 0 && (b.exact_match !== true || phrases.every((phrase) => ` ${s.text} `.includes(` ${phrase} `))))
    .sort((a, b) => b.boost - a.boost || b.score - a.score || a.i - b.i).slice(0, max);
  // source: spec:search "Remove results whose published date falls outside"
  const dated = topic === 'news' || b.include_published_date === true || b.filter_by_published_date === true;
  const results = scored.map(({ p, score }) => ({
    title: p.title, url: p.url, id: ctx.crypto.digest('sha256', String(p.url), 'hex').slice(0, 6),
    // source: spec:search "Returns one NLP summary per URL."
    content: depth === 'ultra-fast' ? String(p.summary ?? p.content).slice(0, 500) : chunks(pageContent(p, 'markdown'), String(b.query), Number(b.chunks_per_source ?? 3)),
    score, raw_content: b.include_raw_content ? pageContent(p, b.include_raw_content) : null,
    ...(dated ? { published_date: p.published_date ?? null } : {}),
    // source: spec:search "inside each result object with images extracted from that specific source."
    ...(b.include_images === true ? { images: pageImages(p).map((i) => b.include_image_descriptions === true ? i : i.url) } : {}),
    // source: spec:search "Whether to include the favicon URL for each result."
    ...(b.include_favicon === true && p.favicon ? { favicon: p.favicon } : {}),
  }));
  // source: spec:search "Include an LLM-generated answer to the provided query."
  // No model: a script supplies judgment, otherwise the labeled stub names available results.
  const answer = b.include_answer ? String(scripted.answer ?? `[twin-stub] No model runs; ${b.include_answer === 'advanced' ? 'detailed sources' : 'best source'} for "${b.query}": ${results.map((p) => `${p.title} (${p.url})`).join('; ') || 'none of the World pages answers the query'}.`) : undefined;
  return Response.json({ query: b.query, ...(answer !== undefined ? { answer } : {}), images: b.include_images === true ? scored.flatMap(({ p }) => pageImages(p).map((i) => b.include_image_descriptions === true ? i : i.url)) : [], results,
    response_time: 0.01, request_id: ctx.crypto.uuidFrom(`tavily-search:${await ctx.issue('_request')}`),
    // source: spec:search "Whether to include credit usage information in the response."
    ...(b.include_usage === true ? { usage: { credits: depth === 'advanced' ? 2 : 1 } } : {}),
    // source: spec:search "A dictionary of the selected auto_parameters, only shown when"
    ...(b.auto_parameters === true ? { auto_parameters: { topic, search_depth: depth } } : {}),
  });
}
