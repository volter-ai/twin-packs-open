// Sentry web API: application release/source-map calls, account setup, and core resource refresh reads.
// Every API path needs a scoped account token (./semantics/around.ts).
import { states } from './semantics/states.ts';
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'sentry',
  // both lanes are one service, so one store: the ingest lane writes events the API lane reads, and the doors' accounts
  // are the ingest lane's too (aws's lanes likewise)
  service: 'sentry',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // Django REST framework's error body, which Sentry's API answers with: `{"detail": ...}`
  error: { detail: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  malformedBody: { status: 400, message: 'Malformed request.' },
  notFound: { status: 404, message: 'The requested resource does not exist' },
  gap: { status: 404, message: 'The requested resource does not exist' },
  // source: https://docs.sentry.io/api/pagination/ "row offset"
  list: { style: 'envelope', envelope: '{data}', limit: { param: 'per_page', default: 100, max: 100 }, cursor: { param: 'cursor', encoding: 'offset-template', template: '0:{offset}:{reverse}', link: { previous: 'previous', next: 'next', results: 'results', cursor: 'cursor' } } },
  deleted: {},
  // the sequences the vendor numbers by (ctx.issue over each, src/semantics/shared.ts next)
  // source: spec:listOrganizations "List Your Organizations"
  // source: https://docs.sentry.io/api/pagination/ "Pagination in the API is handled via the Link header standard:"
  resources: {
    // source: https://docs.sentry.io/api/projects/create-a-new-project/ "6758470122493650"
    organization: { idPrefix: '', alternateKeys: ['slug'], ids: '{digits:16}', refresh: { list: 'listOrganizations', items: '$body', nextLink: { header: 'link', rel: 'next', query: 'cursor', when: { results: 'true' } } } },
    // source: spec:listOrganizationProjects "Return a list of projects bound to a organization"
    // source: https://docs.sentry.io/api/projects/create-a-new-project/ "6758470122493650"
    project: { idPrefix: '', alternateKeys: ['slug'], ids: '{digits:16}', parent: { param: 'organization_id_or_slug', field: '_organization', resource: 'organization' }, refresh: { list: 'listOrganizationProjects', items: '$body', nextLink: { header: 'link', rel: 'next', query: 'cursor', when: { results: 'true' } } } },
    project_key: { idPrefix: '', ids: '{hex:32}', refresh: { none: 'Client keys contain credential secrets. Credential custody keeps their secret-bearing reads out of refresh.' } },
    // source: spec:listProjectEvents "Return a list of events bound to a project."
    event: { idPrefix: '', ids: '{hex:32}', key: '{project_id_or_slug}:{event_id}', vendorUnderscored: ['_meta'], ...states.event,
      parent: { params: ['organization_id_or_slug', 'project_id_or_slug'], value: '{project_id_or_slug}', field: '_project', resource: 'project', where: { _organization: '{organization_id_or_slug}', id: '{project_id_or_slug}' }, keep: { _organization: '{organization_id_or_slug}' } },
      refresh: { get: 'getProjectEvent', known: true, params: { organization_id_or_slug: '{_organization}', project_id_or_slug: '{projectID}', event_id: '{eventID}' }, idAs: '{projectID}:{eventID}' } },
    // source: spec:getOrganizationIssue "Return details on an individual issue"
    issue: { idPrefix: '', ids: '{n}', ...states.issue, parent: { param: 'organization_id_or_slug', field: '_organization', resource: 'organization' }, refresh: { get: 'getOrganizationIssue', known: true, params: { organization_id_or_slug: '{_organization}', issue_id: '{id}' } } },
    // source: spec:listOrganizationReleases "List an Organization's Releases"
    release: { idPrefix: '', ids: '{n}', parent: { param: 'organization_id_or_slug', field: '_organization', resource: 'organization' }, refresh: { list: 'listOrganizationReleases', items: '$body', nextLink: { header: 'link', rel: 'next', query: 'cursor', when: { results: 'true' } } } },
    // source: spec:listOrganizationMonitors "Retrieve Monitors for an Organization"
    monitor: { ...states.monitor, idPrefix: '', ids: '{uuid}', parent: { param: 'organization_id_or_slug', field: '_organization', resource: 'organization' }, refresh: { list: 'listOrganizationMonitors', items: '$body', nextLink: { header: 'link', rel: 'next', query: 'cursor', when: { results: 'true' } } } },
    // source: spec:listProjectMonitorCheckins "Retrieve Check-Ins for a Monitor by Project"
    // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/monitors/serializers.py "str(obj.guid)"
    check_in: { ...states.check_in, idPrefix: '', ids: '{uuid}', parent: { params: ['organization_id_or_slug', 'project_id_or_slug', 'monitor_id_or_slug'], value: '{monitor_id_or_slug}', field: '_monitor', resource: 'monitor', where: { _organization: '{organization_id_or_slug}', 'project.id': '{project_id_or_slug}', id: '{monitor_id_or_slug}' } }, refresh: { list: 'listProjectMonitorCheckins', items: '$body', nextLink: { header: 'link', rel: 'next', query: 'cursor', when: { results: 'true' } } } },
    _seq_token: { idPrefix: '', ids: '{n}' }, _seq_event: { idPrefix: '', ids: '{n}' }, _seq_envelope: { idPrefix: '', ids: '{n}' },
  },
  unmodeled: [
    'getOrganization', 'listProjectEvents', 'getProjectRelease', 'getProjectMonitor',
    // served by no handler: called by no application here (../../journeys/demand.json)
     'updateOrganization', 'listOrganizationAIConversations',
    'retrieveOrganizationAIConversation', 'getOrganizationConfigIntegrations', 'listOrganizationDashboards',
    'createOrganizationDashboard', 'getOrganizationDashboard', 'updateOrganizationDashboard',
    'deleteOrganizationDashboard', 'listOrganizationDetectors', 'updateOrganizationDetectors',
    'deleteOrganizationDetectors', 'getOrganizationDetector', 'updateOrganizationDetector',
    'deleteOrganizationDetector', 'listOrganizationDiscoverSavedQueries', 'createOrganizationDiscoverSavedQuery',
    'getOrganizationDiscoverSavedQuery', 'updateOrganizationDiscoverSavedQuery',
    'deleteOrganizationDiscoverSavedQuery', 'listOrganizationEnvironments', 'resolveOrganizationEventId',
    'listOrganizationEventsTimeseries', 'listOrganizationEvents', 'createOrganizationExternalUser',
    'updateOrganizationExternalUser', 'deleteOrganizationExternalUser', 'listOrganizationForwarding',
    'createOrganizationForwarding', 'updateOrganizationForwarding', 'deleteOrganizationForwarding',
    'listOrganizationIssueViews', 'createOrganizationIssueView', 'listOrganizationIntegrations',
    'getOrganizationIntegration', 'deleteOrganizationIntegration', 'listOrganizationIntegrationRepositories',
    'listOrganizationIssues', 'updateOrganizationIssues', 'deleteOrganizationIssues',
    'updateOrganizationIssue', 'deleteOrganizationIssue', 'getOrganizationIssueAutofixState',
    'startOrganizationIssueAutofix', 'listOrganizationIssueEvents', 'getOrganizationIssueEvent',
    'listOrganizationIssueExternalIssues', 'deleteOrganizationIssueExternalIssue', 'listOrganizationIssueHashes',
    'listOrganizationIssueIntegrations', "Retrieve an Integration's Issue Config for an Issue",
    'Create an External Issue and Link It to an Issue', 'Link an Existing External Issue to an Issue',
    'Unlink an External Issue from an Issue', 'getOrganizationIssueTag', 'listOrganizationIssueTagValues',
    'listOrganizationMembers', 'addOrganizationMember', 'getOrganizationMember', 'updateOrganizationMember',
    'deleteOrganizationMember', 'addOrganizationMemberTeam', 'updateOrganizationMemberTeam',
    'deleteOrganizationMemberTeam',  'createOrganizationMonitor', 'getOrganizationMonitor',
    'updateOrganizationMonitor', 'deleteOrganizationMonitor', 'listOrganizationMonitorCheckins',
    'listOrganizationNotificationsActions', 'createOrganizationNotificationsAction',
    'getOrganizationNotificationsAction', 'updateOrganizationNotificationsAction',
    'deleteOrganizationNotificationsAction', 'getOrganizationPreprodArtifactInstallDetails',
    'getOrganizationPreprodArtifactSizeAnalysis', 'getOrganizationPreprodArtifactSnapshot',
    'deleteOrganizationPreprodArtifactSnapshot', 'getOrganizationPreprodArtifactSnapshotImage',
    'getOrganizationPreprodArtifactSnapshotLatestBase', 'listOrganizationProfilingChunks',
    'getOrganizationProfilingFlamegraph', 'listOrganizationProjectKeys',
    'createOrganizationProjectDetector', 'listOrganizationRelayUsage', 'listOrganizationReleaseThresholdStatuses',
     'createOrganizationRelease', 'getOrganizationRelease', 'deleteOrganizationRelease',
    "Retrieve Files Changed in a Release's Commits", 'listOrganizationReleaseCommits',
    'listOrganizationReleaseDeploys', 'createOrganizationReleaseDeploy', 'listOrganizationReleaseFiles',
    'uploadOrganizationReleaseFile', 'getOrganizationReleaseFile', 'updateOrganizationReleaseFile',
    'deleteOrganizationReleaseFile', 'getOrganizationReplayCount', 'listOrganizationReplaySelectors',
    'listOrganizationReplays', 'getOrganizationReplay', 'listOrganizationRepoCommits', 'listOrganizationScimV2Groups',
    'provisionOrganizationScimV2Group', 'getOrganizationScimV2Group', 'updateOrganizationScimV2Group',
    'deleteOrganizationScimV2Group', 'listOrganizationScimV2Users', 'provisionOrganizationScimV2User',
    'getOrganizationScimV2User', 'updateOrganizationScimV2User', 'deleteOrganizationScimV2User',
    'listOrganizationSentryAppComponents', "List an Organization's Integration Platform Installations",
    'listOrganizationSentryApps', 'getOrganizationSessions', 'resolveOrganizationShortId', 'Enable Spike Protection',
    'Disable Spike Protection', 'listOrganizationStatsV2', 'getOrganizationStatsSummary', 'listOrganizationTags',
    'listOrganizationTeams', 'createOrganizationTeam', 'listOrganizationTraceItemAttributes',
    'listOrganizationTraceMetrics', 'Retrieve Trace Item Statistics', 'getOrganizationTraceMeta',
    'getOrganizationTrace', 'listOrganizationUserTeams', 'listOrganizationWorkflows', 'createOrganizationWorkflow',
    'updateOrganizationWorkflows', 'deleteOrganizationWorkflows', 'getOrganizationWorkflow',
    'updateOrganizationWorkflow', 'deleteOrganizationWorkflow', 'getProject', 'updateProject', 'deleteProject',
    'listProjectCodeOwners', 'createProjectCodeOwners', 'retrieveProjectCodeOwners', 'updateProjectCodeOwners',
    'deleteProjectCodeOwners', "List a Project's Custom Inbound Filters", 'Create a Custom Inbound Filter',
    'Retrieve a Custom Inbound Filter', 'Update a Custom Inbound Filter', 'Delete a Custom Inbound Filter',
    'listProjectEnvironments', 'Bulk Update Project Environments', 'getProjectEnvironment',
    'updateProjectEnvironment', 'listProjectEventAttachments', 'getProjectEventAttachment',
    'getProjectEventSourceMapDebug', 'listProjectDebugFiles', 'listProjectFilters', 'updateProjectFilter',
    "List a Project's Service Hooks", 'Register a New Service Hook', 'Retrieve a Service Hook',
    'Update a Service Hook', 'Remove a Service Hook', "List a Project's Issues", 'Bulk Mutate a List of Issues',
    'Bulk Remove a List of Issues', 'createProjectKey', 'getProjectKey', 'updateProjectKey',
    'deleteProjectKey', 'listProjectMembers',  'updateProjectMonitor', 'deleteProjectMonitor',
     'getProjectOwnership', 'updateProjectOwnership',
    'getProjectPreprodSizeAnalysisStatusCheckRules', 'createProjectPreprodSizeAnalysisSkippedStatusCheck',
    'getProjectPreprodSnapshotStatusCheckRules', 'createProjectPreprodSnapshotSkippedStatusCheck',
    'getProjectInstallableBuildLatest', 'uploadProjectPreprodArtifactSnapshot', 'getProjectProfilingProfile',
    'listProjectReleases', 'listProjectReleaseCommits', 'listProjectReleaseFiles', 'uploadProjectReleaseFile',
    'getProjectReleaseFile', 'updateProjectReleaseFile', 'deleteProjectReleaseFile', 'deleteProjectReplay',
    'listProjectReplayClicks', 'listProjectReplayRecordingSegments', 'getProjectReplayRecordingSegment',
    'listProjectReplayViewedBy', 'listProjectReplayDeletionJobs', 'createProjectReplayDeletionJob',
    'getProjectReplayDeletionJob', 'listProjectRepositories', 'linkProjectRepository', 'listProjectStats',
    'listProjectSymbolSources', 'addProjectSymbolSource', 'updateProjectSymbolSource', 'deleteProjectSymbolSource',
    "List a Tag's Values", 'listProjectTeams', 'addProjectTeam', 'deleteProjectTeam',
    "List a Project's User Feedback", 'Submit User Feedback', 'listProjectUsers', 'listSeerModels',
    'executeSentryAppInstallationExternalIssueAction', 'Create or update an External Issue',
    'Delete an External Issue', 'getSentryAppInstallationExternalRequestOptions', 'getSentryApp', 'updateSentryApp',
    'deleteSentryApp', 'getTeam', 'updateTeam', 'deleteTeam', 'createTeamExternalTeam', 'updateTeamExternalTeam',
    'deleteTeamExternalTeam', 'listTeamMembers', 'listTeamProjects', 'createTeamProject'],
  // the World's doors (./semantics/doors.ts): what sentry.io's pages do that its API does not
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's DSN, auth token, organization and project, as the runtime issues them" },
    { id: 'organizations', method: 'POST', path: '/_twin/organizations', note: "an organization (sentry.io's sign-up)" },
    { id: 'authTokens', method: 'POST', path: '/_twin/auth-tokens', note: 'an organization CI token or scoped personal auth token, shown once (Settings > Auth Tokens)' },
  ],
  // source: https://docs.sentry.io/api/ratelimits/ "Each endpoint has its own maximum number of requests and window size."
  // The page supplies response headers rather than fixed numerical limits; no global allowance is inferred.
  accountSetup: [{ operation: 'createOrganizationProject', why: 'The operator creates additional account projects; application calls do not deploy account setup.' }],
  discovery: { twinOf: "Sentry's web API (sentry.io/api/0): release and source-map operations, account project/key operations, and declared resource read-back", stores: 'organizations, projects and their client keys, auth tokens (by their SHA-256), releases, uploaded chunks and artifact bundles' },
};
