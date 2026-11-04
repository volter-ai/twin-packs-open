// An agent's conversation (the manifest's socket `conversation`, the kernel's sockets.ts): the WebSocket at
// /v1/convai/conversation, opened with the agent's id and, for an agent that requires authorization, the signature a
// signed URL carries (convai.ts get_conversation_signed_link). The client's first frame starts the conversation (its
// conversation_initiation_client_data, with the overrides the agent allows); the server answers
// conversation_initiation_metadata, speaks the agent's first message when it has one, and answers each user_message with
// the agent's turn: its audio, agent_response, the client tools it calls (client_tool_call, each answered by the
// client's client_tool_result, which draws the turn's next part) and agent_response_complete, each sent only when the
// agent's client events take it. The conversation is stored as GET /v1/convai/conversations/{conversation_id} answers
// it, its transcript growing with each turn, and ends done when the client hangs up, with its duration and cost.
//
// THE TWIN RUNS NO MODEL. An agent whose LLM is a custom one (a chat-completions endpoint, as Volter Harness configures
// its agents) has each turn from that endpoint, asked as ElevenLabs asks it (ctx.ask, the World's application route):
// its text and the client tools it calls; a turn every attempt of which fails ends the conversation failed. Any other
// agent's turn is the World's scenario's when it scripts one (./scenario.ts: the kernel's OpenAI-wire scenario, reading
// the turn as the agent's LLM would be asked it), else a labeled deterministic stub; a scripted fault is answered as the
// conversation's client_error. The agent's audio is silence in its output format, as long as the text would take to say
// (../engine/audio.ts). The twin hears no audio: a user_audio_chunk is transcribed by no one and answered by nothing.
import { openaiWire, type HandlerContext, type SocketEngine, type SocketSession } from '@volter/world-core';
import { agentSpeech, base64, durationOf, silence } from '../engine/audio.ts';
import { readChatCompletion } from '../engine/chat.ts';
import { AGENT, CONVERSATION, DEFAULT_VOICES, KEY, VOICE, obj, type Row, SIGNATURE, unix, voicesOf, workspaceSecret } from './shared.ts';

type Session = {
  agent?: string; conversation?: string; started?: string; turn: number; format?: string; events?: string[];
  /** what the agent's LLM is asked a turn with: its model, its prompt (as overridden) and its client tools' names */
  model?: string; prompt?: string; tools?: string[];
  /** the agent's own tools as configured, offered to a custom LLM in its request */
  toolConfigs?: Row[];
  /** the custom LLM the agent declares (an api_type of chat_completions), which ElevenLabs asks each turn of: its URL,
   *  model, API key and request headers as configured, resolved each time it is asked */
  llm?: { url: string; model: string; apiKey: unknown };
  /** the dynamic variables the conversation was started with */
  variables?: Row;
  /** the client tool calls the agent awaits, by id: their names */
  pending?: Record<string, string>;
};
const state = (s: SocketSession): Session => s.state as Session;

// source: https://elevenlabs.io/docs/eleven-agents/customization/authentication "Signed URLs are valid for 15 minutes."
const SIGNATURE_LIFE_MS = 15 * 60 * 1000;
// source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Must be explicitly enabled in the agent"
const ENABLED_ONLY = ['agent_response_complete', 'agent_response_metadata', 'agent_tool_response_full_payload', 'agent_chat_response_part'];

/** Whether the agent's client events take an event: its list when it names one, else every event but those the page
 *  says must be enabled. */
// source: spec:/components/schemas/ConversationConfig-Input "The events that will be sent to the client"
const takes = (s: SocketSession, type: string): boolean => {
  const list = state(s).events;
  return list ? list.includes(type) : !ENABLED_ONLY.includes(type);
};

/** The first override field the agent does not allow, by its dotted path to the field itself (an object given is read
 *  field by field, against what the agent allows inside it, or nothing); undefined when it allows them all. */
function refusedOverride(given: Row, allowed: Row, path: string[] = []): string | undefined {
  for (const [k, v] of Object.entries(given)) {
    if (v === undefined || v === null) continue;
    const a = allowed[k];
    if (a === true) continue;
    const refused = typeof v === 'object' && !Array.isArray(v) ? refusedOverride(v as Row, obj(a), [...path, k]) : [...path, k].join('.');
    if (refused) return refused;
  }
  return undefined;
}

