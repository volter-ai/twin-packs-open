// LibreChat’s shipped web search calls v2 scrape with the user’s own key; other operations answer the gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'firecrawl', service: 'firecrawl', body: { json: 'always' }, ids: { template: '{uuid}' }, time: 'iso',
  tenant: { field: '_tenant_scope', storage: 'namespaced' },
  // source: https://raw.githubusercontent.com/firecrawl/firecrawl/bca56457b0d8371f1bd903d239f487f5186b8079/apps/api/src/lib/not-found.ts "is not a Firecrawl API endpoint."
  error: { success: false, code: '{code}', error: '{message}', documentation_url: 'https://docs.firecrawl.dev/api-reference/introduction' },
  // source: https://raw.githubusercontent.com/firecrawl/firecrawl/bca56457b0d8371f1bd903d239f487f5186b8079/apps/api/src/lib/not-found.ts "nosniff"
  answerHeaders: { 'x-content-type-options': 'nosniff' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  // source: https://docs.firecrawl.dev/api-reference/introduction "The requested resource could not be located."
  notFound: { status: 404, code: 'NOT_FOUND', message: '{method} {path} is not a Firecrawl API endpoint.' },
  // The kernel fills the request's method and path in the vendor's terminal refusal.
  gap: { status: 404, code: 'NOT_FOUND', message: '{method} {path} is not a Firecrawl API endpoint.' },
  deleted: {},
  resources: {
    _team: { idPrefix: '', ids: '{uuid}', shared: true },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}' },
    _web_page: { shared: true, idPrefix: 'page_', ids: '{uuid}' },
  },
  unmodeled: ["listAgents", "startAgent", "getAgentStatus", "cancelAgent", "getAgentSnapshot", "getAgentTrace", "scrapeAndExtractFromUrls", "getBatchScrapeStatus", "cancelBatchScrape", "getBatchScrapeErrors", "crawlUrls", "getCrawlStatus", "cancelCrawl", "getCrawlErrors", "getActiveCrawls", "crawlParamsPreview", "extractData", "getExtractStatus", "submitEndpointFeedback", "listBrowserSessions", "createBrowserSession", "deleteBrowserSession", "executeBrowserCode", "mapUrls", "listMonitors", "createMonitor", "getMonitor", "updateMonitor", "deleteMonitor", "listMonitorChecks", "getMonitorCheck", "runMonitor", "parseFile", "getScrapeStatus", "interactWithScrapeBrowserSession", "stopInteractiveScrapeBrowserSession", "searchAndScrape", "submitSearchFeedback", "developerSearch", "developerSearchPost", "researchSearchPapers", "researchGetPaper", "researchRelatedPapers", "askSupportAgent", "searchSupportDocs", "getActivity", "getCreditUsage", "getHistoricalCreditUsage", "getQueueStatus", "getThreatProtection", "updateThreatProtection", "getTokenUsage", "getHistoricalTokenUsage"],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'Dashboard-issued first application credential' },
    { id: 'pages', method: 'POST', path: '/_twin/pages', note: 'Synthetic public page content; no Firecrawl operation creates web pages' },
  ],
  // source: https://docs.firecrawl.dev/api-reference/introduction "Authorization: Bearer fc-123456789"
  // source: spec:/paths/~1crawl~1params-preview/post/responses/401 "Unauthorized"
  // source: https://raw.githubusercontent.com/firecrawl/firecrawl/bca56457b0d8371f1bd903d239f487f5186b8079/apps/api/src/controllers/auth.ts "Unauthorized: Invalid token"
  // The server applies auth on its routes, not before its terminal unknown-route refusal.
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    held: { storedAs: '_api_key', hashField: 'sha256' },
    wires: [{ paths: '^/', error: { success: false, error: '{message}' } }],
    missing: { status: 401, message: 'Unauthorized' },
    invalid: { status: 401, message: 'Unauthorized: Invalid token' },
  },
  vendorBacked: { none: 'Scrape computes page content; _api_key and _web_page are World setup bookkeeping, not stored Firecrawl resources.' },
  discovery: { twinOf: 'Firecrawl API v2', stores: 'Credential hashes and synthetic public pages', behavior: 'Scrape returns held page content as markdown/rawHtml; no live web or model runs.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-firecrawl', resources: [],
    specSource: 'Firecrawl API v2 (spec/openapi.json.gz; provenance in spec/SOURCE.md)',
    description: 'Firecrawl v2 scrape for LibreChat web search; deterministic held-page content.',
    adoption: { sdks: ['@mendable/firecrawl-js'], envStems: ['FIRECRAWL'] },
    hosts: [{ host: 'api.firecrawl.dev' }],
    endpointEnvNone: 'LibreChat defaults to api.firecrawl.dev/v2/scrape; the World claims that host',
    // source: https://raw.githubusercontent.com/dubinc/dub/7e0101363b2a/apps/web/lib/ai/generate-lander.ts "apiKey: process.env.FIRECRAWL_API_KEY"
    clientCasesNone: 'LibreChat uses axios in @librechat/agents@4.0.1 FirecrawlScraper; it uses no official Firecrawl SDK.',
    credentialDoor: { account: { field: 'account', tenancy: 'team/organization', source: 'https://docs.firecrawl.dev/api-reference/introduction' }, deployment: { field: 'deployment', object: 'individual API key', source: 'https://docs.firecrawl.dev/features/key-restrictions.md' }, path: '/_twin/app-credentials', body: {}, fill: { FIRECRAWL_API_KEY: 'api_key' } },
  },
};
