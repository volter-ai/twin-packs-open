// No demanded application calls Intercom. Every spec operation answers the vendor-shaped gap.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'intercom', service: 'intercom', body: { json: 'always' }, ids: { template: '{uuid}' }, time: 'unix',
  // source: spec:/components/schemas/error "The API will return an Error List for a failed request"
  error: { type: 'error.list', request_id: '{id}', errors: [{ code: '{code}', message: '{message}' }] },
  readOnly: { status: 403, message: 'This World is read-only.', code: 'forbidden' },
  // source: spec:/paths/~1articles~1{article_id}/get/responses/404 "Resource Not Found"
  // source: https://developers.intercom.com/docs/references/2.6/rest-api/notes/create-note-for-contact "Resource Not Found"
  // The vendor documents this not-found class, not separate words for every unknown path.
  notFound: { status: 404, message: 'Resource Not Found', code: 'not_found' },
  gap: { status: 404, message: 'Resource Not Found', code: 'not_found' },
  // source: https://developers.intercom.com/docs/build-an-integration/learn-more/authentication "provide it as an Authorization:Bearer header"
  // source: spec:/paths/~1articles~1{article_id}/get/responses/401 "Access Token Invalid"
  // Where documentation stops: Authentication and endpoint 401 responses are documented, but precedence on unknown routes is not; the gap stands.
  auth: { header: 'authorization', scheme: 'Bearer', gateWhenAbsent: true, exempt: ['exchangeOAuthCode'],
    missing: { status: 401, code: 'unauthorized', message: 'Access Token Invalid' },
    invalid: { status: 401, code: 'unauthorized', message: 'Access Token Invalid' }, invalidKeys: ['invalid'] },
  deleted: {}, resources: {},
  unmodeled: ["listAdmins", "retrieveAdmin", "setAwayAdmin", "listActivityLogs", "listContentImportSources", "createContentImportSource", "getContentImportSource", "updateContentImportSource", "deleteContentImportSource", "listExternalPages", "createExternalPage", "getExternalPage", "updateExternalPage", "deleteExternalPage", "listArticles", "createArticle", "retrieveArticle", "updateArticle", "deleteArticle", "searchArticles", "exchangeOAuthCode", "listAwayStatusReasons", "listCalls", "showCall", "showCallRecording", "showCallTranscript", "listCallsWithTranscripts", "retrieveCompany", "createOrUpdateCompany", "RetrieveACompanyById", "UpdateCompany", "deleteCompany", "ListAttachedContacts", "ListAttachedSegmentsForCompanies", "listAllCompanies", "scrollOverAllCompanies", "ListContacts", "CreateContact", "ShowContact", "UpdateContact", "DeleteContact", "ArchiveContact", "BlockContact", "listCompaniesForAContact", "attachContactToACompany", "detachContactFromACompany", "listNotes", "createNote", "listSegmentsForAContact", "listSubscriptionsForAContact", "attachSubscriptionTypeToContact", "detachSubscriptionTypeToContact", "listTagsForAContact", "attachTagToContact", "detachTagFromContact", "UnarchiveContact", "ShowContactByExternalId", "MergeContact", "SearchContacts", "listConversations", "createConversation", "retrieveConversation", "updateConversation", "deleteConversation", "convertConversationToTicket", "attachContactToConversation", "detachContactFromConversation", "manageConversation", "replyConversation", "attachTagToConversation", "detachTagFromConversation", "redactConversation", "searchConversations", "getCustomObjectInstancesByExternalId", "createCustomObjectInstances", "deleteCustomObjectInstancesById", "getCustomObjectInstancesById", "deleteCustomObjectInstancesByExternalId", "lisDataAttributes", "createDataAttribute", "updateDataAttribute", "downloadDataExport", "get_download_reporting_data_job_identifier", "lisDataEvents", "createDataEvent", "dataEventSummaries", "cancelDataExport", "createDataExport", "getDataExport", "get_export_reporting_data_job_identifier", "post_export_reporting_data_enqueue", "get_export_reporting_data_get_datasets", "askFin", "listFinCapabilities", "submitFinCsat", "escalateFinConversation", "runFinProcedure", "replyToFin", "startFinConversation", "listAllCollections", "createCollection", "retrieveCollection", "updateCollection", "deleteCollection", "listHelpCenters", "retrieveHelpCenter", "listInternalArticles", "createInternalArticle", "retrieveInternalArticle", "updateInternalArticle", "deleteInternalArticle", "searchInternalArticles", "getIpAllowlist", "updateIpAllowlist", "jobsStatus", "identifyAdmin", "createMessage", "listNewsItems", "createNewsItem", "retrieveNewsItem", "updateNewsItem", "deleteNewsItem", "listNewsfeeds", "retrieveNewsfeed", "listLiveNewsfeedItems", "retrieveNote", "createPhoneSwitch", "listSegments", "retrieveSegment", "listSubscriptionTypes", "listTags", "createTag", "findTag", "deleteTag", "listTeams", "retrieveTeam", "listTicketStates", "listTicketTypes", "createTicketType", "getTicketType", "updateTicketType", "createTicketTypeAttribute", "updateTicketTypeAttribute", "createTicket", "getTicket", "updateTicket", "deleteTicket", "replyTicket", "attachTagToTicket", "detachTagFromTicket", "enqueueCreateTicket", "searchTickets", "retrieveVisitorWithUserId", "updateVisitor", "convertVisitor"],
  vendorBacked: { none: 'No vendor resource or operation is served; every spec operation answers the gap.' },
  discovery: { twinOf: 'Intercom REST API 2.14 and OAuth token exchange', stores: 'No vendor resources',
    behavior: 'Every spec operation answers the vendor-shaped gap; Cal.com and Dub integrations require opt-in.' },
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-intercom', resources: [],
    specSource: 'Intercom OpenAPI 2.14; Intercom-OpenAPI 598020b7434f5d90f2b764c8d5421f5d541d4c31; OAuth patch in spec/patches.json',
    description: 'Intercom API twin: every spec operation answers the vendor-shaped gap.',
    adoption: { sdks: ['intercom-client'], envStems: ['INTERCOM'] },
    hosts: [{ host: 'api.intercom.io' }, { host: 'app.intercom.com', pathPattern: '^/oauth', demandPathPattern: false }],
    endpointEnvNone: 'intercom-client takes its base URL in code; the optional integrations address hosts routed by the World.',
    // source: https://developers.intercom.com/docs/build-an-integration/learn-more/authentication "helper functions are provided in some of our SDKs"
    clientCasesNone: 'No demanded application calls Intercom or its official SDK; Cal.com and Dub enable their integrations only by opt-in.',
  },
};
