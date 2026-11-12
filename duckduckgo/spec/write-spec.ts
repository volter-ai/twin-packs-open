// Reproduce the OpenAPI from retained vendor reference bytes and recordings; no network.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const dir = import.meta.dir;
const reference = gunzipSync(readFileSync(dir + '/non-javascript.html.gz')).toString();
if (!reference.includes('two non-JavaScript versions')) throw new Error('Retained reference changed');
const records = ['results', 'random-query', 'unknown-path', 'browser-search'].map(name => JSON.parse(readFileSync(dir + '/recordings/' + name + '.json', 'utf8')));
for (const record of records.slice(0, 2)) if (!record.body.includes('result__a') || !record.body.includes('result__snippet')) throw new Error('Recorded result structure changed');
const text = { type: 'string', description: 'The vendor HTML document, not a JSON envelope.' };
const spec = {
  openapi: '3.0.3', info: { title: 'DuckDuckGo demanded search wires', version: '2026-10-03' },
  servers: [{ url: 'https://html.duckduckgo.com' }],
  paths: {
    '/html/': {
      get: { operationId: 'searchHtml', description: 'Anonymous HTML search. Successful result structure is recorded; empty-result flow is unmodeled.', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' }, description: 'The query echoed in the recorded search form.' }], responses: { '200': { description: 'Recorded result page', content: { 'text/html': { schema: text } } } } },
      post: { operationId: 'searchHtmlPost', description: 'The recorded form declares POST; no demanded caller posts it. Answer unmodeled.', responses: { default: { description: 'Not recorded', content: { 'text/html': { schema: text } } } } }
    },
    '/': { get: { operationId: 'browserSearch', servers: [{ url: 'https://duckduckgo.com' }], description: 'Workbench browser navigation: recorded HTTP 202 script-driven shell with anomaly detection and a noscript HTML link. Script-supplied results and solved challenge remain unestablished.', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }], responses: { '202': { description: 'Recorded search shell with anomalyDetectionBlock', content: { 'text/html': { schema: text } } } } } }
  }
};
writeFileSync(dir + '/openapi.json', JSON.stringify(spec, null, 2) + '\n');
