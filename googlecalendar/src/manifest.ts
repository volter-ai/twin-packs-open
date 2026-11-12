// Demand is recorded in journeys/demand.json; retained operations still answer the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'googlecalendar', service: 'googlecalendar', body: { json: 'always' },
  ids: { template: '{prefix}{n}' }, time: 'iso',
  // source: https://developers.google.com/workspace/calendar/api/guides/errors "The specified resource was not found."
  error: { error: { errors: [{ domain: '{kind}', reason: '{code}', message: '{message}' }], code: '{status}', message: '{message}' } },
  defaultKind: 'global',
  readOnly: { status: 403, code: 'forbidden', message: 'This World is read-only.' },
  // source: https://developers.google.com/workspace/calendar/api/guides/errors "404: Not Found"
  notFound: { status: 404, code: 'notFound', message: 'Not Found' },
  gap: { status: 404, code: 'notFound', message: 'Not Found' },
  // source: spec:/parameters/oauth_token "OAuth 2.0 token for the current user."
  // source: https://developers.google.com/workspace/calendar/api/guides/errors "Invalid authorization header."
  // source: https://developers.google.com/workspace/calendar/api/guides/errors "401: Invalid Credentials"
  // Where documentation stops: The 401 rule describes an invalid header or token; missing-key versus unknown-route precedence is undocumented, so the gap stands.
  auth: { header: 'authorization', scheme: 'Bearer', also: [{ query: 'oauth_token' }, { query: 'access_token' }], gateWhenAbsent: true,
    missing: { status: 401, kind: 'global', code: 'authError', message: 'Invalid Credentials' },
    invalid: { status: 401, kind: 'global', code: 'authError', message: 'Invalid Credentials' }, invalidKeys: ['invalid'] },
  deleted: {}, resources: {},
  unmodeled: ["calendar.calendars.insert", "calendar.calendars.get", "calendar.calendars.update", "calendar.calendars.patch", "calendar.calendars.delete", "calendar.acl.list", "calendar.acl.insert", "calendar.acl.get", "calendar.acl.update", "calendar.acl.patch", "calendar.acl.delete", "calendar.acl.watch", "calendar.calendars.clear", "calendar.events.list", "calendar.events.insert", "calendar.events.get", "calendar.events.update", "calendar.events.patch", "calendar.events.delete", "calendar.events.instances", "calendar.events.move", "calendar.events.import", "calendar.events.quickAdd", "calendar.events.watch", "calendar.calendars.transferOwnership", "calendar.channels.stop", "calendar.colors.get", "calendar.freebusy.query", "calendar.calendarList.list", "calendar.calendarList.insert", "calendar.calendarList.get", "calendar.calendarList.update", "calendar.calendarList.patch", "calendar.calendarList.delete", "calendar.calendarList.watch", "calendar.settings.list", "calendar.settings.get", "calendar.settings.watch"],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  discovery: { twinOf: 'Google Calendar API v3', stores: 'No vendor resources',
    behavior: 'Every spec operation answers the vendor-shaped gap; the Cal.com integration is demand and remains unserved.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-googlecalendar', resources: [],
    specSource: 'Google Calendar API v3 Discovery document, revision 20260826; provenance in spec/SOURCE.md',
    description: 'Google Calendar API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ['@googleapis/calendar'], pypi: [], envStems: ['GOOGLECALENDAR'] },
    // source: spec:/rootUrl "https://www.googleapis.com/"
    // source: spec:/servicePath "calendar/v3/"
    hosts: [{ host: 'www.googleapis.com', pathPattern: '^/(batch/)?calendar/v3(/|$)' }],
    endpointEnvNone: 'Google generated clients take rootUrl in code; the World routes the declared Calendar API paths.',
    // source: https://raw.githubusercontent.com/calcom/cal.diy/54343aa685ae8f33159d2f485ec4a57bad5c574a/.env.example "GOOGLE_API_CREDENTIALS="
    clientCasesNone: 'Demanded calls remain unserved; no SDK case is claimed for the retained gap.',
  },
};
