// Tavily's manifest: the vendor facts its spec (../spec) does not carry. Served is what the applications call
// (../journeys/demand.json): search and extract; every other operation is `unmodeled`.
//
// THE TWIN SEARCHES NO WEB AND RUNS NO MODEL: its web is the pages a World puts in (the pages door), ranked by lexical
// overlap with the query (./semantics/search.ts).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'tavily',
  service: 'tavily',
  // source: spec:search "Request validation failed. The detail array identifies invalid fields."
  body: { json: 'always', validation: {
    operations: ['search', 'extract'], status: 422,
    missing: { detail: [{ type: 'missing', loc: ['body', '{name}'], msg: 'Field required', input: '{input}' }] },
    type: { detail: [{ type: '{type}_type', loc: ['body', '{name}'], msg: 'Input should be a valid {type}', input: '{input}' }] },
    range: { detail: [{ type: 'value_error', loc: ['body', '{name}'], msg: 'Input is outside the permitted range', input: '{input}' }] },
  } },
  // source: spec:search "A unique request identifier you can share with customer support"
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: spec:/components/schemas/ApiError "error"
  error: { detail: { error: '{message}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  // Where documentation stops: no published unknown-route envelope; use the API error class at 404.
  gap: { status: 404, message: 'Not Found' },
  deleted: {},
  resources: {
    _request: { idPrefix: 'request_', refresh: { none: 'Issued request identifiers are private World bookkeeping.' } },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}', refresh: { none: 'Dashboard credentials are secret World bootstrap state, never refreshed.' } },
    _web_page: { idPrefix: 'page_', refresh: { none: 'Synthetic web corpus supplied by the World, not a Tavily stored resource.' } },
    _extract_usage: { idPrefix: 'usage_', refresh: { none: 'World bookkeeping of successful extraction credits; no vendor object is deployed.' } },
  },
  unmodeled: ['crawl', 'map', 'createResearch', 'getResearch', 'post_feedback', 'getUsage', 'post_logs'],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
    { id: 'pages', method: 'POST', path: '/_twin/pages', note: '{ url, title, content, raw_content?, text_content?, advanced_content?, summary?, images?, favicon?, topic?, published_date?, country?, language?, unsafe?, fetch_seconds? }: a page on the World\'s web' },
  ],
  discovery: {
    twinOf: "Tavily's API (api.tavily.com): search and extract",
    stores: "API keys (by their SHA-256); the World's web pages",
    behavior: "a search ranks the World's pages by lexical overlap with the query (topic, domains, time range honoured); an answer is a labeled stub; extract reads the World's pages; no web is searched and no model runs",
  },
  // source: https://docs.tavily.com/documentation/rate-limits "Development 100"
  rateBudget: { ceiling: 100, windowMs: 60000, defaultWeight: 1, rules: [], maxRetryAfterSeconds: 60, reason: 'The documented Development key allowance is 100 requests per minute.', allowance: { perMinute: 100, source: 'https://docs.tavily.com/documentation/rate-limits' } },
  vendorBacked: { none: 'Search and extraction compute answers over web pages; Tavily exposes no stored search-result resource to deploy or refresh. API keys and World pages are local bootstrap bookkeeping.' },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-tavily',
    resources: [],
    specSource: "Tavily's per-endpoint OpenAPI documents, merged (spec/openapi.json)",
    description: "Tavily twin — search over the World's web (the pages a World puts in), ranked by lexical overlap, with a labeled stub answer (no web is searched, no model runs); API keys.",
    // source: https://docs.tavily.com/documentation/quickstart.md "pip install tavily-python"
    adoption: { sdks: ['@tavily/core', '@langchain/tavily'], pypi: ['tavily-python'], envStems: ['TAVILY'] },
    hosts: [{ host: 'api.tavily.com' }],
    // source: https://raw.githubusercontent.com/LibreChat-AI/LibreChat/f10b1d91f1eee3a2c82d5247bf620351486b7c1b/api/app/clients/tools/structured/TavilySearchResults.js "const { fetch } = require('undici');"
    clientCasesNone: 'LibreChat uses raw Undici/axios; its demanded search and extraction clients do not use the official @tavily/core SDK. No official SDK behavior beyond a plain request is demanded.',
    endpointEnvNone: 'the clients call https://api.tavily.com; the World claims the host',
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { TAVILY_API_KEY: 'api_key' } },
  },
};