const secondsIn = (s: SocketSession, ctx: HandlerContext): number => Math.max(0, unix(ctx.occurredAt) - unix(state(s).started ?? ctx.occurredAt));

async function open(s: SocketSession, ctx: HandlerContext): Promise<void> {
  const q = new URL(ctx.call.request.url).searchParams;
  const agentId = q.get('agent_id') ?? '';
  const agent = ctx.row(AGENT, agentId);
  // Where the documentation stops: the pages name no answer for a connection the server refuses (an unknown agent, a
  // signature that does not hold or has expired, none for an agent that requires one); the twin closes it as a policy
  // violation (1008) with the reason
  if (!agent || agent.deleted === true) return s.close(1008, 'Agent not found');
  const signature = q.get('conversation_signature');
  if (signature !== null) {
    const digest = ctx.crypto.digest('sha256', signature, 'hex');
    const held = ctx.rowsRaw(SIGNATURE).find((r) => r.sha256 === digest && r.agent === agentId);
    if (!held) return s.close(1008, 'Invalid conversation signature');
    if (Date.parse(ctx.occurredAt) - Date.parse(String(held.issued)) > SIGNATURE_LIFE_MS) return s.close(1008, 'Conversation signature expired');
  } else {
    // source: spec:/components/schemas/AuthSettings "If set to true, starting a conversation with an agent will require a signed token"
    if (obj(obj(agent.platform_settings).auth).enable_auth === true) return s.close(1008, 'Authentication required');
  }
  Object.assign(state(s), { agent: agentId, turn: 0 });
}

/** The conversation starts: the overrides the agent allows taken, the conversation stored, its metadata sent, and the
 *  agent's first message spoken when it has one. False when the server refused it and closed the connection. */
async function start(s: SocketSession, ctx: HandlerContext, init: Row): Promise<boolean> {
  const st = state(s);
  const agent = ctx.row(AGENT, String(st.agent));
  if (!agent) { s.close(1008, 'Agent not found'); return false; }
  const override = obj(init.conversation_config_override);
  // source: https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides "For most fields, an error will be thrown if an override is provided when that field does not have overrides enabled."
  // Where the documentation stops: the page names no error's form; the twin closes the connection as a policy violation
  const refused = refusedOverride(override, obj(obj(obj(agent.platform_settings).overrides).conversation_config_override));
  if (refused) { s.close(1008, `Override for field '${refused}' is not allowed by config.`); return false; }
  const config = obj(agent.conversation_config);
  // source: spec:/components/schemas/TTSConversationalConfig-Input "The audio format to use for TTS"
  st.format = String(obj(config.tts).agent_output_audio_format ?? 'pcm_16000');
  const events = obj(config.conversation).client_events;
  if (Array.isArray(events)) st.events = events.map(String);
  const agentConfig = obj(config.agent);
  const prompt = obj(agentConfig.prompt);
  // source: spec:/components/schemas/PromptAgentAPIModel-Input "The LLM to query with the prompt and the chat history"
  st.model = String(prompt.llm === 'custom-llm' ? obj(prompt.custom_llm).model_id ?? 'custom-llm' : prompt.llm ?? '');
  st.prompt = String(obj(obj(override.agent).prompt).prompt ?? prompt.prompt ?? '');
  st.toolConfigs = (Array.isArray(prompt.tools) ? prompt.tools : []).map(obj);
  st.tools = st.toolConfigs.map((t) => String(t.name ?? '')).filter(Boolean);
  const custom = obj(prompt.custom_llm);
  // source: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm "Custom LLMs let you bring your own OpenAI API key or run an entirely custom LLM server."
  // source: spec:/components/schemas/CustomLLM "The API type to use (chat_completions, responses or websocket)"
  // a custom LLM spoken over another protocol (responses, websocket) is the gap when the agent is made (the manifest's variants)
  if (prompt.llm === 'custom-llm' && typeof custom.url === 'string' && (custom.api_type ?? 'chat_completions') === 'chat_completions') {
    st.llm = { url: custom.url.replace(/\/+$/, ''), model: String(custom.model_id ?? ''), apiKey: custom.api_key };
  }
  st.variables = obj(init.dynamic_variables);
  st.pending = {};
  st.started = ctx.occurredAt;
  const id = ctx.mint(CONVERSATION);
  st.conversation = id;
  await ctx.write(CONVERSATION, id, {
    conversation_id: id, agent_id: st.agent, agent_name: agent.name ?? null, status: 'in-progress', user_id: typeof init.user_id === 'string' ? init.user_id : null,
    metadata: { start_time_unix_secs: unix(ctx.occurredAt), call_duration_secs: 0, cost_fiat: null },
    conversation_initiation_client_data: { conversation_config_override: override, custom_llm_extra_body: obj(init.custom_llm_extra_body), dynamic_variables: redacted(st.variables) },
    has_audio: false, has_user_audio: false, has_response_audio: false, transcript: [],
  }, 'conversation.start');
  // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Automatically sent when starting a conversation"
  s.send({
    type: 'conversation_initiation_metadata',
    conversation_initiation_metadata_event: { conversation_id: id, agent_output_audio_format: st.format, user_input_audio_format: String(obj(config.asr).user_input_audio_format ?? 'pcm_16000') },
  });
  const first = obj(override.agent).first_message ?? obj(config.agent).first_message;
  if (typeof first === 'string' && first) await speak(s, ctx, { text: first }, []);
  return true;
}

