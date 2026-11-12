// twenty-icons: Twenty's open-source favicon provider at twenty-icons.com (github.com/twentyhq/favicon), a NestJS
// service behind Cloudflare. The surface is generated (./generated/surface.gen.json, from ../spec by twin-standard
// derive); these are the vendor facts its spec does not carry, read from the service's source at fb84fc14 and from
// the host's answers (spec/SOURCE.md).
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'twenty-icons',
  service: 'twenty-icons',
  body: { json: 'always' },
  ids: { template: '{uuid}' }, // no vendor id: the one stored type is keyed by its domain name
  time: 'iso',
  // NestJS's own answer to a route no controller declares (`Cannot GET /x`): the host answered GET
  // /https://airbnb.com and POST /airbnb.com with {"message":"Cannot <METHOD> <path>","error":"Not Found","statusCode":404}
  // (spec/SOURCE.md, Answers); the kernel's gap carries the template's fixed message, where the vendor names the route
  error: { message: '{message}', error: '{kind}', statusCode: '{status}' },
  readOnly: { status: 404, kind: 'Not Found', message: 'Not Found' }, // the vendor has no write operation to refuse
  notFound: { status: 404, kind: 'Not Found', message: 'Not Found' },
  gap: { status: 404, kind: 'Not Found', message: 'Not Found' },
  wrongMethod: { status: 404, kind: 'Not Found', message: 'Not Found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } }, // no list operation
  deleted: {},
  resources: {},
  doors: [{ id: 'declareIcons', method: 'POST', path: '/_twin/icons',
    note: 'The domains whose favicons the World knows, with the largest size each has: the vendor fetches a site\'s favicon on first request, which a World never does' }],
  discovery: {
    twinOf: 'Twenty\'s favicon provider at twenty-icons.com: a domain\'s favicon as a PNG at the supported sizes',
    stores: 'the domains the World declared known, each with its largest stored size and when it was declared; each favicon is a generated flat PNG, never a site\'s real logo',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-twenty-icons',
    resources: ['_icon'],
    specSource: 'spec/SOURCE.md: written from the vendor\'s open-source service (twentyhq/favicon at fb84fc14) and its host\'s answers',
    description: 'twenty-icons.com favicons as generated flat PNGs for the domains a World declares known, at the vendor\'s sizes; any other domain answers the vendor\'s 404',
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'twenty-icons.com' }],
    endpointEnvNone: 'Twenty builds the URL from a constant (twenty-shared TWENTY_ICONS_BASE_URL, getLogoUrlFromDomainName); no setting names the host.',
  },
};
