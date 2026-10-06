// OpenAI's manifest: the vendor facts its published spec does not carry, the resources the derived
// core serves and the Realtime socket (docs/contributing/architecture.md, "Protocol 3"). The surface itself is
// generated (./generated/surface.gen.json, from ../spec by scripts/derive-pack.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'openai',
  service: 'openai',
  body: {},
  // Resources with real published ids declare their own widths below.
  // Where documentation stops: a placeholder supplies only the prefix; its suffix keeps the kernel's default width.
  ids: { template: '{prefix}_{ksuid}' },
  // The screens people reach (docs/contributing/architecture.md, "Screens"): a project's secret keys are made on the
  // dashboard's API keys page, never through the API, which only lists, reads and deletes them.
  screens: [
    {
      id: 'login', kind: 'flow', host: 'platform.openai.com', path: '/login', status: 'done',
      demand: 'every dashboard page asks who is signed in',
      controls: ['Email address', 'Password', 'Continue'],
      source: 'https://platform.openai.com/login',
    },
    {
      id: 'api-keys', kind: 'workspace', host: 'platform.openai.com', path: '/settings/{project}/api-keys', status: 'done',
      demand: 'every application that calls the API runs on a key a person made on this page',
      controls: ['Name', 'Permissions', 'Create secret key', 'Revoke key'],
      source: 'https://platform.openai.com/docs/api-reference/project-api-keys',
    },
  ],
  time: 'unix',
  error: { error: { message: '{message}', type: '{kind}', param: '{param}', code: '{code}' } },
  defaultKind: 'invalid_request_error',
  readOnly: { status: 405, code: 'method_not_allowed', message: 'twin is read-only; omit readOnly to accept writes' },
  notFound: { status: 404, message: "No such {object}: '{id}'" },
  list: {
    style: 'envelope',
    envelope: { object: 'list', data: '{data}', has_more: '{has_more}', first_id: '{first_id}', last_id: '{last_id}' },
    limit: { param: 'limit', default: 20, max: 100 },
    after: 'after',
    before: 'before',
    unknownCursor: 'end',
  },
  deleted: { id: '{id}', object: '{object}', deleted: true },
  // OpenAI requires a bearer key on every request. The twin cannot check real keys, so it answers
  // the checkable failures: none, or a key it reserves as invalid.
  auth: {
    header: 'authorization',
    scheme: 'Bearer',
    gateWhenAbsent: true,
    missing: { status: 401, code: 'invalid_api_key', message: "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY)." },
    invalidKeys: ['sk-invalid', 'invalid'],
    invalid: { status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.' },
  },
  // every answer's own request id: `req_` and 32 hex characters, filled per answer from the World's count of answers
  // source: spec:getChatCompletion "req_ded8ab984ec4bf840f37566c1011c417"
  answerHeaders: { 'x-request-id': 'req_{hex:32}' },
  // a path OpenAI does not have, or an operation the twin does not model: OpenAI's unknown-URL refusal
  gap: { status: 404, message: 'Unknown request URL: {method} {path}. Please check the URL for typos.' },
  discovery: {
    twinOf: "the demanded OpenAI API and Realtime socket; deterministic, scripted model turns",
    stores: "files, stored completions and responses, assistants and their threads, messages and runs; application credentials",
    behavior: 'Chat completions, responses and Realtime responses are scripted by MSW-shaped handlers in the world dir (handlers/openai.json): {on:{userTextIncludes|anyTextIncludes|lastMessageTextIncludes|modelEquals|hasTool|toolResultFor|lastMessageIsToolResult|maxTokensBelow|maxTokensAtLeast|nthCall}, respond:{text|toolCalls, finishReason?}, once?, phase?}. An unmatched request answers a labeled stub naming this door.',
    exampleHandler: { on: { userTextIncludes: 'summarize', hasTool: 'file_search' }, respond: { text: 'Scripted summary.' }, once: true },
  },
  lanes: { routes: [{ lane: 'codex', host: 'auth.openai.com' }, { lane: 'codex', path: '/backend-api' }, { lane: 'media', path: '/generated-images' }] },
  // the World's doors (./semantics/doors.ts)
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the key an application holds, made on the Default project's API keys page, as the runtime issues it" },
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: "a person of the World's organization, who logs in to the dashboard" },
  ],
  sse: { named: false, done: '[DONE]' },
  // a response streams named events (`event: response.created`) and ends with `response.completed`, no sentinel
  // (https://platform.openai.com/docs/api-reference/responses-streaming; the reference's Streaming example)
  // a streamed transcription is `data:` events ending with `transcript.text.done`, no sentinel (the reference's
  // Streaming transcription example); a streamed image is named events ending with its `completed` event
  // (https://platform.openai.com/docs/api-reference/images-streaming)
  streamFor: { createResponse: { named: true }, createTranscription: { named: false }, createSpeech: { named: false }, createImage: { named: true }, createImageEdit: { named: true } },
  // operations of declared resources the twin does not model: OpenAI's unknown-URL answer, not the core's. Each is one
  // no application's demand (../journeys/demand.json), the life, a vendor-backed refresh or a modeled answer to
  // OpenAI's published examples reaches: the gap
  unmodeled: [
      "listAgents",
      "createAgent",
      "retrieveAgent",
      "updateAgent",
      "deleteAgent",
      "retrieveAgentEnvironment",
      "listAgentEnvironmentFiles",
      "createAgentEnvironmentFile",
      "listAgentEnvironmentTemplates",
      "createAgentEnvironmentTemplate",
      "retrieveAgentEnvironmentTemplate",
      "updateAgentEnvironmentTemplate",
      "deleteAgentEnvironmentTemplate",
      "listAgentSessions",
      "createAgentSession",
      "retrieveAgentSession",
      "updateAgentSession",
      "deleteAgentSession",
      "listAgentSessionArtifacts",
      "retrieveAgentSessionArtifact",
      "deleteAgentSessionArtifact",
      "retrieveAgentSessionArtifactContent",
      "listAgentSessionEvents",
      "createAgentSessionEvents",
      "listAgentSessionItems",
      "listAgentSessionSubagents",
      "retrieveAgentSessionSubagent",
      "listAgentSessionSubagentItems",
      "listAgentSessionSubagentTurns",
      "retrieveAgentSessionSubagentTurn",
      "listAgentSessionSubagentTurnItems",
      "listAgentSessionTurns",
      "retrieveAgentSessionTurn",
      "createTranslation",
      "listVoiceConsents",
      "createVoiceConsent",
      "getVoiceConsent",
      "updateVoiceConsent",
      "deleteVoiceConsent",
      "createVoice",
      "listBatches",
      "createBatch",
      "retrieveBatch",
      "cancelBatch",
      "updateChatCompletion",
      "CreateChatSessionMethod",
      "CancelChatSessionMethod",
      "ListThreadsMethod",
      "GetThreadMethod",
      "DeleteThreadMethod",
      "ListThreadItemsMethod",
      "createCompletion",
      "ListContainers",
      "CreateContainer",
      "RetrieveContainer",
      "DeleteContainer",
      "ListContainerFiles",
      "CreateContainerFile",
      "RetrieveContainerFile",
      "DeleteContainerFile",
      "RetrieveContainerFileContent",
      "Createcontentprovenancecheck",
      "createConversation",
      "getConversation",
      "updateConversation",
      "deleteConversation",
      "listConversationItems",
      "createConversationItems",
      "getConversationItem",
      "deleteConversationItem",
      "createEmbedding",
      "listEvals",
      "createEval",
      "getEval",
      "updateEval",
      "deleteEval",
      "getEvalRuns",
      "createEvalRun",
      "getEvalRun",
      "cancelEvalRun",
      "deleteEvalRun",
      "getEvalRunOutputItems",
      "getEvalRunOutputItem",
      "runGrader",
      "validateGrader",
      "listFineTuningCheckpointPermissions",
      "createFineTuningCheckpointPermission",
      "deleteFineTuningCheckpointPermission",
      "listPaginatedFineTuningJobs",
      "createFineTuningJob",
      "retrieveFineTuningJob",
      "cancelFineTuningJob",
      "listFineTuningJobCheckpoints",
      "listFineTuningEvents",
      "pauseFineTuningJob",
      "resumeFineTuningJob",
      "createImageVariation",
      "create-live",
      "accept-live-session",
      "download-live-recording",
      "fork-live-session",
      "hangup-live-session",
      "refer-live-session",
      "reject-live-session",
      "deleteModel",
      "admin-api-keys-list",
      "admin-api-keys-create",
      "admin-api-keys-get",
      "admin-api-keys-delete",
      "list-audit-logs",
      "listOrganizationCertificates",
      "uploadCertificate",
      "getCertificate",
      "modifyCertificate",
      "deleteCertificate",
      "activateOrganizationCertificates",
      "deactivateOrganizationCertificates",
      "usage-costs",
      "retrieve-organization-data-retention",
      "update-organization-data-retention",
      "Listexternalstorageconfigurations",
      "Createanexternalstorageconfiguration",
      "Getanexternalstorageconfiguration",
      "Deleteanexternalstorageconfiguration",
      "Validateanexternalstorageconfiguration",
      "list-groups",
      "create-group",
      "retrieve-group",
      "update-group",
      "delete-group",
      "list-group-role-assignments",
      "assign-group-role",
      "retrieve-group-role",
      "unassign-group-role",
      "list-group-users",
      "add-group-user",
      "retrieve-group-user",
      "remove-group-user",
      "list-invites",
      "inviteUser",
      "retrieve-invite",
      "delete-invite",
      "list-projects",
      "create-project",
      "retrieve-project",
      "modify-project",
      "list-project-api-keys",
      "retrieve-project-api-key",
      "delete-project-api-key",
      "archive-project",
      "listProjectCertificates",
      "activateProjectCertificates",
      "deactivateProjectCertificates",
      "retrieve-project-data-retention",
      "update-project-data-retention",
      "list-project-groups",
      "add-project-group",
      "retrieve-project-group",
      "remove-project-group",
      "retrieve-project-hosted-tool-permissions",
      "update-project-hosted-tool-permissions",
      "retrieve-project-model-permissions",
      "update-project-model-permissions",
      "delete-project-model-permissions",
      "list-project-rate-limits",
      "update-project-rate-limits",
      "list-project-service-accounts",
      "create-project-service-account",
      "retrieve-project-service-account",
      "update-project-service-account",
      "delete-project-service-account",
      "CreateanAPIkeyforaserviceaccount",
      "list-project-spend-alerts",
      "create-project-spend-alert",
      "retrieve-project-spend-alert",
      "update-project-spend-alert",
      "delete-project-spend-alert",
      "Getprojectspendlimit",
      "Updateprojectspendlimit",
      "Deleteprojectspendlimit",
      "list-project-users",
      "create-project-user",
      "retrieve-project-user",
      "modify-project-user",
      "delete-project-user",
      "list-roles",
      "create-role",
      "retrieve-role",
      "update-role",
      "delete-role",
      "list-organization-spend-alerts",
      "create-organization-spend-alert",
      "retrieve-organization-spend-alert",
      "update-organization-spend-alert",
      "delete-organization-spend-alert",
      "Getorganizationspendlimit",
      "Updateorganizationspendlimit",
      "Deleteorganizationspendlimit",
      "usage-audio-speeches",
      "usage-audio-transcriptions",
      "usage-code-interpreter-sessions",
      "usage-completions",
      "usage-embeddings",
      "usage-file-search-calls",
      "usage-images",
      "usage-moderations",
      "usage-vector-stores",
      "usage-web-search-calls",
      "list-users",
      "retrieve-user",
      "modify-user",
      "delete-user",
      "list-user-role-assignments",
      "assign-user-role",
      "retrieve-user-role",
      "unassign-user-role",
      "list-project-group-role-assignments",
      "assign-project-group-role",
      "retrieve-project-group-role",
      "unassign-project-group-role",
      "list-project-roles",
      "create-project-role",
      "retrieve-project-role",
      "update-project-role",
      "delete-project-role",
      "list-project-user-role-assignments",
      "assign-project-user-role",
      "retrieve-project-user-role",
      "unassign-project-user-role",
      "create-realtime-call",
      "accept-realtime-call",
      "hangup-realtime-call",
      "refer-realtime-call",
      "reject-realtime-call",
      "create-realtime-client-secret",
      "create-realtime-session",
      "create-realtime-transcription-session",
      "create-realtime-translation-client-secret",
      "beta_createResponse",
      "beta_getResponse",
      "beta_deleteResponse",
      "beta_cancelResponse",
      "beta_listInputItems",
      "Compactconversation",
      "beta_Compactconversation",
      "Getinputtokencounts",
      "beta_Getinputtokencounts",
      "Getprojectsafetyalert",
      "Getsafetycase",
      "ListSkills",
      "CreateSkill",
      "GetSkill",
      "UpdateSkillDefaultVersion",
      "DeleteSkill",
      "GetSkillContent",
      "ListSkillVersions",
      "CreateSkillVersion",
      "GetSkillVersion",
      "DeleteSkillVersion",
      "GetSkillVersionContent",
      "deleteMessage",
      "modifyRun",
      "createThreadAndRun",
      "createUpload",
      "cancelUpload",
      "completeUpload",
      "addUploadPart",
      "listVaults",
      "createVault",
      "retrieveVault",
      "deleteVault",
      "listVaultCredentials",
      "createVaultCredential",
      "retrieveVaultCredential",
      "rotateVaultCredential",
      "deleteVaultCredential",
      "modifyVectorStore",
      "createVectorStoreFileBatch",
      "getVectorStoreFileBatch",
      "cancelVectorStoreFileBatch",
      "listFilesInVectorStoreBatch",
      "listVectorStoreFiles",
      "createVectorStoreFile",
      "getVectorStoreFile",
      "updateVectorStoreFileAttributes",
      "deleteVectorStoreFile",
      "retrieveVectorStoreFileContent",
      "searchVectorStore",
      "ListVideos",
      "createVideo",
      "GetVideo",
      "DeleteVideo",
      "RetrieveVideoContent",
      "CreateVideoRemix",
      "CreateVideoCharacter",
      "GetVideoCharacter",
      "CreateVideoEdit",
      "CreateVideoExtend",
      "ListWebhookEndpoints",
      "CreateWebhookEndpoint",
      "RetrieveWebhookEndpoint",
      "UpdateWebhookEndpoint",
      "DeleteWebhookEndpoint",
      "RotateWebhookEndpointSigningSecret",
      "TestWebhookEndpoint",
      "ListWebhookEventTypes"
  ],
  // a search is a POST that only reads: a read-only twin answers it
  reads: [],
  // OpenAI's Realtime API: a WebSocket beside the HTTP document (./semantics/sockets.ts)
  sockets: [{
    id: 'realtime', path: '/v1/realtime',
    note: 'the Realtime API over a WebSocket: session.created on open; session.update, conversation.item.create and .truncate, response.create and .cancel, each answered by its server events (a response is the scenario\'s turn or the labeled stub, spoken as silence with its transcript)',
    source: 'https://developers.openai.com/api/reference/resources/realtime/client-events',
    // a browser client offers `realtime` beside its key's subprotocol, and the server selects `realtime`
    // source: https://developers.openai.com/api/docs/guides/realtime-websocket "openai-insecure-api-key."
    protocols: ['realtime'],
  }],
  // a vendor-backed root's live calls, charged as OpenAI limits a project: by requests a minute, per model and usage tier,
  // the first paid tier's 500 a minute on the models our applications call (gpt-4.1's Tier 1)
  // source: https://developers.openai.com/api/docs/guides/rate-limits "Rate limits use metrics such as RPM (requests per minute)"
  // source: https://developers.openai.com/api/docs/models/gpt-4.1 "Tier 1 500 30,000"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 500, source: 'https://developers.openai.com/api/docs/models/gpt-4.1' },
    reason: "OpenAI limits requests a minute per model by usage tier; Tier 1's 500 RPM on gpt-4.1 (https://developers.openai.com/api/docs/guides/rate-limits, https://developers.openai.com/api/docs/models/gpt-4.1)",
    windowMs: 60_000, ceiling: 500, defaultWeight: 1, maxRetryAfterSeconds: 120,
  },
  // No ingest: the twin declares no events, and the webhooks OpenAI sends (response.completed, batch.completed, …) carry
  // only their object's id (spec:/components/schemas/WebhookResponseCompleted: data "required: id"), nothing a refresh
  // could fold
  resources: {
    _codex_nonce: { storedAs: '_codex_nonce', idPrefix: 'nonce' },
    _codex_account: { storedAs: '_codex_account', idPrefix: 'acct' },
    _codex_code: { storedAs: '_codex_code', idPrefix: 'code' },
    _codex_device: { storedAs: '_codex_device', idPrefix: 'device' },
    _codex_grant: { storedAs: '_codex_grant', idPrefix: 'grant' },
    _codex_call: { storedAs: '_codex_call', idPrefix: 'resp' },
    // The download URL remains opaque; its filename follows the published 24-base62 example.
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/dalle/Image_generations_edits_and_variations_with_DALL-E.ipynb "img-ced13hkOk3lXkccQgW1fAQjm.png"
    _generated_image: { storedAs: '_generated_image', idPrefix: 'img', ids: '{prefix}-{ksuid:24}' },
    // each Realtime connection's own session id, issued by the World (semantics/sockets.ts): another for every connection
    // source: https://developers.openai.com/api/reference/resources/realtime/server-events "sess_C9G8l3zp50uFv4qgxfJ8o"
    _realtime_session: { idPrefix: 'sess', ids: '{prefix}_{ksuid:21}' },
    // an unstored response's id (semantics/responses.ts): `resp_` and 48 hex, as a stored one's
    // source: spec:createResponse "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b"
    _response_call: { idPrefix: 'resp', ids: '{prefix}_{hex:48}' },
    // a moderation's id: OpenAI keeps no moderation, and issues each its `modr-` and base62 id (semantics/moderations.ts)
    // source: spec:createModeration "modr-AB8CjOTu2jiq12hp1AQPfeqFWaORR"
    _moderation: { idPrefix: 'modr', ids: '{prefix}-{ksuid:29}' },
    // source: spec:createVectorStore "vs_abc123"
    // source: spec:createVectorStore "Create a vector store."
    // source: spec:listVectorStores "timestamp of the objects."
    // source: spec:/paths/~1vector_stores/get/parameters/1/schema/default "desc"
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb "vs_dEArILZSJh7J799QACi3QhuU"
    VectorStoreObject: { storedAs: "vector_store", idPrefix: "vs", ids: '{prefix}_{ksuid:24}', order: { field: 'created_at', direction: 'desc' }, ...states.VectorStoreObject, deleted: { id: "{id}", object: "vector_store.deleted", deleted: true }, refresh: { list: "listVectorStores" } },
    // the catalog is static data and fine-tuned models are read off their jobs; a row here is only
    // a deletion (semantics/models.ts serves every operation)
    Model: { storedAs: 'model', idPrefix: 'model', notFound: { code: 'model_not_found', message: "The model '{id}' does not exist" }, refresh: { list: 'listModels' } },
    // `status` is deprecated on a File (always `processed` here) and `purpose` is what it is for:
    // neither moves (https://platform.openai.com/docs/api-reference/files/object)
    // a file's id is `file-` and base62
    // source: spec:listFiles "file-abc123"
    // source: spec:createResponse "file-4wDz5b167pAf72nx1h9eiN"
    OpenAIFile: { storedAs: 'file', idPrefix: 'file', ids: '{prefix}-{ksuid:22}', notFound: 'No such File object: {id}', order: { field: 'created_at', direction: 'desc' }, ...states.OpenAIFile, refresh: { list: 'listFiles' } },
    // every call is recorded; only a `store: true` one reads back (semantics/chat.ts)
    CreateChatCompletionResponse: {
      storedAs: 'chat_completion',
      // `chatcmpl-` and base62
      // source: spec:createChatCompletion "chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT"
      idPrefix: 'chatcmpl',
      ids: '{prefix}-{ksuid:29}',
      readableWhen: { _stored: true },
      notFound: "No chat completion found with id '{id}'.",
      deleted: { id: '{id}', object: 'chat.completion.deleted', deleted: true },
      order: { field: 'created', direction: 'desc' },
      // source: spec:listChatCompletions "Only Chat Completions that have been stored"
      // The local call history also records unstored calls; the vendor's list cannot enumerate that whole history.
      refresh: { list: 'listChatCompletions', complete: false },
    },
    // a stored response and its input items (semantics/responses.ts). Its deletion answers `"object": "response"` (the
    // reference's delete example: https://platform.openai.com/docs/api-reference/responses/delete)
    // `resp_` and 48 hex characters (no list reads responses back in order)
    // source: spec:createResponse "resp_67ccd2bed1ec8190b14f964abc0542670bb6a6b452d3795b"
    Response: { storedAs: 'response', idPrefix: 'resp', ids: '{prefix}_{hex:48}', notFound: "Response with id '{id}' not found.", deleted: { id: '{id}', object: 'response', deleted: true }, ...states.Response, refresh: { none: 'OpenAI lists no responses: a response is read by its id' } },
    // the items live inside their response, never stored on their own: who wrote one, where a tool
    // call ran, and how far generation got are what it is, and the twin's are whole
    ItemResource: { idPrefix: 'item', ...states.ItemResource, refresh: { none: 'read off its response, never stored' } },
    // the Assistants API (semantics/assistants.ts, threads.ts); messages and runs live under their thread, each id its
    // type's prefix and an underscore
    // source: spec:getThread "thread_abc123"
    // source: spec:getMessage "msg_abc123"
    // source: spec:getRun "run_abc123"
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb "asst_qvXmYlZV8zhABI2RtPzDfV6z"
    AssistantObject: { storedAs: 'assistant', idPrefix: 'asst', ids: '{prefix}_{ksuid:24}', notFound: "No assistant found with id '{id}'.", deleted: { id: '{id}', object: 'assistant.deleted', deleted: true }, order: { field: 'created_at', direction: 'desc' }, refresh: { list: 'listAssistants' } },
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb "thread_j4dc1TiHPfkviKUHNi4aAsA6"
    ThreadObject: { storedAs: 'thread', idPrefix: 'thread', ids: '{prefix}_{ksuid:24}', notFound: "No thread found with id '{id}'.", deleted: { id: '{id}', object: 'thread.deleted', deleted: true }, refresh: { none: 'OpenAI lists no threads: a thread is read by its id' } },
    // a message's role is who wrote it and its status is not modeled (every message is whole)
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb "msg_A5eAN6ZAJDmFBOYutEm5DFCy"
    MessageObject: { storedAs: 'message', idPrefix: 'msg', ids: '{prefix}_{ksuid:24}', notFound: "No message found with id '{id}'.", parent: { param: 'thread_id', field: 'thread_id', resource: 'ThreadObject' }, number: { field: '_seq' }, order: { field: 'created_at', direction: 'desc' }, ...states.MessageObject, refresh: { list: 'listMessages' } },
    // source: https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb "run_qVYsWok6OCjHxkajpIrdHuVP"
    RunObject: { storedAs: 'run', idPrefix: 'run', ids: '{prefix}_{ksuid:24}', notFound: "No run found with id '{id}'.", parent: { param: 'thread_id', field: 'thread_id', resource: 'ThreadObject' }, order: { field: 'created_at', direction: 'desc' }, ...states.RunObject, refresh: { list: 'listRuns' } },
    // A run's steps are read off the run, never stored, so neither field moves on its own.
    // Where documentation stops: step_abc123 is a placeholder; step ids keep the default 27-character suffix.
    // source: spec:getRunStep "step_abc123"
    RunStepObject: { idPrefix: 'step', ...states.RunStepObject, refresh: { none: 'read off its run, never stored' } },
    // the Admin API (semantics/organization.ts); residency and a key's project access are settings. A root holds one key,
    // and the Admin API answers only an admin key, which no other endpoint takes: a root's refresh reads neither
    // source: https://developers.openai.com/api/docs/guides/admin-apis "Admin API keys cannot be used for non-administration endpoints."
    // source: spec:listFineTuningCheckpointPermissions "proj_abGMw1llN8IrBb6SvvY5A1iH"
    Project: { storedAs: 'project', idPrefix: 'proj', ids: '{prefix}_{ksuid:24}', notFound: 'Project {id} not found', order: { field: 'created_at', direction: 'desc' }, ...states.Project, refresh: { none: "the Admin API answers only an admin key, and the root's key is the API's" } },
    // Where documentation stops: key_abc is a placeholder, not evidence of a suffix length; keep the default 27 characters.
    // source: spec:list-project-api-keys "key_abc"
    ProjectApiKey: { storedAs: 'api_key', idPrefix: 'key', ids: '{prefix}_{ksuid}', notFound: 'API key {id} not found', parent: { param: 'project_id', field: '_project_id', resource: 'Project' }, deleted: { id: '{id}', object: 'organization.project.api_key.deleted', deleted: true }, order: { field: 'created_at', direction: 'desc' }, ...states.ProjectApiKey, refresh: { none: "the Admin API answers only an admin key, and the root's key is the API's" } },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest, surface), the
  // kernel deriving its vendor-backed half from the surface and the refresh scopes above
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'generative',
    bin: 'world-openai',
    resources: ['file', 'response', 'chat_completion', 'assistant', 'thread', 'message', 'run', 'project', 'api_key'],
    specSource: 'OpenAI OpenAPI 2.3.0; deterministic model turns or World scripts',
    description: 'OpenAI API twin — faithful protocol envelope (chat completions/streaming/tool_calls, Responses API), models, moderation, images, audio, files and Assistants v2; generative output is a labeled stub.',
    // The descriptor declares OpenAI's SDK distributions, credential environment variables and routing.
    // The stems are the bare OPENAI_* pair plus the credential-var shapes real apps use beside it
    // (AP_OPENAI_*, OPENAI_MODERATION_*).
    adoption: {
      // OpenAI's official Python library and Agents SDK identify their distributions; alternate providers
      // identify their endpoints through endpoint environment variables. tiktoken is a local tokenizer with no API calls.
      pypi: ['openai', 'openai-agents'],
      sdks: ['openai', '@ai-sdk/openai'],
      // AgentGPT reads REWORKD_PLATFORM_OPENAI_API_KEY, an application-prefixed OpenAI credential.
      // Postiz's OPENAI_OAUTH_CLIENT_ID identifies its inbound MCP OAuth client, with no api.openai.com request.
      envStems: ['CODEX', 'OPENAI', 'APOPENAI', 'OPENAIMODERATION', 'REWORKDPLATFORMOPENAI'],
    },
    // The public API, the separately specified subscription wire, and the console each own their paths.
    // a World's applications hold a project key the dashboard made (the credential door); the API refuses any other
    // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/storage.rs "Expected structure for $CODEX_HOME/auth.json."
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: { OPENAI_API_KEY: 'api_key', OPENAI_KEY: 'api_key', CODEX_HOME: 'directory:codex_home' } },
    hosts: [{ host: 'chatgpt.com', pathPattern: '^/backend-api/(codex|wham)(/|$)' }, { host: 'auth.openai.com', pathPattern: '^/(oauth/(authorize|token|revoke)|api/accounts/deviceauth/(usercode|token)|codex/device)(/|$)' }, { host: 'api.openai.com' }, { host: 'platform.openai.com', pathPattern: '^/(settings/proj[-_][^/]+/api-keys|login$)' }],
    // The SDK calls the same-origin '/v1/…' and loads from api.openai.com — the dev proxy
    // forwards '/v1/' to the twin and strips the absolute host so calls come back same-origin.
    browserRouting: { apiPathPrefix: '/v1/', loaderHost: 'https://api.openai.com' },
  },
};
