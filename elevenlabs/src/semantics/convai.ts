// ElevenAgents (the spec's `convai` family): an agent made from its config, the signed URL a conversation with it opens
// on (the conversation itself is the manifest's socket `conversation`, ./sockets.ts), a conversation read back, and the
// agents and conversations listed (as a vendor-backed World's refresh reads them).
// THE TWIN RUNS NO MODEL: an agent's turns are labeled stubs (./sockets.ts).
import type { HandlerContext } from '@volter/world-core';
import { AGENT, bodyOf, CONVERSATION, conversationView, elError, invalid, obj, type Row, SIGNATURE, signatureOf, unix, WORKSPACE_SECRET } from './shared.ts';

// source: spec:/components/schemas/TTSConversationalModel "eleven_v4_turbo"
const TTS_MODELS = ['eleven_turbo_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2', 'eleven_flash_v2_5', 'eleven_multilingual_v2', 'eleven_v3_conversational', 'eleven_v4', 'eleven_v4_turbo'];
// source: spec:/components/schemas/TTSOutputFormat "ulaw_8000"
const OUTPUT_FORMATS = ['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'ulaw_8000'];
/** pydantic's words for a value outside an enum: `Input should be 'a', 'b' or 'c'` */
const oneOf = (values: string[]): string => `Input should be ${values.slice(0, -1).map((v) => `'${v}'`).join(', ')} or '${values.at(-1)}'`;

// source: spec:create_agent_route "Create an agent from a config object"
export async function create_agent_route(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  // source: spec:/components/schemas/Body_Create_Agent_v1_convai_agents_create_post "Conversation configuration for an agent"
  if (!body.conversation_config || typeof body.conversation_config !== 'object') return invalid([{ type: 'missing', loc: ['body', 'conversation_config'], msg: 'Field required' }]);
  const config = obj(body.conversation_config);
  const tts = obj(config.tts);
  // a value outside its field's enum, the first in the config's order, refused as the API's validation refuses it
  // source: spec:/components/schemas/TTSConversationalConfig-Input "The model to use for TTS"
  // source: spec:/components/schemas/TTSConversationalConfig-Input "The audio format to use for TTS"
  const outside = ([['model_id', TTS_MODELS], ['agent_output_audio_format', OUTPUT_FORMATS]] as const).find(([field, values]) => tts[field] !== undefined && !values.includes(String(tts[field])));
  if (outside) return invalid([{ type: 'enum', loc: ['body', 'conversation_config', 'tts', outside[0]], msg: oneOf([...outside[1]]), input: tts[outside[0]] }]);
  const id = ctx.mint(AGENT);
  const at = unix(ctx.occurredAt);
  // source: spec:/components/schemas/ConvAIStoredSecretDependencies "Agents"
  const locator = obj(obj(obj(config.agent).prompt).custom_llm).api_key;
  const secret = ctx.row(WORKSPACE_SECRET, String(obj(locator).secret_id ?? ''));
  if (secret) {
    const view = ctx.own(secret);
    const used = obj(view.used_by);
    await ctx.write(WORKSPACE_SECRET, String(view.secret_id), { ...view,
      used_by: { ...used, agents: [...(Array.isArray(used.agents) ? used.agents : []), { type: 'available', agent_id: id, name: typeof body.name === 'string' ? body.name : '' }] },
    }, 'secret.dependency');
  }
  // the agent as GET /v1/convai/agents/{agent_id} answers it. Where the documentation stops: an agent made with no name
  // is named the empty text, and its creator is the key's account, which the twin does not name
  await ctx.write(AGENT, id, {
    agent_id: id, name: typeof body.name === 'string' ? body.name : '', conversation_config: config,
    metadata: { created_at_unix_secs: at, updated_at_unix_secs: at }, platform_settings: obj(body.platform_settings),
    phone_numbers: [], whatsapp_accounts: [], ...(body.workflow ? { workflow: body.workflow } : {}), tags: Array.isArray(body.tags) ? body.tags : [],
    access_info: { is_creator: true, creator_name: '', creator_email: '', role: 'admin' },
  }, 'agent.create');
  // source: spec:/components/schemas/CreateAgentResponseModel "ID of the created agent"
  return Response.json({ agent_id: id });
}

// source: spec:get_conversation_signed_link "Get a signed url to start a conversation with an agent with an agent that requires authorization"
export async function get_conversation_signed_link(ctx: HandlerContext): Promise<Response> {
  const agentId = new URL(ctx.call.request.url).searchParams.get('agent_id');
  if (!agentId) return invalid([{ type: 'missing', loc: ['query', 'agent_id'], msg: 'Field required' }]);
  const agent = ctx.row(AGENT, agentId);
  // Where the documentation stops: the page names no answer for an agent the account does not have; the twin answers the
  // API's not-found in its error body
  if (!agent || agent.deleted === true) return elError(404, 'agent_not_found', `Agent with id ${agentId} not found.`);
  // source: https://elevenlabs.io/docs/eleven-agents/customization/authentication "ElevenLabs generates a temporary token and returns a signed WebSocket URL."
  const id = await ctx.issue(SIGNATURE);
  const signature = await signatureOf(ctx, id);
  await ctx.record(SIGNATURE, { agent: agentId, issued: ctx.occurredAt, sha256: ctx.crypto.digest('sha256', signature, 'hex') }, id);
  // the conversation's socket is the twin's own (the manifest's `conversation`), where the vendor's API says it is
  const base = ctx.publicBase.replace(/^http/, 'ws').replace(/\/+$/, '');
  return Response.json({ signed_url: `${base}/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}&conversation_signature=${signature}` });
}

// source: spec:get_conversation_history_route "Get the details of a particular conversation"
export async function get_conversation_history_route(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.conversation_id ?? '');
  const row = ctx.row(CONVERSATION, id);
  // Where the documentation stops: the spec names no answer for a conversation the account does not have; the twin
  // answers the API's not-found in its error body
  if (!row || row.deleted === true) return elError(404, 'conversation_not_found', `Conversation with id ${id} not found.`);
  return Response.json(conversationView(row));
}