/** The conversation as it is stored, without the tree's own fields (its id, type, updatedAt). */
function stored(ctx: HandlerContext, id: string): Row | undefined {
  const held = ctx.row(CONVERSATION, id);
  if (!held) return undefined;
  return ctx.own(held);
}
const transcriptOf = (row: Row): Row[] => (Array.isArray(row.transcript) ? row.transcript as Row[] : []);

/** The agent's part of a turn: its text's audio, then the whole text, then the client tools it calls; when it calls
 *  none, that it is done. The transcript takes what was said (`before`: the user's words or the tools' results). */
async function speak(s: SocketSession, ctx: HandlerContext, turn: { text?: string | null; toolCalls?: Array<{ id?: string; name: string; arguments: Row }> }, before: Row[]): Promise<void> {
  const st = state(s);
  st.turn += 1;
  const eventId = st.turn;
  const text = turn.text ?? '';
  if (text) {
    const chunks = agentSpeech(String(st.format), text) ?? [];
    // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Contains base64 encoded audio for playback"
    if (takes(s, 'audio')) chunks.forEach((c, i) => s.send({ type: 'audio', audio_event: { audio_base_64: base64(c), event_id: eventId, is_final: i === chunks.length - 1 } }));
    // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Sent once that message is finished"
    if (takes(s, 'agent_response')) s.send({ type: 'agent_response', agent_response_event: { agent_response: text, event_id: eventId, response_id: ctx.crypto.uuidFrom(`${String(st.conversation)}:${eventId}`) } });
  }
  // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Represents a function call the agent wants the client to execute"
  // Where the documentation stops: a tool call's id is ElevenLabs' own; the twin's is drawn from the conversation and turn
  const calls = (turn.toolCalls ?? []).map((c, i) => ({ id: c.id ?? ctx.crypto.uuidFrom(`${String(st.conversation)}:${eventId}:tool:${i}`), name: c.name, parameters: c.arguments ?? {} }));
  for (const c of calls) {
    st.pending = { ...st.pending, [c.id]: c.name };
    if (takes(s, 'client_tool_call')) s.send({ type: 'client_tool_call', client_tool_call: { tool_name: c.name, tool_call_id: c.id, parameters: c.parameters, event_id: eventId, expects_response: true } });
  }
  // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Fires when the agent has finished its response, including any pending tool calls."
  if (!calls.length && takes(s, 'agent_response_complete')) s.send({ type: 'agent_response_complete', agent_response_complete_event: { event_id: eventId } });
  const row = stored(ctx, String(st.conversation));
  if (!row) return;
  const seconds = secondsIn(s, ctx);
  const said: Row = { role: 'agent', message: text || null, time_in_call_secs: seconds };
  if (calls.length) said.tool_calls = calls.map((c) => ({ type: 'client', request_id: c.id, tool_name: c.name, params_as_json: JSON.stringify(c.parameters), tool_has_been_called: true }));
  await ctx.write(CONVERSATION, String(st.conversation), {
    ...row, has_audio: row.has_audio === true || text !== '', has_response_audio: row.has_response_audio === true || text !== '',
    metadata: { ...obj(row.metadata), call_duration_secs: seconds },
    transcript: [...transcriptOf(row), ...before, said],
  }, 'conversation.turn');
}

