// ElevenLabs' manifest: the vendor facts its spec (../spec) does not carry. Served is what the applications call
// (../journeys/demand.json): text to speech, whole and streamed (MP3 or PCM), and from streamed text over the socket
// `streamInput`, the voices (v2) and cloning one, and ElevenAgents: an
// agent made, the signed URL a conversation opens on, the conversation itself (the socket `conversation`) and the
// conversation read back, and the agents and conversations listed for a vendor-backed refresh; every other operation
// is `unmodeled`.
//
// THE TWIN RUNS NO MODEL: speech is silence in the format asked for (MP3 labeled, PCM raw), as long as the text would take to say
// (./engine/audio.ts), and an agent's turn a labeled stub (./semantics/sockets.ts).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'elevenlabs',
  service: 'elevenlabs',
  tenant: { field: '_tenant_scope', storage: 'namespaced' },
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  error: { detail: { status: '{code}', message: '{message}' } },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  // a custom LLM spoken over the Responses API or a WebSocket, or sent extra request headers, none of which Supercode's
  // voice front configures by default (sdk/voice/README.md, 300c17dd), is the gap when the agent is made
  variants: { create_agent_route: ['conversation_config.agent.prompt.custom_llm.api_type=responses', 'conversation_config.agent.prompt.custom_llm.api_type=websocket', 'conversation_config.agent.prompt.custom_llm.request_headers'] },
  list: { style: 'envelope', envelope: { voices: '{data}' }, limit: { param: 'page_size', default: 10, max: 100 } },
  deleted: {},
  resources: {
    _workspace: { idPrefix: '', ids: '{uuid}', shared: true },
    _workspace_secret_value: { idPrefix: '_secret_', idAs: 'secret_id' },
    _api_key: { idPrefix: 'key_', ids: '{prefix}{n}', shared: true },
    // a signed URL's signature, by its SHA-256 (./semantics/convai.ts)
    _conversation_signature: { idPrefix: 'sig_', ids: '{prefix}{n}' },
    voice: { idPrefix: '', ids: '{letters:20}', idAs: 'voice_id', refresh: { list: 'get_user_voices_v2', next: 'next_page_token', cursor: 'next_page_token' } },
    // Where the documentation stops: an agent's and a conversation's id are their prefix and lowercase letters (the
    // spec's examples, agent_3701k3ttaq12ewp8b7qv5rfyszkz, mix digits in)
    agent: { idPrefix: 'agent_', ids: '{prefix}{letters:28}', idAs: 'agent_id', refresh: { list: 'get_agents_route', detail: 'get_agent_route', next: 'next_cursor', cursor: 'cursor' } },
    // source: spec:create_secret_route "Create a new secret for the workspace"
    workspace_secret: { idPrefix: 'sec_', ids: '{prefix}{letters:28}', idAs: 'secret_id', refresh: { list: 'get_secrets_route', next: 'next_cursor', cursor: 'cursor' } },
    conversation: { idPrefix: 'conv_', ids: '{prefix}{letters:28}', idAs: 'conversation_id', ...states.conversation, refresh: { list: 'get_conversation_histories_route', detail: 'get_conversation_history_route', next: 'next_cursor', cursor: 'cursor' } },
  },
  unmodeled: ["redirect_to_mintlify", "list_assets", "upload_asset", "get_asset", "delete_asset_endpoint", "audio_isolation", "get_audio_isolation_history", "delete_audio_isolation_history_item", "audio_isolation_stream", "create_audio_native_project", "audio_native_project_update_content_endpoint", "get_audio_native_project_settings_endpoint", "audio_native_update_content_from_url", "list_chat_response_tests_route", "get_agent_response_test_route", "update_agent_response_test_route", "delete_chat_response_test_route", "agent_testing_bulk_move_route", "create_agent_response_test_route", "create_agent_test_folder_route", "get_agent_test_folder_route", "update_agent_test_folder_route", "delete_agent_test_folder_route", "get_agent_response_tests_summaries_route", "get_agent_knowledge_base_size", "get_agent_llm_expected_cost_calculation", "patch_agent_settings_route", "delete_agent_route", "post_agent_avatar_route", "get_branches_route", "create_branch_route", "get_branch_route", "update_branch_route", "list_procedures_route", "create_procedure_route", "get_procedure_route", "remove_procedure_route", "get_procedure_draft_route", "update_procedure_draft_route", "delete_procedure_draft_route", "compile_procedures_route", "rebase_branch_onto_main", "rebase_preview_route", "merge_branch_into_target", "merge_preview_route", "create_agent_deployment_route", "create_agent_draft_route", "delete_agent_draft_route", "duplicate_agent_route", "post_agent_hold_audio_route", "delete_agent_hold_audio_route", "query_agent_knowledge_base_rag_route", "get_agent_link_route", "list_merge_proposals_route", "create_merge_proposal_route", "get_merge_proposal_route", "update_merge_proposal_route", "add_merge_proposal_comment_route", "accept_merge_proposal_route", "submit_merge_proposal_review_route", "run_agent_test_suite_route", "run_conversation_simulation_route", "run_conversation_simulation_route_stream", "get_agent_topics_route", "list_agent_conversation_tickets_route", "create_manual_agent_ticket_route", "get_assignable_users_route", "get_version_metadata_route", "get_agent_widget_route", "get_agent_summaries_route", "get_live_count", "get_batch_call", "delete_batch_call", "cancel_batch_call", "export_batch_call", "retry_batch_call", "create_batch_call", "get_workspace_batch_calls", "get_signed_url_deprecated", "get_livekit_token", "delete_conversation_route", "run_conversation_evaluations", "run_conversation_analysis", "get_conversation_audio_route", "post_conversation_feedback_route", "upload_file_route", "cancel_file_upload_route", "get_conversation_sip_messages", "get_conversation_summary_route", "assign_conversation_tags_route", "unassign_conversation_tag_route", "smart_search_conversation_messages_route", "text_search_conversation_messages_route", "resolve_conversation_reference_route", "list_environment_variables", "create_environment_variable", "get_environment_variable", "update_environment_variable", "handle_exotel_outbound_call", "get_knowledge_base_list_route", "add_documentation_to_knowledge_base", "post_knowledge_base_move_route", "get_documentation_from_knowledge_base", "update_document_route", "delete_knowledge_base_document", "get_documentation_chunk_from_knowledge_base", "get_documentation_chunks_from_knowledge_base", "get_knowledge_base_content", "get_knowledge_base_dependent_agents", "get_rag_indexes", "rag_index_status", "delete_rag_index", "refresh_url_document_route", "get_knowledge_base_source_file_url", "update_file_document_route", "post_knowledge_base_bulk_delete_route", "post_knowledge_base_bulk_move_route", "list_crawl_jobs_route", "create_crawl_job_route", "get_crawl_job_route", "cancel_crawl_job_route", "get_knowledge_base_bulk_dependent_agents_route", "create_file_document_route", "create_folder_route", "get_rag_index_overview", "get_or_create_rag_indexes", "search_knowledge_base_content_route", "get_agent_knowledge_base_summaries_route", "create_text_document_route", "create_url_document_route", "get_public_llm_expected_cost_calculation", "list_available_llms", "list_mcp_servers_route", "create_mcp_server_route", "get_mcp_route", "update_mcp_server_config_route", "delete_mcp_server_route", "update_mcp_server_approval_policy_route", "add_mcp_server_tool_approval_route", "remove_mcp_server_tool_approval_route", "add_mcp_tool_config_override_route", "get_mcp_tool_config_override_route", "update_mcp_tool_config_override_route", "remove_mcp_tool_config_override_route", "list_mcp_server_tools_route", "list_phone_numbers_route", "create_phone_number_route", "get_phone_number_route", "update_phone_number_route", "delete_phone_number_route", "list_sip_messages", "update_secret_route", "delete_secret_route", "get_secret_dependencies_route", "get_settings_route", "update_settings_route", "get_dashboard_settings_route", "update_dashboard_settings_route", "handle_sip_trunk_outbound_call", "list_conversation_tags_route", "create_conversation_tag_route", "get_conversation_tag_route", "update_conversation_tag_route", "delete_conversation_tag_route", "list_test_invocations_route", "get_test_invocation_route", "resubmit_tests_route", "get_tools_route", "add_tool_route", "get_tool_route", "update_tool_route", "delete_tool_route", "get_tool_dependent_agents_route", "get_tool_executions_route", "list_workspace_conversation_tickets_route", "create_agent_conversation_ticket_route", "get_agent_conversation_ticket_route", "update_agent_conversation_ticket_route", "delete_agent_conversation_ticket_route", "add_ticket_comment_route", "add_turn_comment_route", "handle_twilio_outbound_call", "register_twilio_call", "get_conversation_users_route", "list_phone_numbers_page_route", "list_whatsapp_accounts", "get_whatsapp_account", "update_whatsapp_account", "delete_whatsapp_account", "whatsapp_outbound_call", "whatsapp_outbound_message", "list_dubs", "create_dubbing", "get_dubbed_metadata", "delete_dubbing", "get_dubbed_file", "get_dubbed_transcript_file", "get_dubbing_transcripts", "dubbing_project_list", "dubbing_project_create", "dubbing_project_get", "dubbing_project_delete", "dubbing_language_list", "dubbing_language_create", "dubbing_language_get", "dubbing_language_delete", "dubbing_target_transcript_get", "dubbing_target_transcript_regenerate", "dubbing_target_transcript_segment_update", "dubbing_target_transcript_segments_update", "dubbing_transcript_get", "dubbing_transcript_segment_add", "dubbing_transcript_segment_update", "dubbing_transcript_segment_delete", "dubbing_transcript_segments_update", "get_dubbing_resource", "dub", "add_language", "migrate_segments", "render", "delete_segment", "update_segment_language", "create_speaker", "update_speaker", "create_clip", "get_similar_voices_for_speaker", "transcribe", "translate", "list_image_generations", "create_image_generation", "get_image_generation", "list_public_templates", "get_public_template", "list_public_template_runs", "create_public_template_run", "get_public_template_run", "list_text_to_speech_generations", "create_text_to_speech_generation", "get_text_to_speech_generation", "list_video_generations", "create_video_generation", "get_video_generation", "forced_alignment", "get_speech_history", "get_speech_history_item_by_id", "delete_speech_history_item", "get_audio_full_from_speech_history_item", "download_speech_history_items", "get_models", "generate", "compose_detailed", "compose_detailed_stream", "get_finetunes", "create_finetune", "get_finetune", "update_finetune", "delete_finetune", "compose_plan", "separate_song_stems", "stream_compose", "upload_song", "video_to_music", "public_list_orders", "public_create_order", "public_get_order", "public_update_order", "public_get_order_deliverables", "public_upsert_order_item", "public_remove_order_item", "public_register_media", "public_get_media_info", "public_submit_order", "public_get_available_languages", "get_pronunciation_dictionaries_metadata", "get_pronunciation_dictionary_version_pls", "get_pronunciation_dictionary_metadata", "patch_pronunciation_dictionary", "add_rules", "remove_rules", "set_rules", "add_from_file", "add_from_rules", "get_workspace_service_accounts", "create_service_account", "get_service_account_api_keys_route", "create_service_account_api_key", "edit_service_account_api_key", "delete_service_account_api_key", "get_library_voices", "get_similar_library_voices", "get_single_use_token", "sound_generation", "list_speech_engines", "create_speech_engine", "get_speech_engine", "update_speech_engine", "delete_speech_engine", "speech_to_speech_full", "speech_to_speech_stream", "speech_to_text", "get_transcript_by_id", "delete_transcript_by_id", "create_podcast", "get_projects", "add_project", "get_project_by_id", "edit_project", "delete_project", "get_chapters", "add_chapter", "get_chapter_by_id_endpoint", "edit_chapter", "delete_chapter_endpoint", "convert_chapter_endpoint", "get_chapter_snapshots", "get_chapter_snapshot_endpoint", "stream_chapter_snapshot_audio", "edit_project_content", "convert_project_endpoint", "get_project_muted_tracks_endpoint", "update_pronunciation_dictionaries", "get_project_snapshots", "get_project_snapshot_endpoint", "stream_project_snapshot_archive_endpoint", "stream_project_snapshot_audio_endpoint", "text_to_dialogue", "text_to_dialogue_stream", "text_to_dialogue_stream_with_timestamps", "text_to_dialogue_full_with_timestamps", "text_to_speech_stream_with_timestamps", "text_to_speech_full_with_timestamps", "create_voice", "text_to_voice_preview_stream", "text_to_voice_remix", "text_to_voice", "text_to_voice_design", "usage_characters", "get_user_info", "get_user_subscription_info", "get_voices", "get_voice_by_id", "delete_voice", "edit_voice", "replicate_voice_to_isolated_environment", "delete_sample", "get_audio_from_sample", "get_voice_settings", "edit_voice_settings", "get_voice_accents", "add_sharing_voice", "create_pvc_voice", "edit_pvc_voice", "get_pvc_voice_captcha", "verify_pvc_voice_captcha", "add_pvc_voice_samples", "edit_pvc_voice_sample", "delete_pvc_voice_sample", "get_pvc_sample_audio", "start_speaker_separation", "get_pvc_sample_speakers", "get_speaker_audio", "get_pvc_sample_visual_waveform", "run_pvc_voice_training", "request_pvc_manual_verification", "get_voice_settings_default", "usage_by_product_over_time", "requests_list", "get_workspace_audit_logs", "list_auth_connections", "create_auth_connection", "update_auth_connection", "delete_auth_connection", "get_groups_endpoint", "add_member", "remove_member", "search_groups", "delete_invite", "invite_user", "invite_users_bulk", "get_workspace_members", "update_workspace_member", "get_resource_metadata", "share_resource_endpoint", "unshare_resource_endpoint", "get_workspace_webhooks_route", "create_workspace_webhook_route", "edit_workspace_webhook_route", "delete_workspace_webhook_route", "disable", "set_third_party_disabling_policy"],
  doors: [
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the World application's key, as the runtime issues it" },
  ],
  // an agent's conversation: the WebSocket a signed URL names (https://elevenlabs.io/docs/eleven-agents/libraries/web-sockets)
  sockets: [{
    id: 'conversation', path: '/v1/convai/conversation',
    note: "an agent's conversation: the client's initiation data, then user_message turns; conversation_initiation_metadata, then each turn's audio, agent_response and agent_response_complete as the agent's client events take them; get_conversation_signed_link answers where it is",
    source: 'https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket',
  }, {
    // text to speech from streamed text: the WebSocket at /v1/text-to-speech/{voice_id}/stream-input
    // (https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input); the voice is
    // the path's parameter, which the engine reads as a handler reads its path's (ctx.call.params)
    id: 'streamInput', path: '/v1/text-to-speech/{voice_id}/stream-input',
    note: "text to speech from streamed text: an initializing message, text messages (flush, or auto_mode, speaks the buffer) and an empty text that ends it; each chunk's audio with its characters' alignment, then isFinal",
    source: 'https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input',
  }],
  // the key the World issued, sent as `xi-api-key` (its hash held: `_api_key`)
  auth: {
    header: 'xi-api-key', scheme: '', gateWhenAbsent: true, beforeRouting: true, invalidKeys: [],
    missing: { status: 401, code: 'needs_authorization', message: 'Neither authorization header nor xi-api-key received, please provide one.' },
    invalid: { status: 401, code: 'invalid_api_key', message: 'Invalid API key' },
    held: { storedAs: '_api_key', hashField: 'sha256' },
  },
  // ElevenLabs limits how many requests an account runs at once, by plan, and publishes no limit per minute
  // (a request past it is answered 429 too_many_concurrent_requests)
  // source: https://elevenlabs.io/docs/overview/models "Concurrency and priority"
  // source: https://elevenlabs.io/docs/help-center/technical/api-error-code-429 "too_many_concurrent_requests"
  rateBudget: {
    reason: "ElevenLabs limits concurrent requests by plan (Free 2, Starter 3, Creator 5, Pro 10, Scale and Business 15 for Multilingual v2; twice that for Flash) and publishes no per-minute limit (https://elevenlabs.io/docs/overview/models, Concurrency and priority; 429 too_many_concurrent_requests, https://elevenlabs.io/docs/help-center/technical/api-error-code-429). The executor's calls run one at a time, inside every plan's concurrency; with no documented per-minute allowance the window holds a loop to the platform's fallback, 30 calls a minute, a speech at twice a read's cost because it holds a concurrency slot while the audio is made.",
    windowMs: 60_000, ceiling: 60, defaultWeight: 2, maxRetryAfterSeconds: 60,
    rules: [{ match: '^POST /v1/text-to-speech/', weight: 4 }],
  },
  // a vendor-backed World's root: ElevenLabs sends a conversation to the workspace's post-call webhook once its call ends
  // and its analysis is done, signed in ElevenLabs-Signature (t=<seconds>,v0=<hex HMAC-SHA256 of "<t>.<body>">)
  // source: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks "Contains full conversation data including transcripts, analysis results, and metadata"
  // source: https://raw.githubusercontent.com/elevenlabs/elevenlabs-js/main/src/wrapper/webhooks.ts "No signature hash found with expected scheme v0"
  ingest: {
    scheme: { kind: 'timestamp-v1', header: 'ElevenLabs-Signature', version: 'v0' },
    type: { body: 'type' }, object: 'data',
    types: { post_call_transcription: { resource: 'conversation' } },
  },
  discovery: {
    twinOf: "ElevenLabs' API (api.elevenlabs.io): text to speech, whole, streamed and from streamed text over the stream-input WebSocket, the account's voices, and ElevenAgents' agents and their conversations",
    stores: 'API keys (by their SHA-256); the voices the account adds, beside the default voice; agents; conversations and their transcripts (each done when its client hangs up); signed URLs\' signatures (by their SHA-256)',
    behavior: "speech is MP3 (labeled) or PCM silence, as long as the text would take to say, with even per-character alignment on the stream-input socket (another codec is the twin's gap); an agent's turn is the World's scenario's (the OpenAI wire's on/respond keys: text, toolCalls) or a labeled stub, spoken as PCM silence; no model runs",
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-elevenlabs',
    resources: ['voice', 'agent', 'conversation', 'workspace_secret'],
    specSource: "ElevenLabs' OpenAPI document (spec/openapi.json.gz)",
    description: "ElevenLabs twin — text to speech (whole, streamed, and from streamed text over the stream-input WebSocket) as MP3 or PCM silence (no model runs), the account's voices (v2) and cloning one, ElevenAgents' agents and their conversations over the signed-URL WebSocket (a scripted scenario's turns or a labeled stub's), API keys.",
    adoption: { sdks: ['@elevenlabs/elevenlabs-js', 'elevenlabs'], envStems: ['ELEVENLABS', 'ELEVENSLABS'] },
    hosts: [{ host: 'api.elevenlabs.io' }],
    endpointEnvNone: 'the applications call https://api.elevenlabs.io unless configured with another URL; the World claims the host',
    credentialDoor: { account: { field: 'account', tenancy: 'workspace', source: 'https://elevenlabs.io/docs/api-reference/authentication' }, deployment: { field: 'deployment', object: 'restricted API key', source: 'https://elevenlabs.io/docs/api-reference/authentication' }, path: '/_twin/app-credentials', body: {}, fill: { ELEVENLABS_API_KEY: 'api_key', ELEVENSLABS_API_KEY: 'api_key' } },
  },
};
