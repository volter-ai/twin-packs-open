import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';
export const manifest: DerivedManifest = {
  vendor: 'duckduckgo', service: 'duckduckgo',
  // The vendor GET has no body; the World's page door consumes JSON only when labeled JSON.
  body: {},
  // These identify World inputs and log times; the vendor HTML exposes neither.
  ids: { template: '{uuid}' }, time: 'iso',
  // Local World controls only. Vendor gaps use semantics/gap.ts, not this text error envelope.
  error: '{message}',
  readOnly: { status: 403, message: 'World is read-only.' },
  notFound: { status: 200, message: 'Unmodeled HTML flow; see recorded gap.' },
  // source: recording:unknown-path.headers "HTTP/2 200"
  gap: { status: 200, message: 'Recorded primary search shell.' },
  deleted: {},
  unmodeled: ['searchHtmlPost'],
  resources: {
    page: { idPrefix: 'page_', ...states.page, refresh: { none: 'No account-owned searchable-page enumeration or publishing API is established; these are external web inputs supplied through the World door.' } },
  },
  doors: [{ id: 'pages', method: 'POST', path: '/_twin/pages', note: '{html, indexText, title, href, snippet}: one searchable page result; HTML bytes become resource blobs, indexText controls the local index.' }],
  vendorBacked: { none: 'Search reads external web inputs; this pack sends no stored vendor mutation.' },
  discovery: {
    twinOf: 'DuckDuckGo non-JavaScript HTML search result wire',
    stores: 'Searchable web pages and their HTML result blocks, supplied by the World pages door',
    identity: 'anonymous: the retained successful requests sent no Authorization',
    notes: 'Empty-result HTML is unmodeled. Primary browser navigation replays the recorded HTTP 202 search/challenge shell with its no-script HTML link; script-driven results and solved challenges are unestablished. The HTML link uses the same World page index. Gap is the recorded HTTP 200 unknown-path shell.',
    behavior: "Twin-only headers on EVERY HTML answer: Content-Security-Policy: default-src 'none'; sandbox; Cache-Control: no-store, max-age=0; Pragma: no-cache; Expires: 0. These are World safety controls, not vendor headers. Harness body parsing is unchanged; browser scripts and external resource loads are blocked.",
  },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-duckduckgo', resources: ['page'],
    specSource: 'Retained vendor reference and four HTTP recordings; spec/SOURCE.md and spec/write-spec.ts',
    description: 'DuckDuckGo HTML result search over a World corpus and recorded Workbench HTTP 202 browser-navigation shell; script-driven results are unestablished.',
    adoption: { sdks: [], envStems: [] },
    // source: recording:results.json "html.duckduckgo.com"
    // source: https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript "regular JavaScript version"
    hosts: [{ host: 'html.duckduckgo.com' }, { host: 'duckduckgo.com' }],
    endpointEnv: { name: 'SUPERCODE_WEB_SEARCH_URL', templates: { SUPERCODE_WEB_SEARCH_URL: '${url}/html/' }, note: 'Harness reads its documented full search endpoint; the World preserves the DuckDuckGo HTML path. Workbench navigation uses host substitution.' },
  },
};
