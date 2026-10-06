// OpenAI's Realtime API over a WebSocket (the manifest's socket `realtime`, the kernel's sockets.ts): a client opens
// wss://api.openai.com/v1/realtime?model=<model> with its key, is sent the session, and speaks in JSON events: it updates
// the session, adds items to the conversation and asks for responses, and is sent each response as its events. THE TWIN
// RUNS NO MODEL: a response is the World's scenario's turn when it scripts one (session.decide, the request the pack's
// scenario adapter reads, as a chat completion's), else the kernel's labeled stub (openaiWire.chatStubTurn); its audio
// is silence, its transcript the turn's text. The conversation and the session are the connection's (nothing of them is
// stored at OpenAI or read back over HTTP), so they live on the session, never in the World.
import { base62From, openaiWire, sha256, type HandlerContext, type ScenarioDecision, type SocketEngine, type SocketSession } from '@volter/world-core';
import { base64, INVALID_KEY, PROJECT_KEY, silentPcm } from './shared.ts';

type Row = Record<string, unknown>;
type Item = Row & { id: string; type: string };
type Session = { id: string; n: number; config: Row; items: Item[]; spoke: boolean; buffer: Uint8Array[] };
const LABEL = 'OpenAI twin';
const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);
const state = (s: SocketSession): Session => s.state as Session;
/** An id the connection gives: its type's prefix, an underscore and 21 base62 characters, derived from the session and
 *  the connection's place in it (a tool call's 24, as the API's) */
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "event_C9G8pqbTEddBSIxbBN6Os"
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "item_C9G8pGVKYnaZu8PH5YQ9O"
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "resp_C9G8p7IH2WxLbkgPNouYL"
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "conv_C9G8mmBkLhQJwCon3hoJN"
const minted = (s: SocketSession, prefix: string): string => { const st = state(s); st.n += 1; return `${prefix}_${base62From(`${st.id}:${prefix}:${st.n}`, prefix === 'call' ? 24 : 21)}`; };
/** A server event: its type, its id, and its fields. */
const event = (s: SocketSession, type: string, fields: Row): void => { s.send({ type, event_id: minted(s, 'event'), ...fields }); };
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when an error occurs, which could be a client problem or a server problem."
const error = (s: SocketSession, message: string, code: string | null, clientEvent: unknown, param: string | null = null): void =>
  event(s, 'error', { error: { type: 'invalid_request_error', code, message, param, event_id: typeof clientEvent === 'string' ? clientEvent : null } });

/** One second of silence, 24 kHz 16-bit mono PCM: the audio a response speaks, a model's voice being none of the twin's. */
const AUDIO_MS = 1000;

// ── the session ─────────────────────────────────────────────────────────────────────────────

/** The session a connection opens with: the model the URL names and OpenAI's defaults. */
function initial(id: string, model: string, created: number): Row {
  return {
    type: 'realtime', object: 'realtime.session', id, model,
    // source: https://developers.openai.com/api/reference/resources/realtime/server-events "indicating that the model will respond with audio plus a transcript."
    output_modalities: ['audio'], instructions: '', tools: [], tool_choice: 'auto',
    // source: https://developers.openai.com/api/reference/resources/realtime/server-events "or inf for the maximum available tokens for a given model. Defaults to inf ."
    max_output_tokens: 'inf', tracing: null, truncation: 'auto', prompt: null, include: null, expires_at: created + 3600,
    audio: {
      input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: null, noise_reduction: null, turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 200, idle_timeout_ms: null, create_response: true, interrupt_response: true } },
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "1.0 is the default speed."
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'alloy', speed: 1 },
    },
  };
}

/** A session.update's fields over the session: each named field replaced, `audio` merged a level down. */
function updated(config: Row, sent: Row): Row {
  const next = { ...config };
  for (const [k, v] of Object.entries(sent)) {
    if (k === 'audio') {
      const audio = obj(config.audio);
      next.audio = { input: { ...obj(audio.input), ...obj(obj(v).input) }, output: { ...obj(audio.output), ...obj(obj(v).output) } };
    } else if (k !== 'type' && k !== 'id' && k !== 'object' && k !== 'model') next[k] = v;
  }
  return next;
}

