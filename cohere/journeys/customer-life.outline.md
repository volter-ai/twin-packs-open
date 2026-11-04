# Cohere customer life

Author: `codex-demand-rule`.

The customer uses LibreChat-AI/LibreChat at `f10b1d91f1eee3a2c82d5247bf620351486b7c1b`,
with its pinned `@librechat/agents@4.0.1`. They choose Cohere in the shipped-on web-search feature and provide their own key in-app.
No operator configuration is needed: `config.ts:2421` enables the feature, and
`web.ts:386-402,476-482` resolves user selections and saved credentials.

The sole actor on Cohere's API is LibreChat's server. It uses the World-issued bearer key,
which authorizes inference requests; the World's credential door stands for dashboard key
creation. No API creates search-provider or scraper state in Cohere.

On 3 October 2026, the customer asks about a yoga studio's vinyasa classes. LibreChat's
web-search tool scrapes the studio's short page, which is one chunk. Its Cohere adapter
asks for the default top five, as `search.ts:166,221` and `rerankers.ts:269-290` do.
The answer carries original document indices and relevance scores, which the adapter
uses to select the supplied chunks, plus billed search units for its metrics.

The next day the customer returns with a parking question. The World resumes with the
same application key; LibreChat asks for its default five highlights from the single
short scraped studio page and receives its one chunk. The body always includes `top_n`, as the adapter does.

Both calls use `rerank-v3.5`, query and string documents (adapter `rerankers.ts:282-301`).
Neither call is a manufactured refusal. Missing fields, invalid options and bad credentials
are the vendor's stated-rule examples, not customer acts. The model API stores no vendor
resource and requires no refresh. The twin's answer labels its lexical stand-in; the life
checks the shape and result limit, not a claim about model quality.