/** A page of a list, newest first: `page_size` items (30 unless asked, at most 100) after the `cursor`, which is the
 *  last item of the page before. Where the documentation stops: the cursor's form is ElevenLabs' own; the twin's is the
 *  id of the page's last item. */
function page(ctx: HandlerContext, rows: Row[], id: string): { items: Row[]; next_cursor: string | null; has_more: boolean } {
  const q = new URL(ctx.call.request.url).searchParams;
  const size = q.get('page_size') === null ? 30 : Number(q.get('page_size'));
  const cursor = q.get('cursor');
  const from = cursor ? rows.findIndex((r) => r[id] === cursor) + 1 : 0;
  const items = rows.slice(from, from + size);
  const has_more = from + size < rows.length;
  return { items, next_cursor: has_more ? String(items.at(-1)?.[id]) : null, has_more };
}
/** A page size outside 1 to 100: the validation's 422. */
// source: spec:get_agents_route "How many Agents to return at maximum. Can not exceed 100, defaults to 30."
function badSize(ctx: HandlerContext): Response | undefined {
  const raw = new URL(ctx.call.request.url).searchParams.get('page_size');
  if (raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) return invalid([{ type: 'int_parsing', loc: ['query', 'page_size'], msg: 'Input should be a valid integer, unable to parse string as an integer', input: raw }]);
  if (n < 1) return invalid([{ type: 'greater_than_equal', loc: ['query', 'page_size'], msg: 'Input should be greater than or equal to 1', input: raw }]);
  if (n > 100) return invalid([{ type: 'less_than_equal', loc: ['query', 'page_size'], msg: 'Input should be less than or equal to 100', input: raw }]);
  return undefined;
}

// source: spec:get_agents_route "Returns a list of your agents and their metadata."
export async function get_agents_route(ctx: HandlerContext): Promise<Response> {
  const refused = badSize(ctx);
  if (refused) return refused;
  const q = new URL(ctx.call.request.url).searchParams;
  const search = (q.get('search') ?? '').toLowerCase();
  // source: spec:get_agents_route "Filter agents by tag. Repeat the parameter to match any of several tags."
  const tags = q.getAll('tags');
  // source: spec:get_agents_route "Filter agents by archived status"
  const archived = q.get('archived') === 'true';
  // source: spec:get_agents_route "The direction to sort the results"
  const asc = q.get('sort_direction') === 'asc';
  const created = (a: Row): number => Number(obj(a.metadata).created_at_unix_secs ?? 0);
  const rows = ctx.rowsRaw(AGENT).filter((a) => a.deleted !== true && (a.archived === true) === archived)
    .filter((a) => search === '' || String(a.name ?? '').toLowerCase().includes(search))
    .filter((a) => tags.length === 0 || (Array.isArray(a.tags) && a.tags.some((t) => tags.includes(String(t)))))
    .sort((a, z) => (asc ? created(a) - created(z) : created(z) - created(a)));
  const { items, next_cursor, has_more } = page(ctx, rows, 'agent_id');
  // source: spec:/components/schemas/AgentSummaryResponseModel "Voice ID assigned to this agent"
  const lastCall = (a: Row): number | null => {
    const starts = ctx.rowsRaw(CONVERSATION).filter((c) => c.deleted !== true && c.agent_id === a.agent_id).map((c) => Number(obj(c.metadata).start_time_unix_secs));
    return starts.length ? Math.max(...starts) : null;
  };
  return Response.json({
    agents: items.map((a) => ({
      agent_id: a.agent_id, name: a.name, voice_id: String(obj(obj(a.conversation_config).tts).voice_id ?? ''), tags: Array.isArray(a.tags) ? a.tags : [],
      created_at_unix_secs: created(a), access_info: a.access_info, last_call_time_unix_secs: lastCall(a), archived: a.archived === true,
    })),
    next_cursor, has_more,
  });
}

