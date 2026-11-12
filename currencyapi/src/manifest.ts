// Demand is recorded in journeys/demand.json; retained operations still answer the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'currencyapi', service: 'currencyapi', body: {}, ids: { template: '{uuid}' }, time: 'iso',
  // source: https://currencyapi.com/docs/status-codes "Every error response contains a human-readable message"
  error: { message: '{message}' },
  readOnly: { status: 403, message: 'This World is read-only.' },
  // source: https://currencyapi.com/docs/status-codes "A 404 status code indicates that a requested endpoint does not exist."
  // The documentation specifies no unknown-endpoint message; use the documented message envelope with HTTP's Not Found.
  notFound: { status: 404, message: 'Not Found' }, gap: { status: 404, message: 'Not Found' },
  // source: https://currencyapi.com/docs/authentication "API key as GET parameter, or via request header."
  // SOURCE.md records keyless GET/POST /v1/agent/keys as 404/403; semantics/gap.ts preserves the captured POST body bytes.
  // GET was noted as HTML, but its body bytes and Content-Type were not captured; the kernel gap supplies its recorded 404 status.
  // The POST recording holds body bytes only, with no Content-Type header; no custom header is authored.
  // Where documentation stops: required credentials do not establish precedence on other unknown routes; the gap stands.
  auth: { header: 'apikey', scheme: '', also: [{ query: 'apikey' }], gateWhenAbsent: true,
    // source: https://currencyapi.com/docs/status-codes "No API key found in request"
    missing: { status: 401, message: 'No API key found in request', code: 'missing_api_key' }, invalidKeys: [],
    // source: https://currencyapi.com/docs/status-codes "Invalid authentication credentials"
    invalid: { status: 401, message: 'Invalid authentication credentials', code: 'invalid_api_key' } },
  deleted: {},
  resources: {},
  unmodeled: ['getHistorical', 'getConvert', 'getRange', 'getCurrencies', 'getCountries', 'getStatus'],
  vendorBacked: { none: 'No vendor resource is stored; the latest rates are the World\'s exchange-rate facts, and every other spec operation answers the gap.' },
  discovery: { twinOf: 'currencyapi v3 API', stores: 'No vendor resources', behavior: 'GET /v3/latest answers the World\'s exchange-rate fact for the base currency (world.json facts["exchange-rates"][<base>], as a scenario\'s fact entries move it) at the request\'s World time; every other spec operation answers the vendor-shaped gap.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-currencyapi', resources: [],
    specSource: "currencyapi's OpenAPI 3.1 document (spec/openapi.yaml), with provenance and hash in spec/SOURCE.md.",
    description: 'currencyapi API twin: the latest rates are the World\'s exchange-rate facts; every other spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ['@everapi/currencyapi-js'], pypi: ['currencyapicom'], envStems: ['CURRENCYAPI'] },
    // source: spec:/servers/0/url "https://api.currencyapi.com"
    hosts: [{ host: 'api.currencyapi.com' }],
    endpointEnvNone: 'The currencyapi clients hardcode https://api.currencyapi.com/v3 and read no base-URL env; interception uses the API host.',
    clientCasesNone: 'Demanded calls remain unserved; no SDK case is claimed for the retained gap.',
  },
};
