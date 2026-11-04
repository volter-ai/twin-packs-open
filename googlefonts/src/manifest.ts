// Google Fonts: one store, with catalog, browser-selected CSS and font-file lanes.
import type { VendorManifest } from '@volter/world-core';
export const manifest: VendorManifest = {
  vendor: 'googlefonts',
  discovery: { twinOf: 'Google Fonts Developer API, the CSS and CSS2 APIs and the font URLs they return',
    stores: 'published vendor-shaped font items, exact browser CSS, font blobs and World-issued key hashes' },
  lanes: { routes: [
    { lane: 'css', host: '^fonts[.]googleapis[.]com$' },
    { lane: 'assets', host: '^fonts[.]gstatic[.]com$' },
    { lane: 'api', host: '^(www|webfonts)[.]googleapis[.]com$' },
  ], default: 'api' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-googlefonts',
    resources: ['webfont', '_api_key', '_font_catalog', '_stylesheet', '_font_file'],
    specSource: 'api/spec/SOURCE.md: unchanged Google Discovery; css/spec/SOURCE.md and assets/spec/SOURCE.md: Google documentation and retained font responses',
    description: 'Google Fonts catalog, exact published CSS representations and genuine font bytes; a World-issued query API key. Seed data is the attributed Antic reference catalog and the CSS2 weights 500-700 of Inter, not the complete live Google catalog.',
    adoption: { sdks: [], envStems: ['GOOGLE_FONTS'] },
    hosts: [
      { host: 'www.googleapis.com', pathPattern: '^/webfonts/v1/webfonts$' },
      { host: 'webfonts.googleapis.com', pathPattern: '^/v1/webfonts$' },
      { host: 'fonts.googleapis.com', pathPattern: '^/css2?$' },
      { host: 'fonts.gstatic.com', pathPattern: '^/(s/|l/font$)' },
    ],
    credentialDoor: { path: '/_twin/app-credentials', body: {}, account: { field: 'account', tenancy: 'Google Cloud project', source: 'https://developers.google.com/fonts/docs/developer_api' }, deployment: { field: 'deployment', object: 'Project API key', source: 'https://cloud.google.com/docs/authentication/api-keys' }, fill: { GOOGLE_FONTS_API_KEY: 'api_key' } },
    endpointEnvNone: 'Pinned helper hardcodes the vendor API and CSS hosts, then downloads their returned gstatic URLs. Scoped host routing preserves these URLs.',
  },
};