/** The conversation as a chat completion's messages: the prompt, then each turn of the transcript (a user's words, the
 *  agent's words and the tools it called, each tool's result). */
function messagesOf(st: Session, transcript: Row[]): Row[] {
  const out: Row[] = [{ role: 'system', content: String(st.prompt ?? '') }];
  for (const t of transcript) {
    if (t.role === 'user') { out.push({ role: 'user', content: String(t.message ?? '') }); continue; }
    const results = Array.isArray(t.tool_results) ? t.tool_results.map(obj) : [];
    for (const r of results) out.push({ role: 'tool', tool_call_id: r.request_id, content: String(r.result_value ?? '') });
    if (results.length) continue;
    const calls = Array.isArray(t.tool_calls) ? t.tool_calls.map(obj) : [];
    out.push({
      role: 'assistant', content: typeof t.message === 'string' ? t.message : null,
      ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.request_id, type: 'function', function: { name: c.tool_name, arguments: String(c.params_as_json ?? '{}') } })) } : {}),
    });
  }
  return out;
}

/** The conversation's dynamic variables as the conversations API shows them: a secret one's value redacted. */
// source: https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables "To create a secret dynamic variable, simply prefix the dynamic variable with secret__"
// source: https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables "Secret values are returned redacted as"
const redacted = (variables: Row = {}): Row =>
  Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, k.startsWith('secret__') ? '<REDACTED>' : v]));


/** The custom LLM's API key, resolved for this request; undefined when it cannot be. The spec takes only a workspace
 *  secret reference, an environment variable reference or null for it: a plain string or a dynamic variable is no API
 *  key, and never resolves. An environment variable never resolves in a World: the workspace's environment variables
 *  are the gap (the manifest's unmodeled create_environment_variable), so none exists for a reference to name. */
// source: spec:/components/schemas/CustomLLM/properties/api_key "anyOf $ref #/components/schemas/ConvAISecretLocator $ref #/components/schemas/ConvAIEnvVarLocator type null"
// source: spec:/components/schemas/CustomLLM "Either a workspace secret reference {'secret_id': '...'} or an environment variable reference {'env_var_label': '...'}."
// source: https://elevenlabs.io/docs/eleven-agents/integrate/environment-variables "environment variables can template the API key and request headers"
// source: spec:create_environment_variable "Create a new environment variable for the workspace"
function apiKey(ctx: HandlerContext, value: unknown): string | undefined {
  const ref = obj(value);
  return typeof ref.secret_id === 'string' ? workspaceSecret(ctx, ref) : undefined;
}


/** The custom LLM's URL and headers for this request: its API key as a bearer token and each request header resolved;
 *  why not when one cannot be resolved. */