// source: spec:get_conversation_histories_route "Get all conversations of agents that user owns. With option to restrict to a specific agent."
export async function get_conversation_histories_route(ctx: HandlerContext): Promise<Response> {
  const refused = badSize(ctx);
  if (refused) return refused;
  const q = new URL(ctx.call.request.url).searchParams;
  const agent = q.get('agent_id');
  const start = (c: Row): number => Number(obj(c.metadata).start_time_unix_secs ?? 0);
  const after = q.get('call_start_after_unix');
  const before = q.get('call_start_before_unix');
  // source: spec:get_conversation_histories_route "Exclude conversations with the given statuses."
  const excluded = q.getAll('exclude_statuses');
  // source: spec:get_conversation_histories_route "The direction to sort conversations by call start time. Defaults to descending (newest first)."
  const asc = q.get('sort_direction') === 'asc';
  const rows = ctx.rowsRaw(CONVERSATION).filter((c) => c.deleted !== true && (agent === null || c.agent_id === agent) && !excluded.includes(String(c.status)))
    .filter((c) => (q.get('user_id') === null || c.user_id === q.get('user_id')) && (after === null || start(c) > Number(after)) && (before === null || start(c) < Number(before)))
    .sort((a, z) => (asc ? start(a) - start(z) : start(z) - start(a)));
  const { items, next_cursor, has_more } = page(ctx, rows, 'conversation_id');
  // Where the documentation stops: the twin runs no analysis, so a conversation's success is `unknown` and it has no
  // summary, rating or detected language
  return Response.json({
    conversations: items.map((c) => {
      const m = obj(c.metadata);
      return {
        agent_id: c.agent_id, branch_id: null, version_id: null, agent_name: c.agent_name ?? null, conversation_id: c.conversation_id, start_time_unix_secs: start(c),
        call_duration_secs: Number(m.call_duration_secs ?? 0), message_count: Array.isArray(c.transcript) ? c.transcript.length : 0, status: c.status,
        ...(typeof m.termination_reason === 'string' ? { termination_reason: m.termination_reason } : {}), call_successful: 'unknown', call_success_score: null,
        transcript_summary: null, call_summary_title: null, main_language: null, conversation_initiation_source: null, tool_names: null, direction: null, rating: null,
        sentiment_analysis: null, tag_ids: [],
      };
    }),
    next_cursor, has_more,
  });
}

// source: spec:get_agent_route "Retrieve config for an agent"
export async function get_agent_route(ctx: HandlerContext): Promise<Response> {
  const row = ctx.row(AGENT, String(ctx.call.params.agent_id ?? ''));
  if (!row || row.deleted === true) return elError(404, 'agent_not_found', 'Agent not found.');
  return Response.json(ctx.own(row));
}

// source: spec:create_secret_route "Create a new secret for the workspace"
export async function create_secret_route(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  const missing = ['type', 'name', 'value'].filter((key) => typeof body[key] !== 'string');
  if (missing.length) return invalid(missing.map((key) => ({ type: 'missing', loc: ['body', key], msg: 'Field required' })));
  if (body.type !== 'new') return invalid([{ type: 'literal_error', loc: ['body', 'type'], msg: "Input should be 'new'" }]);
  const id = ctx.mint(WORKSPACE_SECRET);
  const metadata = { type: 'stored', secret_id: id, name: body.name };
  // source: spec:/components/schemas/ConvAIWorkspaceStoredSecretConfig "ConvAIWorkspaceStoredSecretConfig"
  // The vendor never reads the secret value back: retain it in World-only bookkeeping, not in its resource shape.
  await ctx.record('_workspace_secret_value', { secret_id: id, value: body.value }, id);
  await ctx.write(WORKSPACE_SECRET, id, { ...metadata, used_by: { tools: [], agents: [], others: [] } }, 'secret.create');
  return Response.json(metadata);
}

// source: spec:get_secret_route "Get a workspace secret by ID"
export async function get_secret_route(ctx: HandlerContext): Promise<Response> {
  const row = ctx.row(WORKSPACE_SECRET, String(ctx.call.params.secret_id ?? ''));
  // Where the documentation stops: missing secrets use the API's documented not-found class.
  return row && row.deleted !== true ? Response.json(ctx.own(row)) : elError(404, 'secret_not_found', 'Secret not found.');
}

// source: spec:get_secrets_route "Get all workspace secrets for the user"
export async function get_secrets_route(ctx: HandlerContext): Promise<Response> {
  const refused = badSize(ctx);
  if (refused) return refused;
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:get_secrets_route "returns only secrets whose names start with this string"
  const rows = ctx.rows(WORKSPACE_SECRET).filter((s) => String(s.name).startsWith(q.get('search') ?? ''));
  const { items, next_cursor } = page(ctx, rows, 'secret_id');
  return Response.json({ secrets: items, next_cursor });
}
