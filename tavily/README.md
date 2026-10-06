# @volter/twin-tavily

Tavily Search (`POST /search`) and Extract (`POST /extract`) at `api.tavily.com`, for Postiz's shipped post-generator research and LibreChat's agent tools. Postiz's deployment key authorizes that feature; its caller is recorded in [demand.json](./journeys/demand.json). LibreChat users select and authenticate Tavily extraction in the in-app scraper key dialog; the exact caller commits are in [demand.json](./journeys/demand.json).

The World supplies a synthetic web corpus. Search ranks its pages by lexical overlap, with topic, domain restriction/preference, date, country, language, exact-phrase and safety options. It returns requested chunks, Markdown/text raw content, images/descriptions, favicon, publication date and usage. Answer and automatic-parameter judgment are scripted by the World or labeled deterministic stubs; no model or live web search runs. Advanced depth changes documented credit usage, and ultra-fast uses the corpus's supplied summary.

Extract reads held corpus pages or a source the World routes through `ctx.vendorFetch`, including the application's own pages. An unregistered, failing or simulated slow source becomes a per-URL failure. Depth selects supplied advanced content; query/chunk limits, Markdown/text, images, favicon and timeout options apply to each URL. Credit accounting follows successful extractions, in groups of five per depth.

Authentication accepts the World-issued key in `Authorization: Bearer` or `api_key` in the body. The key is held by its hash and regenerated from the World's secret. No real credentials are needed.

The doors are:

- `POST /_twin/app-credentials {}`: the dashboard's first key, returned identically on subsequent boots and wired to `TAVILY_API_KEY`.
- `POST /_twin/pages {url, title, content, ...}`: a synthetic source page; the same URL replaces its record. Optional fields are `raw_content`, `text_content`, `advanced_content`, `summary`, `images` (URLs or `{url, description}` objects), `favicon`, `topic`, `published_date`, `country`, `language` (an ISO code), `unsafe` and `fetch_seconds`. These supply facts about a source that Tavily's API cannot create.

The World scenario supports `operationEquals` and `queryEquals`, status faults in Tavily's envelope, and search judgment `{parameters: {topic?, search_depth?}, answer?}`. Explicit input overrides automatic judgment; size options stay explicit. Source pages and their metadata are supplied through the door.

Crawl, Map, Research, Feedback, Usage and Logs answer the gap: no measured caller, life act or refresh brings them into scope. This compute API has no vendor-backed deployment/refresh half; keys, corpus pages, request ids and extraction counts are private World bookkeeping. Real semantic ranking, crawling, model answers and billing are outside this deterministic corpus.

[The life](./journeys/customer-life.json), [published examples](./journeys/vendor-examples.json), [coverage](./journeys/coverage.json) and [score](./journeys/score.json) retain their measured results. SDK cases are not owed by the measured clients: LibreChat uses raw fetch/axios for both operations, without the official `@tavily/core` SDK.
