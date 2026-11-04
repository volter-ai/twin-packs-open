# Firecrawl customer life

Author: `codex-demand-rule`.

LibreChat-AI/LibreChat at `f10b1d91f1eee3a2c82d5247bf620351486b7c1b` ships web search on
(packages/data-provider/src/config.ts:2421). A user selects Firecrawl and saves their own key
(packages/api/src/web/web.ts:386-402,476-482), with no operator setup. Its pinned
@librechat/agents@4.0.1 scraper defaults to v2, markdown/rawHtml and timeout=7500
(src/tools/search/firecrawl.ts:38-47), and sends the POST at :122.

On 3 October the World issues that user's key; a synthetic studio page is placed on the World's
web because Firecrawl has no API that creates public pages. A keyless request is refused.
LibreChat scrapes the page, consuming markdown, raw HTML and the title. A page absent from the
World fails as an unreachable site; a missing URL receives the vendor's 400 class.
The customer returns the next day; the World resumes with the same application key.
No live web is browsed and no model runs. Only scrape is served.
