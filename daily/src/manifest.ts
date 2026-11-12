// No demanded application calls Daily. Every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'daily', service: 'daily', body: {}, ids: { template: '{uuid}' }, time: 'iso',
  // source: https://docs.daily.co/docs/rest-api/errors "The response body includes two fields:"
  error: { error: '{code}', info: '{message}' },
  defaultKind: 'invalid-request-error',
  readOnly: { status: 400, code: 'invalid-request-error', message: 'This World is read-only.' },
  // source: https://docs.daily.co/docs/rest-api/errors "Not Found — the requested resource does not exist."
  // source: recording:404-unknown-endpoint.json "api endpoint does not exist"
  notFound: { status: 404, code: 'not-found', message: 'api endpoint does not exist' },
  gap: { status: 404, code: 'not-found', message: 'api endpoint does not exist' },
  // source: https://docs.daily.co/docs/rest-api/authentication "Include your API key in the Authorization header of every request:"
  // source: recording:404-unknown-endpoint.json "api endpoint does not exist"
  // The recorded unknown path is refused before authentication.
  auth: { header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true,
    // source: https://docs.daily.co/docs/rest-api/authentication "Authorization header missing or malformed 400 authorization-header-error"
    // source: recording:400-missing-authorization.json "invalid authorization header"
    missing: { status: 400, code: 'authorization-header-error', message: 'invalid authorization header' }, invalidKeys: [],
    // source: https://docs.daily.co/docs/rest-api/authentication "API key is not valid 401 authentication-error"
    invalid: { status: 401, code: 'authentication-error', message: 'The API key is not valid.' } },
  deleted: {},
  resources: {},
  unmodeled: ['GetDomainConfig', 'SetDomainConfig', 'BatchProcessorListJobs', 'BatchProcessorSubmitJob', 'BatchProcessorGetJob', 'BatchProcessorDeleteJob', 'BatchProcessorGetJobAccessLink', 'BatchRoomCreate', 'BatchRoomDelete', 'BuyPhoneNumber', 'PinlessCallUpdate', 'ListDomainDialinConfigs', 'CreateDomainDialConfigInfo', 'GetDomainDialinConfigInfo', 'UpdateDomainDialConfigInfo', 'DeleteDomainDialinConfig', 'ListAvailableNumbers', 'ListLogs', 'ListAPILogs', 'CreateMeetingToken', 'ValidateMeetingToken', 'GetMeetingInfo', 'GetIndividualMeetingInfo', 'GetMeetingParticipants', 'GetPresence', 'PurchasedPhoneNumbers', 'ListRecordings', 'GetRecordingInfo', 'DeleteRecording', 'GetRecordingLink', 'TestOciBucket', 'ReleasePhoneNumber', 'ListRooms', 'CreateRoom', 'GetRoomConfig', 'SetRoomConfig', 'DeleteRoom', 'RoomDialOutSendDTMF', 'RoomDialOutStart', 'RoomDialOutStop', 'Eject', 'GetSessionData', 'RoomLivestreamingStart', 'RoomLivestreamingStop', 'RoomLivestreamingUpdate', 'GetRoomPresence', 'RoomRecordingsStart', 'RoomRecordingsStop', 'RoomRecordingsUpdate', 'SendAppMessage', 'SetSessionData', 'RoomSipCallTransfer', 'RoomSipRefer', 'RoomTranscriptionStart', 'RoomTranscriptionStop', 'RoomTranscriptionUpdate', 'UpdatePermissions', 'ListSipTrunks', 'CreateSipTrunk', 'GetSipTrunk', 'UpdateSipTrunk', 'DeleteSipTrunk', 'ListTranscript', 'GetTranscriptInfo', 'DeleteTranscript', 'GetTranscriptLink', 'GetWebhooks', 'CreateWebhook', 'GetWebhookConfig', 'UpdateWebhookConfig', 'DeleteWebhook'],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  discovery: { twinOf: 'Daily REST API v1', stores: 'No vendor resources', behavior: 'Every spec operation answers the vendor-shaped gap; Cal.com requires opt-in.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-daily', resources: [],
    specSource: "Daily's OpenAPI 3.0.3 document (spec/openapi.json), with provenance and hash in spec/SOURCE.md.",
    description: 'Daily REST API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { envStems: ['DAILY'] },
    // source: spec:/servers/0/url "https://api.daily.co/v1"
    hosts: [{ host: 'api.daily.co' }],
    endpointEnvNone: 'The Cal.com REST fetcher hardcodes https://api.daily.co/v1 and reads no base-URL env; interception uses the API host.',
    clientCasesNone: 'No demanded application uses Daily; Cal.com video requires opt-in and uses its own REST fetcher.',
  },
};
