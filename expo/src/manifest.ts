// Expo's manifest: the vendor facts its spec (../spec, written from the push service's reference page) does not carry.
// Served is what RH2 call (../journeys/demand.json): sending pushes and reading their receipts.
// The World's phones are doors: an app installed on a device is given a push token; what a device was sent is read
// back from it.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'expo',
  service: 'expo',
  body: { json: 'always' },
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "The Expo Push Service also optionally accepts gzip-compressed request bodies"
  encodings: { request: ['gzip'] },
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "Each push ticket contains a ticket ID, which you later use to look up a push receipt"
  vendorBacked: { none: 'The push gateway exposes transient tickets and receipts, no stored account resources or list/refresh API. Simulated provider queues and phones are private World bookkeeping; this pack does not deploy pushes to real devices.' },
  unmodeled: [],
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "data contains a mapping of receipt IDs to receipts"
  reads: ["pushGetReceipts"],
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "the errors field will be an array of error objects"
  error: { errors: [{ code: '{code}', message: '{message}' }] },
  readOnly: { status: 403, code: 'FORBIDDEN', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
  gap: { status: 404, code: 'NOT_FOUND', message: 'Not found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  resources: {
    // one per recipient: its ticket's id, the message as sent, and its receipt once delivered
    _notification: { idPrefix: '', ...states._notification },
    // an app installed on a phone, and the push token Expo gave it
    _device: { idPrefix: '', ...states._device },
  },
  doors: [
    { id: 'devices', method: 'POST', path: '/_twin/devices', note: '{ project, platform, owner? }: an app installs on a phone and registers for pushes; answers its Expo push token' },
    { id: 'uninstall', method: 'POST', path: '/_twin/devices/{token}/uninstall', note: 'the app is uninstalled: the token no longer reaches a device' },
    { id: 'inbox', method: 'GET', path: '/_twin/devices/{token}/notifications', note: 'what the phone was shown, newest first' },
  ],
  discovery: {
    twinOf: "Expo's push notification service: sending notifications to Expo push tokens (tickets) and reading their receipts",
    stores: 'the phones an app is installed on and their push tokens, and the simulated provider queue with its receipts',
    identity: 'no authentication (the push service needs none unless a project turns on enhanced security)',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-expo',
    resources: [],
    specSource: 'written from the push service reference page on docs.expo.dev (spec/openapi.json, provenance in spec/SOURCE.md)',
    description: "Expo push twin — sending notifications to Expo push tokens (tickets, one project per request, up to 100) and reading their receipts, delivered on the World clock, as RH2 call it.",
    adoption: { sdks: ['expo-server-sdk'], pypi: ['exponent-server-sdk'], envStems: ['EXPO_ACCESS'] },
    clientCasesNone: 'RH2, the one demanded caller, sends its pushes with fetch, not expo-server-sdk (apps/rh2/src/notify/away.ts:367, 34fdc937); expo-notifications runs on the phone, not against this API, so no official SDK behavior is relied on.',
    hosts: [{ host: 'exp.host', pathPattern: '^/--/api/v2/push/' }],
    // expo-server-sdk sends through its own Undici agent, below the World's request rewriting; it reads its base URL from
    // EXPO_BASE_URL, which the World sets to the twin
    // source: https://raw.githubusercontent.com/expo/expo-server-sdk-node/main/src/ExpoClientValues.ts "process.env['EXPO_BASE_URL'] || 'https://exp.host'"
    endpointEnv: { name: 'EXPO_BASE_URL', note: "expo-server-sdk reads its base URL from EXPO_BASE_URL, so its own Undici client reaches the twin" },
  },
};
