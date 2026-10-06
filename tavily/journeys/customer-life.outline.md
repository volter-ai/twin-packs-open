# A studio researches its next announcement

Author: `Contributor 97`. Call evidence is [demand.json](./demand.json): LibreChat at `f10b1d91f1ee`. The studio supplies its Tavily key in LibreChat and chooses Tavily in its in-app scraper key dialog (ApiKeyDialog.tsx:227,330). Successful authentication selects the Tavily scraper (web.ts:536-560); Firecrawl is the fallback when no authenticated scraper is selected.

1. At 2026-01-15 11:00 UTC the World issues the dashboard key and holds the studio schedule, a coastal festival news story published 12 January, and a parking page. These doors establish the synthetic web; no real web or model runs.
2. In LibreChat the owner searches for the studio schedule with query, max_results and include_answer. Its actual fetch puts api_key in the body and X-Client-Name: librechat in the headers. The schedule leads, the festival follows, and the answer is a labeled stub. The owner then researches festival news using the same tool's topic:news/time_range:week options (TavilySearchResults.js:49,55); the dated festival story is the result.
3. The owner narrows LibreChat's research to the studio domain and requests raw content. A later search for quantum chromodynamics finds nothing in this web.
4. LibreChat's selected Tavily scraper extracts the schedule and an unavailable URL in one batch, with its actual basic-depth/include_images:false body and Bearer headers. The owner reads the schedule; the unavailable URL is a per-URL failure.

Documented invalid requests, quota failures and option replays belong to [vendor-examples.json](./vendor-examples.json), not additional acts for the customer.