// ── what a response is asked ─────────────────────────────────────────────────────────────────

/** A content part's words: its text, or the transcript of its audio. */
const words = (content: unknown): string => arr(content).map((p) => String(p.text ?? p.transcript ?? '')).join('');

/** The conversation as the chat messages the scenario and the stub read: the instructions first, each message by its
 *  role, a function call as the assistant's tool call and its output as the tool's message. */
function messages(instructions: unknown, items: Item[]): Row[] {
  const out: Row[] = typeof instructions === 'string' && instructions ? [{ role: 'system', content: instructions }] : [];
  for (const i of items) {
    if (i.type === 'message') out.push({ role: String(i.role), content: words(i.content) });
    if (i.type === 'function_call') out.push({ role: 'assistant', content: null, tool_calls: [{ id: String(i.call_id), type: 'function', function: { name: String(i.name), arguments: String(i.arguments ?? '{}') } }] });
    if (i.type === 'function_call_output') out.push({ role: 'tool', tool_call_id: String(i.call_id), content: String(i.output ?? '') });
  }
  return out;
}

/** A Realtime tool (`{type, name, parameters}`) as a chat completion offers it, and its tool choice likewise. */
const chatTools = (tools: unknown): Row[] => arr(tools).filter((t) => t.type === 'function').map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
const chatChoice = (choice: unknown): unknown => (choice && typeof choice === 'object' ? { type: 'function', function: { name: obj(choice).name } } : choice ?? 'auto');

// ── a response ─────────────────────────────────────────────────────────────────────────────

