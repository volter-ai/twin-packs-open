# @volter/twin-firecrawl

The Firecrawl twin (Protocol 3), derived from Firecrawl's own v2 OpenAPI document (`spec/`), serving what the
LibreChat users call through shipped web search with their own in-app key ([journeys/demand.json](./journeys/demand.json)): scrape at `https://api.firecrawl.dev/v2/scrape`.
Every other operation is `unmodeled`.

**The twin browses no web and runs no model.** A page is one the World put in with `POST /_twin/pages {url, html, title?}`; any other fails with
`SCRAPE_ALL_ENGINES_FAILED`. It answers markdown and rawHtml (LibreChat's formats); any other format is not produced, and
`data.warning` says so.

`Authorization: Bearer fc-…`, kept by its SHA-256. The World's application is issued its key when the World boots:
`POST /_twin/app-credentials` (the descriptor's credential door) answers `FIRECRAWL_API_KEY`.
