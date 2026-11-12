// HyperDX's External API v2 (../spec: packages/api/openapi.json), as an engineer reads an incident with a personal API
// key: the team's sources (listSources, getSource) and the raw logs and traces of a source (searchEvents), read from
// the records the ingest lane keeps. Every other operation (alerts, charts, connections, dashboards, saved searches,
// webhooks, the team, and writing sources) answers the gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'hyperdx',
  service: 'hyperdx',
  // the search reads its JSON body itself (./semantics/search.ts), as the API's validation does
  body: {},
  ids: { template: '{uuid}' },
  time: 'iso',
  // A path the API's routers do not hold falls through Express to its final handler: 404 with an HTML page naming the
  // method and the path. Where the kernel stops: the page is answered with the XML content type the kernel gives a
  // document error, not text/html. The API's own refusals are `{ message }` (./semantics/shared.ts message).
  // source: https://raw.githubusercontent.com/pillarjs/finalhandler/v1.3.2/index.js "msg = 'Cannot ' + req.method + ' ' + encodeUrl(getResourceName(req))"
  // source: https://raw.githubusercontent.com/pillarjs/finalhandler/v1.3.2/index.js "function createHtmlDocument (message) {"
  error: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>{message}</pre>\n</body>\n</html>\n',
  gap: { status: 404, message: 'Cannot {method} {path}' },
  notFound: { status: 404, message: 'Cannot {method} {path}' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  // Every router of the External API runs the access-key check before its routes: no Bearer key, or one no user holds,
  // is answered 401 with Express's plain status text, before the route (served or the gap) is reached. A path under
  // /api/v2 that no router claims is not checked.
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/index.ts "router.use('/search', defaultRateLimiter, validateUserAccessKey, searchRouter);"
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/middleware/auth.ts "return res.sendStatus(401);"
  // source: https://raw.githubusercontent.com/expressjs/express/v4.22.1/lib/response.js "var body = statuses.message[statusCode] || String(statusCode)"
  auth: {
    header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, invalidKeys: [],
    paths: '^/api/v2(/(alerts|charts|connections|dashboards|sources|saved-searches|search|webhooks|team)(/.*)?)?/?$',
    wires: [{ paths: '^/', error: '{message}' }],
    missing: { status: 401, message: 'Unauthorized' },
    invalid: { status: 401, message: 'Unauthorized' },
    // the World's personal API keys, held by their SHA-256 (./semantics/doors.ts)
    held: { storedAs: '_access_key', hashField: 'sha256' },
  },
  // a search is a POST that only reads: a read-only World answers it
  reads: ['searchEvents'],
  // The SQL where language is a documented option no demanded reader uses; it answers the gap.
  // source: spec:/components/schemas/SearchRequest/properties/whereLanguage "Language used for the where filter. Default is lucene."
  variants: { searchEvents: ['whereLanguage=sql'] },
  deleted: {},
  resources: {},
  // the World's doors (./semantics/doors.ts): what HyperDX's team sign-up and settings do that its API does not
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World's team, its ingestion API key and the application's personal API key, the same at every boot" },
  ],
  vendorBacked: { none: "The External API is read here, never deployed: every operation that changes HyperDX answers the gap, and its search answers a projection of the ingest's records into ClickHouse columns, from which the records cannot be made again." },
  discovery: {
    twinOf: "HyperDX's External API v2 (api.hyperdx.io): the team's sources and the search over its logs and traces, read with a personal API key",
    stores: 'the team and its personal API keys (by their SHA-256); it reads the spans and log records the ingest lane keeps',
  },
};