async function respond(s: SocketSession, sent: Row): Promise<void> {
  const st = state(s);
  const asked = obj(sent.response);
  // source: https://developers.openai.com/api/reference/resources/realtime/client-events "The auto value means that the contents of the response will be added to the default conversation."
  const inConversation = asked.conversation !== 'none';
  const config = { ...st.config, ...Object.fromEntries(Object.entries(asked).filter(([k]) => ['instructions', 'tools', 'tool_choice', 'output_modalities', 'max_output_tokens'].includes(k))) };
  // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Using this field creates a new context for this Response instead of using the default conversation."
  const context = Array.isArray(asked.input) ? (asked.input as Item[]) : st.items;
  const model = String(st.config.model);
  const chat = messages(config.instructions, context);
  const max = typeof config.max_output_tokens === 'number' ? config.max_output_tokens : undefined;
  const served = await s.decide({ model, messages: chat, tools: config.tools, maxTokens: max, toolChoice: config.tool_choice });
  // a fault the World's scenario scripts is answered as OpenAI answers a failure: an error event
  if (served?.kind === 'fault') return scenarioFault(s, served.result.body, sent.event_id);
  const turn = openaiWire.scenarioTurn(served as ScenarioDecision | undefined)
    ?? openaiWire.chatStubTurn({ model, messages: chat, tools: chatTools(config.tools), tool_choice: chatChoice(config.tool_choice) }, LABEL);
  const audio = arr(config.output_modalities).map(String).includes('audio') || config.output_modalities === undefined;
  const id = minted(s, 'resp');
  const base = {
    object: 'realtime.response', id, conversation_id: inConversation ? `conv_${base62From(`${st.id}:conversation`, 21)}` : null, output_modalities: audio ? ['audio'] : ['text'],
    max_output_tokens: config.max_output_tokens ?? 'inf', audio: { output: { format: obj(obj(obj(st.config.audio).output).format), voice: obj(obj(st.config.audio).output).voice } },
    metadata: asked.metadata ?? null, usage: null,
  };
  // source: https://developers.openai.com/api/reference/resources/realtime/server-events "The first event of response creation, where the response is in an initial state of in_progress ."
  event(s, 'response.created', { response: { ...base, status: 'in_progress', status_details: null, output: [] } });
  const output: Item[] = [];
  const added = (item: Item, index: number): void => {
    event(s, 'response.output_item.added', { response_id: id, output_index: index, item: { ...item, status: 'in_progress', ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
    if (inConversation) event(s, 'conversation.item.added', { previous_item_id: st.items.at(-1)?.id ?? null, item: { ...item, status: 'in_progress', ...(item.type === 'message' ? { content: [] } : { arguments: '' }) } });
  };
  const done = (item: Item, index: number): void => {
    event(s, 'response.output_item.done', { response_id: id, output_index: index, item });
    if (inConversation) { event(s, 'conversation.item.done', { previous_item_id: st.items.at(-1)?.id ?? null, item }); st.items.push(item); }
    output.push(item);
  };
  if (turn.toolCalls?.length) {
    // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when the model-generated function call arguments are done streaming."
    turn.toolCalls.forEach((call, index) => {
      const item: Item = { id: minted(s, 'item'), object: 'realtime.item', type: 'function_call', status: 'completed', name: call.name, call_id: minted(s, 'call'), arguments: JSON.stringify(call.arguments ?? {}) };
      added(item, index);
      event(s, 'response.function_call_arguments.delta', { response_id: id, item_id: item.id, output_index: index, call_id: item.call_id, delta: item.arguments });
      event(s, 'response.function_call_arguments.done', { response_id: id, item_id: item.id, output_index: index, call_id: item.call_id, name: item.name, arguments: item.arguments });
      done(item, index);
    });
  } else {
    const text = String(turn.text ?? '');
    const item: Item = { id: minted(s, 'item'), object: 'realtime.item', type: 'message', role: 'assistant', status: 'completed', content: [audio ? { type: 'output_audio', transcript: text } : { type: 'output_text', text }] };
    added(item, 0);
    const where = { response_id: id, item_id: item.id, output_index: 0, content_index: 0 };
    event(s, 'response.content_part.added', { ...where, part: audio ? { type: 'audio', transcript: '' } : { type: 'text', text: '' } });
    if (audio) {
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Base64-encoded audio data delta."
      event(s, 'response.output_audio.delta', { ...where, delta: base64(silentPcm()) });
      event(s, 'response.output_audio_transcript.delta', { ...where, delta: text });
      event(s, 'response.output_audio.done', where);
      event(s, 'response.output_audio_transcript.done', { ...where, transcript: text });
      st.spoke = true;
    } else textDeltas(s, where, text);
    event(s, 'response.content_part.done', { ...where, part: audio ? { type: 'audio', transcript: text } : { type: 'text', text } });
    done(item, 0);
  }
  const input = Math.max(1, Math.ceil(chat.map((m) => String(m.content ?? '')).join('\n').length / 4));
  const out = Math.max(1, Math.ceil(output.map((i) => words(i.content) + String(i.arguments ?? '')).join('').length / 4));
  const audioTokens = audio && !turn.toolCalls?.length ? Math.ceil(AUDIO_MS / 50) : 0;
  // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when a Response is done streaming. Always emitted, no matter the final state."
  event(s, 'response.done', {
    response: {
      ...base, status: 'completed', status_details: null, output,
      usage: { total_tokens: input + out + audioTokens, input_tokens: input, output_tokens: out + audioTokens, input_token_details: { cached_tokens: 0, text_tokens: input, audio_tokens: 0, image_tokens: 0 }, output_token_details: { text_tokens: out, audio_tokens: audioTokens } },
    },
  });
}

// ── the client's events ─────────────────────────────────────────────────────────────────────

async function open(s: SocketSession, ctx: HandlerContext): Promise<void> {
  const created = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  // the session's id is the World's (issued per connection: the manifest's _realtime_session, `sess_` and base62), never
  // the process's session counter
  const id = await ctx.issue('_realtime_session');
  Object.assign(state(s), { id, n: 0, items: [], spoke: false, buffer: [] });
  // the key is checked as every request's is (around.ts): one of the organization's project keys that still works.
  // Where the documentation stops: OpenAI does not say how its socket answers a refused key; the twin sends the API's
  // incorrect-key error as an error event and closes the connection
  // a browser client, which can send no header, offers its key as a subprotocol (`openai-insecure-api-key.<key>`)
  // source: https://developers.openai.com/api/docs/guides/realtime-websocket "Use a short-lived token fetched from your application server."
  const offered = (ctx.call.request.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim()).find((p) => p.startsWith('openai-insecure-api-key.'));
  const bearer = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization')?.trim() ?? '')?.[1] ?? offered?.slice('openai-insecure-api-key.'.length);
  const key = bearer ? ctx.rowsRaw(PROJECT_KEY, { withDeleted: true }).find((k) => k._sha256 === sha256(bearer)) : undefined;
  const archived = key ? ctx.row('Project', String(key._project_id))?.status === 'archived' : false;
  if (!key || key.deleted === true || archived) {
    error(s, bearer ? INVALID_KEY.message : "You didn't provide an API key. You need to provide your API key in an Authorization header using Bearer auth (i.e. Authorization: Bearer YOUR_KEY).", 'invalid_api_key', undefined);
    return s.close(1008, 'invalid_api_key');
  }
  const model = new URL(ctx.call.request.url).searchParams.get('model') || 'gpt-realtime';
  state(s).config = initial(id, model, created);
  // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Emitted automatically when a new connection is established as the first server event."
  event(s, 'session.created', { session: state(s).config });
}

async function message(s: SocketSession, frame: string): Promise<void> {
  const st = state(s);
  if (!st.config) return;
  let sent: Row;
  // Where the documentation stops: OpenAI does not give its words for a frame that is not JSON or an event it does not
  // know; the twin answers each with an invalid_request_error event and keeps the session, as most errors do
  try { sent = obj(JSON.parse(frame)); } catch { return error(s, 'The event is not valid JSON.', 'invalid_json', undefined); }
  const eventId = sent.event_id;
  switch (sent.type) {
    case 'session.update': {
      const session = obj(sent.session);
      const voice = obj(obj(session.audio).output).voice;
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "voice can be updated only if there have been no other audio outputs yet."
      if (voice !== undefined && st.spoke && voice !== obj(obj(st.config.audio).output).voice) return error(s, 'Cannot update a conversation\'s voice if assistant audio is present.', 'cannot_update_voice', eventId, 'session.audio.output.voice');
      st.config = updated(st.config, session);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "When the server receives a session.update , it will respond with a session.updated event showing the full, effective configuration."
      return event(s, 'session.updated', { session: st.config });
    }
    case 'conversation.item.create': {
      const sentItem = obj(sent.item);
      if (typeof sentItem.type !== 'string') return error(s, "Missing required parameter: 'item.type'.", 'missing_required_parameter', eventId, 'item.type');
      const item: Item = { ...sentItem, id: typeof sentItem.id === 'string' && sentItem.id ? sentItem.id : minted(s, 'item'), object: 'realtime.item', type: sentItem.type, status: 'completed' };
      const after = typeof sent.previous_item_id === 'string' ? sent.previous_item_id : undefined;
      const at = after === undefined ? st.items.length : after === 'root' ? 0 : st.items.findIndex((i) => i.id === after) + 1;
      if (at === 0 && after !== undefined && after !== 'root') return error(s, `Item with item_id '${after}' not found.`, 'item_not_found', eventId, 'previous_item_id');
      const previous = at > 0 ? st.items[at - 1]!.id : null;
      st.items.splice(at, 0, item);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "If successful, the server will emit a conversation.item.added event and, when the item is finalized, a conversation.item.done"
      event(s, 'conversation.item.added', { previous_item_id: previous, item });
      return event(s, 'conversation.item.done', { previous_item_id: previous, item });
    }
    case 'response.create':
      return respond(s, sent);
    case 'response.cancel':
      // a twin's response is answered whole before the next event is read, so none is ever in progress to cancel
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "If there is no response to cancel, the server will respond with an error."
      return error(s, 'Cancellation failed: no active response found', 'response_cancel_not_active', eventId);
    case 'conversation.item.truncate': {
      const item = st.items.find((i) => i.id === sent.item_id);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Only assistant message items can be truncated."
      if (!item || item.type !== 'message' || item.role !== 'assistant') return error(s, `Item with item_id '${String(sent.item_id)}' not found or not an assistant message.`, 'item_not_found', eventId, 'item_id');
      const end = Number(sent.audio_end_ms);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "If the audio_end_ms is greater than the actual audio duration, the server will respond with an error."
      if (!Number.isFinite(end) || end < 0 || end > AUDIO_MS) return error(s, `audio_end_ms ${String(sent.audio_end_ms)} is greater than the audio's duration (${AUDIO_MS} ms).`, 'invalid_value', eventId, 'audio_end_ms');
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Truncating audio will delete the server-side text transcript"
      item.content = arr(item.content).map((p) => (p.type === 'output_audio' ? { ...p, transcript: '' } : p));
      return event(s, 'conversation.item.truncated', { item_id: item.id, content_index: Number(sent.content_index ?? 0), audio_end_ms: end }); }
    case 'input_audio_buffer.append': {
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Send this event to append audio bytes to the input audio buffer."
      const bytes = typeof sent.audio === 'string' ? decoded(sent.audio) : undefined;
      if (!bytes) return invalidAudio(s, eventId);
      // the twin hears no speech in what it is sent, so its server VAD, when on, never commits on its own
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Unlike most other client events, the server will not send a confirmation response to this event."
      st.buffer.push(bytes);
      return;
    }
    case 'input_audio_buffer.commit': {
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "This event will produce an error if the input audio buffer is empty."
      // Where the documentation stops: OpenAI states the error, not its words or code
      if (!st.buffer.some((b) => b.length > 0)) return error(s, 'Error committing input audio buffer: the buffer is empty.', 'input_audio_buffer_commit_empty', eventId);
      const audio = new Uint8Array(st.buffer.reduce((n, b) => n + b.length, 0));
      st.buffer.reduce((at, b) => { audio.set(b, at); return at + b.length; }, 0);
      st.buffer = [];
      // the user's message holds the buffer's audio; its transcript is null, the twin transcribing nothing
      const item: Item = { id: minted(s, 'item'), object: 'realtime.item', type: 'message', role: 'user', status: 'completed', content: [{ type: 'input_audio', audio: base64(audio), transcript: null }] };
      const previous = st.items.at(-1)?.id ?? null;
      st.items.push(item);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "The server will respond with an input_audio_buffer.committed event."
      event(s, 'input_audio_buffer.committed', { previous_item_id: previous, item_id: item.id });
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "When the input audio buffer is committed. In this case the item will be a user message containing the audio from the buffer."
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "except for audio data, which can be retrieved separately with a conversation.item.retrieve event if necessary."
      event(s, 'conversation.item.added', { previous_item_id: previous, item: withoutAudio(item) });
      return event(s, 'conversation.item.done', { previous_item_id: previous, item: withoutAudio(item) });
    }
    case 'input_audio_buffer.clear':
      st.buffer = [];
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Send this event to clear the audio bytes in the buffer."
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when the input audio buffer is cleared by the client with a input_audio_buffer.clear event."
      return event(s, 'input_audio_buffer.cleared', {});
    case 'conversation.item.retrieve': {
      const item = st.items.find((i) => i.id === sent.item_id);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "unless the item does not exist in the conversation history, in which case the server will respond with an error."
      if (!item) return error(s, `Item with item_id '${String(sent.item_id)}' not found.`, 'item_not_found', eventId, 'item_id');
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "It includes the full content of the Item, including audio data."
      return event(s, 'conversation.item.retrieved', { item });
    }
    case 'conversation.item.delete': {
      const at = st.items.findIndex((i) => i.id === sent.item_id);
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "Send this event when you want to remove any item from the conversation history."
      if (at < 0) return error(s, `Item with item_id '${String(sent.item_id)}' not found.`, 'item_not_found', eventId, 'item_id');
      st.items.splice(at, 1);
      // source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when an item in the conversation is deleted by the client with a conversation.item.delete event."
      return event(s, 'conversation.item.deleted', { item_id: String(sent.item_id) });
    }
    case 'output_audio_buffer.clear':
      // the output audio buffer is WebRTC's and SIP's: a WebSocket client is sent each response's audio as it is made,
      // and no buffer is kept for it to clear. Where the documentation stops: OpenAI does not say how a WebSocket answers
      // the event; the twin refuses it with an invalid_request_error event and keeps the session
      // source: https://developers.openai.com/api/reference/resources/realtime/client-events "WebRTC/SIP Only: Emit to cut off the current audio response."
      return error(s, 'output_audio_buffer.clear is only supported for WebRTC and SIP connections.', 'invalid_value', eventId, 'type');
    default:
      return unsupportedEvent(s, sent.type, eventId);
  }
}

/** A message's content without its audio bytes, as conversation.item.added and .done carry it. */
const withoutAudio = (item: Item): Item => ({ ...item, content: arr(item.content).map(({ audio: _audio, ...part }) => part) });

/** Base64 audio as its bytes, or undefined when it is not base64. */
function decoded(audio: string): Uint8Array | undefined {
  try { return Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)); } catch { return undefined; }
}

export const realtime: SocketEngine<HandlerContext> = { open, message: (s, frame) => message(s, frame) };

function scenarioFault(s: SocketSession, body: unknown, eventId: unknown): void {
  const e = obj(obj(body).error);
  return event(s, 'error', { error: { type: String(e.type ?? 'server_error'), code: e.code ?? null, message: String(e.message ?? 'The server had an error while processing your request.'), param: null, event_id: typeof eventId === 'string' ? eventId : null } });
}
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "Returned when a Response is done streaming. Always emitted, no matter the final state."
function textDeltas(s: SocketSession, where: Row, text: string): void {
  event(s, 'response.output_text.delta', { ...where, delta: text });
  event(s, 'response.output_text.done', { ...where, text });
}
/** The client events OpenAI's reference lists, the values an event's `type` takes. */
// source: https://developers.openai.com/api/reference/resources/realtime/client-events "The event type, must be session.update ."
const CLIENT_EVENTS = ['session.update', 'input_audio_buffer.append', 'input_audio_buffer.commit', 'input_audio_buffer.clear', 'conversation.item.create', 'conversation.item.retrieve', 'conversation.item.truncate', 'conversation.item.delete', 'response.create', 'response.cancel', 'output_audio_buffer.clear'];
/** An event with no type, or one no client event of OpenAI's reference has. Where the documentation stops: OpenAI's
 *  error example gives a missing type's words; for an unlisted type OpenAI publishes no words, and the twin's answer
 *  (an invalid_event naming the values the reference lists) is its own. */
// source: https://developers.openai.com/api/reference/resources/realtime/server-events "invalid_event"
function unsupportedEvent(s: SocketSession, type: unknown, eventId: unknown): void {
  if (type === undefined) return error(s, "The 'type' field is missing.", 'invalid_event', eventId);
  return error(s, `Invalid value: '${String(type)}'. Supported values are: ${CLIENT_EVENTS.map((t) => `'${t}'`).join(', ')}.`, 'invalid_value', eventId, 'type');
}
/** An append whose audio is not base64 bytes. Where the documentation stops: OpenAI asks for base64 audio and does not
 *  give its words for other; the twin answers an invalid_request_error event naming the parameter. */
// source: https://developers.openai.com/api/reference/resources/realtime/client-events "Base64-encoded audio bytes."
function invalidAudio(s: SocketSession, eventId: unknown): void {
  return error(s, "Invalid 'audio'. Expected base64-encoded audio bytes.", 'invalid_value', eventId, 'audio');
}
