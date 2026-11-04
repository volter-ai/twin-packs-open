import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'bitly', service: 'bitly',
  // Where the documentation stops: refuse undeclared mutation fields with BAD_REQUEST, including private tenancy fields.
  body: { form: { coerce: false }, strict: { status: 400, unknown: 'BAD_REQUEST', type: 'BAD_REQUEST', range: 'BAD_REQUEST', arrays: { tags: 'string' } } },
  // Where the documentation stops: deterministic local subject ids have the opaque width of the vendor's examples.
  ids: { template: '{letters:7}' },
  // source: spec:/components/schemas/DeeplinkRule "ISO timestamp"
  time: 'iso',
  // source: spec:/components/schemas/Error "message"
  error: { message: '{message}' },
  // source: spec:/components/schemas/Forbidden "FORBIDDEN"
  readOnly: { status: 403, message: 'FORBIDDEN' },
  // source: spec:/components/schemas/NotFound "NOT_FOUND"
  notFound: { status: 404, message: 'NOT_FOUND' },
  // source: spec:/components/schemas/NotFound "NOT_FOUND"
  gap: { status: 404, message: 'NOT_FOUND' },
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "Authorization: Bearer"
  auth: { header: 'authorization', scheme: 'Bearer', paths: '^/v4/', gateWhenAbsent: true,
    missing: { status: 403, message: 'FORBIDDEN' }, invalid: { status: 403, message: 'FORBIDDEN' },
    invalidKeys: ['invalid'], held: { storedAs: '_access_token', hashField: 'sha256' } },
  // source: spec:/components/parameters/Bitlink "domain and hash"
  spanning: ['bitlink'],
  // source: spec:getBitlinksByGroup "paginated collection"
  list: { style: 'envelope', envelope: { groups: '{data}' }, limit: { param: 'size', default: 50, max: 1000 } },
  deleted: {},
  // source: spec:/tags/0 "Every user will be in at least one group"
  tenant: { field: '_account' },
  resources: {
    _credential_serial: { idPrefix: '', ids: '{n}' },
    _access_token: { idPrefix: '', ids: '{uuid}' },
    // source: spec:/components/schemas/Group "guid"
    Group: { filters: ['organization_guid'], storedAs: 'group', idPrefix: 'B', ids: '{prefix}{letters:10}', idAs: 'guid', ...states.Group,
      // source: spec:getGroups "list of groups"
      refresh: { list: 'getGroups', items: 'groups', unpaginated: true } },
    // source: spec:/components/schemas/BitlinkUpdate "id"
    BitlinkBody: { storedAs: 'bitlink', idPrefix: '', ids: '{letters:7}', ...states.BitlinkBody,
      // source: spec:getBitlinksByGroup "for a group"
      parent: { param: 'group_guid', field: '_group', resource: 'Group', whenNamed: true },
      // source: spec:getBitlinksByGroup "paginated collection"
      refresh: { list: 'getBitlinksByGroup', items: 'links', next: 'pagination.search_after', cursor: 'search_after', query: { archived: 'both' } } },
    // Where the documentation stops: signup registration and link-id reservations use the kernel's atomic unique/issue seams.
    _person: { storedAs: '_person', idPrefix: 'person', ids: '{uuid}', unique: [{ fields: ['email'], refusal: { status: 400, message: 'BAD_REQUEST' } }, { fields: ['login'], refusal: { status: 400, message: 'BAD_REQUEST' } }] },
    _account_group: { storedAs: '_account_group', idPrefix: 'B', ids: '{prefix}{letters:10}', unique: [{ fields: ['email'], refusal: { status: 400, message: 'BAD_REQUEST' } }] },
    _bitlink_id: { storedAs: '_bitlink_id', idPrefix: '', ids: '{letters:7}' },
    _client: { storedAs: '_client', idPrefix: 'client', ids: '{uuid}', unique: [{ fields: ['email', 'redirect_uri'], refusal: { status: 400, message: 'BAD_REQUEST' } }] },
    _code: { storedAs: '_code', idPrefix: '', ids: '{hex:32}' },
  },
  unmodeled: ["GetGroupMetricsByReferrer", "GetGroupMetricsByReferringNetworks", "addChannelBitlinks", "addCustomBitlink", "applyTemplate", "cloneSite", "createBitlink", "createCampaign", "createChannel", "createContainer", "createQRCodePublic", "createSite", "createSiteBlock", "createSiteImage", "createStaticQRCodePublic", "createWebhook", "deleteBitlink", "deleteQRCode", "deleteSite", "deleteSiteBlock", "deleteSiteRedirect", "deleteWebhook", "discardSiteDraft", "editCustomDomain", "expandBitlink", "fetchDomainAgreements", "getAgenticTrafficForBitlink", "getAggregateSiteViewsByCity", "getAggregateSiteViewsByCountry", "getAggregateSiteViewsByDevice", "getAggregateSiteViewsByReferrer", "getAggregateSiteViewsOverTime", "getAggregateSitesOverview", "getBSDs", "getCampaign", "getCampaigns", "getChannel", "getChannels", "getClicksForBitlink", "getClicksForCustomBitlink", "getClicksSummaryForBitlink", "getCustomBitlink", "getCustomBitlinkMetricsByDestination", "getCustomDomain", "getCustomDomainDNS", "getCustomDomains", "getEngagements", "getEngagementsSummary", "getGroup", "getGroupAgenticTrafficRollup", "getGroupClicks", "getGroupCodeScansByCity", "getGroupCodeScansByCountry", "getGroupCodeScansOverTime", "getGroupFeatureUsage", "getGroupHistoricalUsage", "getGroupLinkClicksByCity", "getGroupLinkClicksByCountry", "getGroupLinkClicksByDevice", "getGroupLinkClicksByReferrer", "getGroupLinkClicksOverTime", "getGroupMetricsByCities", "getGroupMetricsByCountries", "getGroupMetricsByDevices", "getGroupMetricsOverTime", "getGroupPreferences", "getGroupShortenCounts", "getGroupTopCodeScans", "getGroupTopLinkClicks", "getGroupTopMetrics", "getLaunchpadDigitalBusinessCardDownloadsOverTime", "getLinkPerformanceForSite", "getMetricsForBitlinkByCities", "getMetricsForBitlinkByCountries", "getMetricsForBitlinkByDevices", "getMetricsForBitlinkByReferrerName", "getMetricsForBitlinkByReferrers", "getMetricsForBitlinkByReferrersByDomains", "getMetricsForBitlinkByReferringDomains", "getMetricsForSiteByCities", "getMetricsForSiteByDevices", "getMetricsForSiteByReferrers", "getMetricsForSitesByCountries", "getOAuthApp", "getOrganization", "getOrganizationShortenCounts", "getOrganizationShortenCountsByGroup", "getOrganizations", "getPlanLimits", "getQRCodeByIdPublic", "getQRCodeImagePublic", "getScanMetricsForQRCode", "getScanMetricsForQRCodeByBrowser", "getScanMetricsForQRCodeByCities", "getScanMetricsForQRCodeByCountries", "getScanMetricsForQRCodeByDevicesOS", "getScanMetricsSummaryForQRCode", "getSite", "getSiteClicksByCities", "getSiteClicksByCountries", "getSiteClicksByDevices", "getSiteClicksOverTime", "getSiteFilteredTopPageButtons", "getSitesForGroup", "getSortedBitlinks", "getTemplates", "getTopLinksAndQRCodesByEngagements", "getViewsForSite", "getViewsSummaryForSite", "getWebhook", "getWebhooks", "listQRMinimal", "postCreateGroupExport", "prevalidateYouTubeVideoButton", "publishSite", "purchaseBsd", "redirectQRCodeDestination", "searchAvailableDomains", "updateBitlinksByGroup", "updateCampaign", "updateChannel", "updateCustomBitlink", "updateGroup", "updateGroupPreferences", "updateQRCodePublic", "updateQRCodesByGroup", "updateSite", "updateSiteAppearance", "updateSiteBlock", "updateUser", "updateWebhook", "upgradeQRCodeToBitlink", "validateCustomDomain", "verifyWebhook"],
  // Documented variants outside the import and archive story remain explicit gaps.
  variants: {
    createFullBitlink: ['keyword', 'bitlink_id', 'expiration_at', 'dynamic_routing', 'deeplinks'],
    updateBitlink: ['expiration_at', 'dynamic_routing', 'deeplinks', 'long_url'],
    getGroupTags: ['type=qr_code'],
    getBitlinksByGroup: ['campaign_guid', 'channel_guid', 'launchpad_ids', 'has_qr_codes', 'is_expired', 'has_expiration', 'has_dynamic_routing', 'domain_deeplinks=on'],
    exchangeAccessToken: ['grant_type=password', 'grant_type=refresh_token'],
  },
  // source: https://dev.bitly.com/docs/getting-started/rate-limits/ "per-minute limit is one-tenth of the hourly limit"
  // Where the documentation stops: allowances vary by account. The live-call guard conservatively allows 30/hour and 3/minute.
  rateBudget: { windowMs: 3600000, ceiling: 30, burstCeiling: 3, defaultWeight: 1,
    reason: 'Bitly limits each endpoint by hour and minute; per-minute is one-tenth of hourly. Conservative local cap, not an account allowance.' },
  // source: spec:getUser "Returns information for the current authenticated user"
  refreshIdentity: { operation: 'getUser', field: 'login' },
  doors: [{ redactBody: ['password'], id: 'signup', method: 'POST', path: '/_twin/signup', note: 'Synthetic account, its first group and app registration; links are made through the API.' }],
  // source: https://dev.bitly.com/docs/getting-started/authentication/ "Redirect the user to"
  screens: [{ id: 'authorize', kind: 'flow', status: 'done', host: 'bitly.com', path: '/oauth/authorize', source: 'https://dev.bitly.com/docs/getting-started/authentication/', demand: 'Dub apps/web/lib/integrations/bitly/oauth.ts:9', takes: ['POST'] }],
  discovery: { twinOf: 'Bitly v4 and documented OAuth web flow', stores: 'Account groups and bitlinks in their vendor response shapes',
    identity: 'Held Bearer token for an account; registered client secret for code exchange', notes: 'Synthetic signup and conservative local limits; unsupported spec operations answer NOT_FOUND.' },
  descriptor: { protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-bitly', resources: ['group', 'bitlink'],
    specSource: 'spec/openapi.json from https://dev.bitly.com/v4/v4.json; cited OAuth patch in spec/patches.json',
    description: 'Bitly archive import for Dub, with hosted OAuth and cursor paging',
    adoption: { sdks: [], envStems: ['BITLY', 'BUFFER_BITLY'] },
    // source: spec:/servers/0 "api-ssl.bitly.com"
    hosts: [{ host: 'api-ssl.bitly.com' }, { host: 'bitly.com', pathPattern: '^/oauth/authorize/?$' }],
    endpointEnvNone: 'Dub uses literal vendor URLs and native fetch; the World routes them by host.',
    credentialDoor: { account: { field: 'account', tenancy: 'user/login account', source: 'https://dev.bitly.com/docs/getting-started/authentication/' }, deployment: { field: 'deployment', object: 'OAuth application with user grant', source: 'https://dev.bitly.com/docs/getting-started/authentication/' }, path: '/_twin/signup', body: {},
      fill: { BITLY_CLIENT_ID: 'client_id', BITLY_CLIENT_SECRET: 'client_secret', BUFFER_BITLY_API_KEY: 'access_token' } },
  },
};
