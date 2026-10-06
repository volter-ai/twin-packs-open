// Chat completion semantics. A completion is the pack's behaviour, never a model: a scripted
// scenario's turn when one is loaded and a handler matches, else the labeled deterministic stub.
// Every completion is recorded (the call is the change); one made with `store: true` is also
// readable, with its request messages, until deleted. List, retrieve and delete of stored
// completions are the derived core's (the manifest makes only `_stored` ones readable).
import type { Handler, HandlerContext } from '@volter/world-core';
import { buildChatCompletion, page, recordUsage, type Row, type ChatCompletion, schemaFailure, send, streamChat, timeline, validateChat } from './shared.ts';

const COMPLETION = 'CreateChatCompletionResponse';

const create: Handler = async (ctx) => {
  const validated = validateChat(ctx.params);
  if ('error' in validated) return send(ctx, validated.error);
  const args = validated.args;
  const events: Array<{ data: unknown }> = [];
  let result!: ChatCompletion;
  await ctx.create(COMPLETION, (id) => {
  args.idSuffix = id.replace(/^chatcmpl-/, '');
  // the scenario's turn, decided by the front before dispatch (../fetch.ts; a fault it answers there, before any
  // completion exists)
  const decision = ctx.scenario;
  result = args.stream ? streamChat(args, (e) => { if (e.data) events.push({ data: e.data }); }, ctx.occurredAt, decision) : buildChatCompletion(args, ctx.occurredAt, decision);
  // the request's messages are kept for the stored completion's /messages
  // as the messages list shows them (https://platform.openai.com/docs/api-reference/chat/getMessages): the text, the
  // author's name or null, and the parts when the content was sent as parts, else null
  const inputMessages = args.messages.map((m, i) => {
    const parts = Array.isArray(m.content) ? (m.content as Array<{ type?: unknown; text?: unknown }>) : null;
    const content = parts ? parts.filter((c) => c.type === 'text').map((c) => String(c.text ?? '')).join('') : (m.content ?? null);
    // source: spec:getChatCompletionMessages "chatcmpl-AyPNinnUqUDYo9SAdA52NobMflmj2-0"
    return { id: `${result.id}-${i}`, role: m.role, content, name: (m as { name?: unknown }).name ?? null, content_parts: parts };
  });
  // a stored completion keeps its metadata, `{}` when none was sent (https://platform.openai.com/docs/api-reference/chat/object)
  // and reads back each reply message with its tool calls and legacy function call, null when it made none (the
  // reference's getChatCompletion and listChatCompletions examples)
  // A stored completion also keeps the request that made it: its id, and the settings it was sampled with, as sent or
  // their defaults (the reference's getChatCompletion example: request_id, seed, temperature, top_p, presence_penalty,
  // frequency_penalty, input_user, tools, tool_choice, response_format; spec/patches.json adds them to the object)
  // The request's id is `req_` and 32 hex characters, and an unseeded completion's seed an integer, each derived from the
  // completion's id
  // source: spec:getChatCompletion "req_ded8ab984ec4bf840f37566c1011c417"
  const p = ctx.params;
  const settings = {
    request_id: requestId(ctx, result.id),
    seed: typeof p.seed === 'number' ? p.seed : Number.parseInt(ctx.crypto.sha256(`seed:${result.id}`).slice(0, 13), 16),
    temperature: p.temperature ?? 1, top_p: p.top_p ?? 1, presence_penalty: p.presence_penalty ?? 0, frequency_penalty: p.frequency_penalty ?? 0,
    input_user: p.user ?? null, tools: p.tools ?? null, tool_choice: p.tool_choice ?? null, response_format: p.response_format ?? null,
  };
  const stored = args.store === true ? { metadata: result.metadata ?? {}, ...settings, choices: result.choices.map((c) => ({ ...c, message: { ...c.message, tool_calls: c.message.tool_calls ?? null, function_call: null } })) } : {};
  return { ...result, ...stored, _stored: args.store === true, _input_messages: inputMessages };
  }, 'chat.completions.create');
  await recordUsage(ctx, 'completions', result.model, result.usage.prompt_tokens, result.usage.completion_tokens);
  // the answer's x-request-id is the request's id the completion keeps, so the two agree (every other answer's is the
  // manifest's answerHeaders')
  const answer = args.stream ? ctx.sse(events) : ctx.reply(result);
  answer.headers.set('x-request-id', requestId(ctx, result.id));
  return answer;
};

const requestId = (ctx: HandlerContext, completion: string): string => `req_${ctx.crypto.sha256(`request:${completion}`).slice(0, 32)}`;

// the request's messages, kept when the completion was stored
const messages: Handler = async (ctx) => {
  const id = String(ctx.id);
  const row = ctx.row(COMPLETION, id);
  return row?._stored === true ? page(ctx, (row._input_messages as Row[] | undefined) ?? []) : ctx.notFound(COMPLETION, id);
};

export async function createChatCompletion(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  return create(ctx).catch(schemaFailure.bind(null, ctx, 'response_format'));
}

// source: spec:getChatCompletionMessages "Get the messages in a stored chat completion."
export async function getChatCompletionMessages(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  return messages(ctx);
}