// source: https://elevenlabs.io/docs/eleven-agents/integrate/environment-variables "If the variable cannot be resolved, the tool call fails with a configuration error"
// Where the documentation stops: the page names a tool call's failure; for a custom LLM, and for a workspace secret or a
// dynamic variable a header names and the conversation lacks, the pages name none: the twin fails the request as it
// fails one the LLM does not answer (the conversation ends failed), the configuration error its reason
function requestOf(st: Session, ctx: HandlerContext, s: SocketSession): { url: string; headers: Record<string, string> } | { why: string } {
  const llm = st.llm!;
  // source: https://elevenlabs.io/docs/eleven-agents/integrate/environment-variables "The custom LLM URL field supports the same"
  if (/\{\{\s*system__env_/.test(llm.url)) return { why: 'configuration error: the custom LLM URL names an environment variable that cannot be resolved' };
  const headers: Record<string, string> = {};
  // source: spec:/components/schemas/CustomLLM "The API key for authentication."
  if (llm.apiKey !== undefined && llm.apiKey !== null) {
    const key = apiKey(ctx, llm.apiKey);
    if (key === undefined) return { why: 'configuration error: the custom LLM API key cannot be resolved' };
    headers.authorization = `Bearer ${key}`;
  }
  return { url: llm.url, headers };
}

// source: https://elevenlabs.io/docs/eleven-agents/customization/llm/llm-cascading "If your Custom LLM fails, the system will retry the request with the same Custom LLM multiple times (matching the standard minimum retry count) before considering the request failed."
// source: https://elevenlabs.io/docs/eleven-agents/customization/llm/llm-cascading "at least 3 attempts"
const LLM_ATTEMPTS = 3;
// Where the documentation stops: the pages name no time a custom LLM is waited for; the twin waits 30 seconds an attempt
const LLM_WAIT_MS = 30_000;

/** The turn the agent's custom LLM answers, asked as ElevenLabs asks it: the chat completion request of the prompt and
 *  the transcript, its client tools offered, streamed; undefined when every attempt failed (an error, no answer in time,
 *  or an answer that says nothing), with why and the last error status the LLM answered. */
async function askLlm(s: SocketSession, st: Session, ctx: HandlerContext, transcript: Row[]): Promise<{ turn?: ReturnType<typeof readChatCompletion>; why: string; status: number }> {
  const llm = st.llm!;
  const request = requestOf(st, ctx, s);
  if ('why' in request) return { why: request.why, status: 0 };
  // source: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm "Both endpoints must return responses in SSE (Server-Sent Events) format"
  // source: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm "These tools are automatically included in the"
  const body = JSON.stringify({
    model: llm.model, messages: messagesOf(st, transcript), stream: true,
    ...(st.toolConfigs?.length ? { tools: st.toolConfigs.map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? { type: 'object', properties: {} } } })) } : {}),
  });
  let why = '';
  let status = 0;
  for (let attempt = 0; attempt < LLM_ATTEMPTS; attempt++) {
    // source: https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm "The Chat Completions API uses the"
    const answer = await ctx.ask(`${request.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...request.headers }, body }, LLM_WAIT_MS);
    // source: https://elevenlabs.io/docs/eleven-agents/customization/llm/llm-cascading "Failures can include API errors, timeouts, or empty responses from the LLM provider."
    if (answer.missed) { why = answer.missed === 'timeout' ? 'the custom LLM did not answer in time' : 'the custom LLM could not be reached'; continue; }
    if (answer.status < 200 || answer.status >= 300) { status = answer.status; why = `the custom LLM answered ${answer.status}`; continue; }
    const turn = readChatCompletion(answer.body);
    if (turn) return { turn, why: '', status };
    why = 'the custom LLM answered nothing';
  }
  return { why, status };
}

/** The agent's turn could not be made: the conversation failed. Where the documentation stops: the pages say a request
 *  failed after its retries and no more; the twin ends the conversation failed, with the error in its metadata, and
 *  closes the connection as an internal error (1011). */
async function failed(s: SocketSession, ctx: HandlerContext, why: string, status: number): Promise<void> {
  const st = state(s);
  const row = stored(ctx, String(st.conversation));
  if (row && !ctx.legal(CONVERSATION, 'status', 'socket:conversation', row.status, 'failed', st.conversation, 'vendor')) {
    await ctx.write(CONVERSATION, String(st.conversation), {
      ...row, status: 'failed',
      metadata: { ...obj(row.metadata), call_duration_secs: secondsIn(s, ctx), termination_reason: 'LLM request failed', error: { code: status || 500, reason: why } },
    }, 'conversation.fail');
  }
  s.close(1011, 'LLM request failed');
}

/** The agent's next turn: its custom LLM's answer, when it declares one; else the World's scenario's, asked as its LLM
 *  would be asked it (the prompt, the transcript, its tools, the tool results it ends with), a fault answered as
 *  client_error, else the labeled stub. */
async function answer(s: SocketSession, ctx: HandlerContext, before: Row[], results: string[]): Promise<void> {
  const st = state(s);
  const row = stored(ctx, String(st.conversation));
  const transcript = [...(row ? transcriptOf(row) : []), ...before];
  if (st.llm) {
    const asked = await askLlm(s, st, ctx, transcript);
    if (!asked.turn) {
      if (row) await ctx.write(CONVERSATION, String(st.conversation), { ...row, transcript }, 'conversation.turn');
      return failed(s, ctx, asked.why, asked.status);
    }
    return speak(s, ctx, asked.turn, before);
  }
  const lines = transcript.map((t) => (typeof t.message === 'string' ? t.message : '')).filter(Boolean);
  const lastUser = transcript.filter((t) => t.role === 'user' && typeof t.message === 'string').at(-1)?.message;
  const decision = await s.decide({ model: String(st.model ?? ''), text: [String(st.prompt ?? ''), ...lines].join('\n'), lastUser: String(lastUser ?? ''), tools: st.tools ?? [], results });
  if (decision?.kind === 'fault') {
    // the scenario's fault, in the conversation's own error frame (./scenario.ts renders it)
    if (takes(s, 'client_error')) s.send(decision.result.body);
    return;
  }
  const scripted = openaiWire.scenarioTurn(decision?.kind === 'handler' ? decision : undefined);
  const heard = String(lastUser ?? '');
  await speak(s, ctx, scripted ?? { text: `twin-stub: the agent heard ${JSON.stringify(heard.slice(0, 200))}; no model runs` }, before);
}

async function message(s: SocketSession, data: string, ctx: HandlerContext): Promise<void> {
  const st = state(s);
  if (!st.agent) return;
  let frame: Row;
  // Where the documentation stops: a frame that is not a JSON object is answered by nothing
  try { frame = obj(JSON.parse(data)); } catch { return; }
  if (!st.conversation) {
    // Where the documentation stops: the conversation starts on the client's first frame, its initiation data when it
    // sends them (the SDKs send them first), else with the agent's own config
    const init = frame.type === 'conversation_initiation_client_data' ? frame : {};
    if (!(await start(s, ctx, init)) || init === frame) return;
  }
  if (frame.type === 'user_message' && typeof frame.text === 'string') {
    await answer(s, ctx, [{ role: 'user', message: frame.text, time_in_call_secs: secondsIn(s, ctx), source_medium: 'text' }], []);
    return;
  }
  // source: https://elevenlabs.io/docs/eleven-agents/customization/events/client-events "Requires client-side execution of the function and sending the result back to the server"
  if (frame.type === 'client_tool_result' && typeof frame.tool_call_id === 'string' && st.pending?.[frame.tool_call_id]) {
    const name = st.pending[frame.tool_call_id]!;
    const { [frame.tool_call_id]: _done, ...rest } = st.pending;
    st.pending = rest;
    const result: Row = { role: 'agent', message: null, time_in_call_secs: secondsIn(s, ctx), tool_results: [{ type: 'client', request_id: frame.tool_call_id, tool_name: name, result_value: String(frame.result ?? ''), is_error: frame.is_error === true, tool_has_been_called: true }] };
    // the agent goes on once every call it made is answered
    if (Object.keys(rest).length) {
      const row = stored(ctx, String(st.conversation));
      if (row) await ctx.write(CONVERSATION, String(st.conversation), { ...row, transcript: [...transcriptOf(row), result] }, 'conversation.turn');
      return;
    }
    await answer(s, ctx, [result], [name]);
  }
  // user_activity, pong, contextual_update, feedback and a client_tool_result for no call the agent made move nothing
}

/** The client hung up: the conversation is done, its duration the connection's and billing unknown. */
async function close(s: SocketSession, ctx: HandlerContext): Promise<void> {
  const st = state(s);
  if (!st.conversation) return;
  const row = stored(ctx, st.conversation);
  if (!row || row.status !== 'in-progress') return;
  const refused = ctx.legal(CONVERSATION, 'status', 'socket:conversation', row.status, 'done', st.conversation, 'vendor');
  if (refused) return;
  const seconds = secondsIn(s, ctx);
  await ctx.write(CONVERSATION, st.conversation, {
    ...row, status: 'done',
    // source: https://elevenlabs.io/docs/help-center/product/eleven-agents/how-much-does-eleven-agents-cost "The length of the call is measured based on the connection duration."
    // The synthetic account establishes no plan, included balance or exhausted minutes; billing is unknown.
    // The nullable cost fields are the vendor's shape, and the termination reason's words are the twin's.
    metadata: { ...obj(row.metadata), call_duration_secs: seconds, cost: null, cost_fiat: null, termination_reason: 'Client disconnected' },
  }, 'conversation.end');
}

export const conversation: SocketEngine<HandlerContext> = { open, message, close };

// ── text to speech from streamed text (the manifest's socket `streamInput`) ──────────────────────────────────────────
// The WebSocket at /v1/text-to-speech/{voice_id}/stream-input: the client sends text as it has it (its first message
// initializes the connection, each next one is more text, an empty text closes it) and is sent the audio for the text,
// chunk by chunk, each chunk with its characters' timings, and at the end a final message.
//
// THE TWIN RUNS NO MODEL: a chunk is silence in the output format asked for, as long as its text would take to say
// (../engine/audio.ts), and its alignment spreads that length evenly over the text's characters.
// source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "The Text-to-Speech WebSockets API is designed to generate audio from partial text input"

type Stream = { format?: string; auto?: boolean; aligned?: boolean; inited?: boolean; keyed?: boolean; buffer: string; schedule: number[]; made: number };
const stream = (s: SocketSession): Stream => s.state as Stream;

// source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "model_id string Optional Defaults to eleven_multilingual_v2"
const STREAM_MODEL = 'eleven_multilingual_v2';
// source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "by default this"
const STREAM_FORMAT = 'mp3_44100_128';
// source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "totals at least 120 characters long"
const SCHEDULE = [120, 160, 250, 290];
// Where the documentation stops: the page names no model this socket refuses; the demanded application records that
// ElevenLabs refuses v4 Turbo here and speaks it on the text-to-dialogue socket instead (volter-ai/agent-stream at
// c34b748, streamer/speech.js:15), so the twin closes it like a model it lacks
const STREAM_REFUSED = new Set(['eleven_v4_turbo']);

/** Whether the key the client presents is one the World issued: the upgrade's xi-api-key header, else its first message's. */
function streamKeyed(ctx: HandlerContext, first?: Row): boolean {
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "This can only be included in the first"
  const given = ctx.call.request.headers.get('xi-api-key') ?? (first ? first['xi-api-key'] ?? first.xi_api_key : undefined);
  const key = typeof given === 'string' ? ctx.rowsRaw(KEY).find((row) => row.sha256 === ctx.crypto.sha256(given)) : undefined;
  if (!key) return false;
  const voice = String(ctx.call.params.voice_id ?? '');
  return DEFAULT_VOICES.some((row) => row.voice_id === voice) || ctx.rowsRaw(VOICE).some((row) => row.id === voice && row._tenant_scope === key._tenant_scope);
}

/** A text's audio in the stream's format, cut in the chunks it is sent in: PCM, in one-second chunks. Where the twin
 *  stops: the applications ask this socket for PCM alone (Raiku's pcm_24000); another format is the twin's gap. */
const speechOf = (format: string, text: string): Uint8Array[] | undefined =>
  format.startsWith('pcm_') && silence(format, text, '') ? agentSpeech(format, text) : undefined;

async function streamOpen(s: SocketSession, ctx: HandlerContext): Promise<void> {
  const url = new URL(ctx.call.request.url);
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "The unique identifier for the voice to use in the TTS process."
  const voiceId = String(ctx.call.params.voice_id ?? '');
  const q = url.searchParams;
  Object.assign(stream(s), { buffer: '', schedule: SCHEDULE, made: 0 });
  // Where the documentation stops: the page names no answer for a connection the server refuses (an unknown voice or
  // model, an output format the twin does not write, a key the World did not issue); the twin closes it as a policy
  // violation (1008) with the reason, as it does an agent's conversation
  if (!voicesOf(ctx).some((v) => v.voice_id === voiceId)) return s.close(1008, `A voice with the voice_id ${voiceId} was not found.`);
  const model = q.get('model_id') || STREAM_MODEL;
  if (!/^eleven_/.test(model)) return s.close(1008, `A model with model ID ${model} does not exist.`);
  if (STREAM_REFUSED.has(model)) return s.close(1008, `The model ${model} is not supported on this endpoint.`);
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "Output format of the generated audio. Formatted as codec_sample_rate_bitrate."
  const format = q.get('output_format') || STREAM_FORMAT;
  // Where the twin stops: the applications ask this socket for PCM alone; another format is the twin's gap
  if (!speechOf(format, 'x')) return s.close(1008, `The twin writes PCM alone on this socket; ${format} is not modeled.`);
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input "It is only recommended when sending full sentences"
  // the query's sync_alignment (a boolean, false by default): a chunk carries its characters' timings only when asked
  Object.assign(stream(s), { format, auto: q.get('auto_mode') === 'true', aligned: q.get('sync_alignment') === 'true', keyed: streamKeyed(ctx) });
}

/** The audio for the text buffered so far, sent chunk by chunk, each with the timings of the characters it holds (the
 *  times relative to the chunk). */
function generate(s: SocketSession): void {
  const st = stream(s);
  const text = st.buffer;
  st.buffer = '';
  if (!text.trim()) return;
  st.made++;
  const chunks = speechOf(String(st.format), text) ?? [];
  const totalMs = durationOf(text) * 1000;
  const chars = [...text];
  const startOf = (i: number): number => Math.round((i * totalMs) / chars.length);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let at = 0;
  let next = 0;
  for (const chunk of chunks) {
    const fromMs = Math.round((at / total) * totalMs);
    at += chunk.length;
    const toMs = at >= total ? Infinity : (at / total) * totalMs;
    const held: number[] = [];
    while (next < chars.length && startOf(next) < toMs) held.push(next++);
    // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "Note these times are relative to the returned chunk from the model,"
    const alignment = {
      charStartTimesMs: held.map((i) => Math.max(0, startOf(i) - fromMs)),
      charDurationsMs: held.map((i) => startOf(i + 1) - startOf(i)),
      chars: held.map((i) => chars[i]!),
    };
    // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "A generated partial audio chunk, encoded using the selected"
    // The twin normalizes no text: the normalized alignment is the text's own.
    s.send(st.aligned ? { audio: base64(chunk), normalizedAlignment: alignment, alignment } : { audio: base64(chunk) });
  }
}

async function streamMessage(s: SocketSession, data: string, ctx: HandlerContext): Promise<void> {
  const st = stream(s);
  let m: Row;
  try { m = obj(JSON.parse(data)); } catch { return s.close(1007, 'Invalid JSON'); }
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "The text to be sent to the API for audio generation. Should always"
  if (typeof m.text !== 'string') return s.close(1008, 'Field text is required.');
  if (!st.inited) {
    st.inited = true;
    if (!st.keyed) st.keyed = streamKeyed(ctx, m);
    // Where the documentation stops: the page names no refusal for a missing or unknown key on this socket; the twin
    // closes it as a policy violation with the API's own words
    if (!st.keyed) return s.close(1008, 'Invalid API key');
    const schedule = obj(m.generation_config).chunk_length_schedule;
    // each item a number of characters; an item that is not one is ignored, and a schedule with none keeps the default
    const lengths = Array.isArray(schedule) ? schedule.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0) : [];
    if (lengths.length) st.schedule = lengths;
    // the initializing message's text is a single space; an empty one ends the stream (below)
    if (m.text !== '' && !m.text.trim()) return;
  }
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "End the stream with an empty string"
  if (m.text === '') {
    generate(s);
    // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "Indicates if the generation is complete."
    s.send({ isFinal: true });
    return s.close(1000, '');
  }
  st.buffer += m.text;
  // source: https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input.md "Flush forces the generation of audio."
  // auto mode disables the chunk schedule and all buffers; else the buffer is spoken once it reaches the schedule's next length
  const due = st.schedule[Math.min(st.made, st.schedule.length - 1)] ?? 120;
  if (m.flush === true || st.auto || st.buffer.length >= due) generate(s);
}

export const streamInput: SocketEngine<HandlerContext> = { open: streamOpen, message: streamMessage };
