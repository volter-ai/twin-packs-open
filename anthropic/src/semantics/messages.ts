// The Messages API: a turn (POST /v1/messages, streamed or not, and the spec's `?beta=true` operation the SDK's beta
// namespace sends, as Claude Code does) and its token count (POST /v1/messages/count_tokens?beta=true, Claude Code's).
// The request is checked as the API checks it; the turn is the World's scenario's when it scripts one (ctx.scenario), else the labeled stub
// (./shared.ts); the answer, the stream and the usage, prompt-cache reads and writes included, are the vendor's.
import type { HandlerContext } from '@volter/world-core';
import { cacheFor, contentOf, WORKSPACE_HEADER, inputTokens, invalid, isLatest, messageShapeError, modelAvailable, restrictedSampling, outputTokens, refuse, requestId, type Row, segmentsOf, streamOf, stubTurn, type Turn } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A request's refusal, as the API words it, or undefined. Where the documentation stops: each message's words, as
 *  the API's validation answers them (`<field>: <problem>`). */
function checked(ctx: HandlerContext, b: Row, counting: boolean): Response | undefined {
  if (typeof b.model !== 'string' || !b.model) return invalid(ctx, 'model: Field required');
  if (!counting && (typeof b.max_tokens !== 'number' || !Number.isInteger(b.max_tokens))) return invalid(ctx, 'max_tokens: Field required');
  if (!counting && (b.max_tokens as number) < 0) return invalid(ctx, 'max_tokens: Input should be greater than or equal to 0');
  const shapeError = messageShapeError(b);
  if (shapeError) return invalid(ctx, shapeError);
  if (Array.isArray(b.tools) && b.tools.some((t: Row) => t && t.type !== undefined && t.input_schema === undefined) && !(ctx.scenario?.kind === 'handler' && (ctx.scenario.respond as Row)?.serverTools !== undefined)) return refuse(ctx, 404, 'not_found_error', 'This server tool is not modeled by the twin.');
  if (!modelAvailable(b.model, ctx.occurredAt)) return refuse(ctx, 404, 'not_found_error', `model: ${b.model}`);
  // source: spec:/components/schemas/CreateMessageParams "Models released after Claude Opus 4.6 do not accept top_k"
  // source: spec:/components/schemas/CreateMessageParams "A value >= 0.99 will be accepted for backwards compatibility"
  if (restrictedSampling(b.model)) {
    if (b.top_k !== undefined) return invalid(ctx, 'top_k is not supported for this model');
    if (b.top_p !== undefined && (typeof b.top_p !== 'number' || b.top_p < 0.99 || b.top_p > 1)) return invalid(ctx, 'top_p must be at least 0.99 for this model');
    if (b.temperature !== undefined && b.temperature !== 1) return invalid(ctx, 'temperature must be 1 for this model');
  }
  const thinking = b.thinking as Row | undefined;
  if (thinking?.type === 'enabled') {
    // source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking "Claude 4.7 and later models do not support it and reject requests that use it, returning a 400 error."
    if (isLatest(b.model)) return invalid(ctx, `thinking.type.enabled is not supported for this model. Use thinking.type.adaptive and output_config.effort to control thinking behavior.`);
    // source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking "Minimum of 1,024 tokens. The API rejects smaller values."
    if (typeof thinking.budget_tokens !== 'number' || thinking.budget_tokens < 1024) return invalid(ctx, 'thinking.enabled.budget_tokens: Input should be greater than or equal to 1024');
    // source: https://platform.claude.com/docs/en/build-with-claude/extended-thinking "Less than max_tokens."
    if (!counting && thinking.budget_tokens >= (b.max_tokens as number)) return invalid(ctx, '`max_tokens` must be greater than `thinking.budget_tokens`. Please consult our documentation at https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size');
  }
  const choice = b.tool_choice as Row | undefined;
  if (choice?.type === 'tool' && !((b.tools as Row[] | undefined) ?? []).some((t) => t.name === choice.name)) return invalid(ctx, `tool_choice.tool.name: Tool '${String(choice.name)}' not found in tools`);
  return undefined;
}

/** The turn the scenario decided, as the Messages API's parts. */
function scenarioTurn(ctx: HandlerContext): Turn | undefined {
  const d = ctx.scenario;
  if (!d || d.kind !== 'handler') return undefined;
  const r = (d.respond ?? {}) as Row;
  return {
    ...(typeof r.text === 'string' ? { text: r.text } : {}),
    ...(r.toolUses !== undefined ? { toolUses: (Array.isArray(r.toolUses) ? r.toolUses : [r.toolUses]) as Turn['toolUses'] } : {}),
    ...(r.serverTools !== undefined ? { serverTools: r.serverTools as Turn['serverTools'] } : {}),
    ...(typeof r.thinking === 'string' ? { thinking: r.thinking } : {}),
    ...(typeof r.stopReason === 'string' ? { stopReason: r.stopReason } : {}),
  };
}

async function turn(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const refused = checked(ctx, b, false);
  if (refused) return refused;
  const model = String(b.model);
  const workspace = ctx.call.request.headers.get(WORKSPACE_HEADER) ?? '';
  const segments = segmentsOf(b, model);
  const cache = await cacheFor(ctx, workspace, model, segments, true);
  const max = b.max_tokens as number;
  // source: spec:/components/schemas/CreateMessageParams "without generating a response."
  const t = max === 0 ? {} : scenarioTurn(ctx) ?? stubTurn(b);
  const thinking = (b.thinking as Row | undefined)?.type === 'enabled' || (b.thinking as Row | undefined)?.type === 'adaptive';
  const id = `msg_01${await ctx.issue('_message')}`;
  const content = max === 0 ? [] : contentOf(ctx, t, thinking, id);
  const produced = outputTokens(content, model);
  const stop = max === 0 ? 'max_tokens' : t.stopReason ?? (produced > max ? 'max_tokens' : t.toolUses?.length ? 'tool_use' : 'end_turn');
  const beta = ctx.call.operation.id === 'beta_messages_post';
  // source: spec:/components/schemas/Message "This will be non-null if a container tool"
  // source: spec:/components/schemas/Usage "Breakdown of output tokens by category"
  const message: Row = {
    id, type: 'message', role: 'assistant', model, content, stop_reason: stop, stop_sequence: null, stop_details: null, container: null,
    ...(beta ? { diagnostics: null, context_management: null } : {}),
    usage: { input_tokens: inputTokens(segments) - cache.cache_read_input_tokens - cache.cache_creation_input_tokens, ...cache, output_tokens: Math.min(produced, max), service_tier: 'standard', inference_geo: null, output_tokens_details: null, server_tool_use: null, ...(beta ? { fallback_credit: null, iterations: null, speed: null } : {}) },
  };
  const headers = { 'request-id': requestId(ctx) };
  // source: https://platform.claude.com/docs/en/build-with-claude/streaming "Each server-sent event includes a named event type and associated JSON data."
  return b.stream === true ? streamOf(message, headers) : Response.json(message, { headers });
}

/** POST /v1/messages */
// source: spec:messages_post "Send a structured list of input messages with text and/or image content"
export async function messages_post(ctx: HandlerContext): Promise<Response> { return turn(ctx); }
/** POST /v1/messages?beta=true */
// source: spec:beta_messages_post "Send a structured list of input messages with text and/or image content"
export async function beta_messages_post(ctx: HandlerContext): Promise<Response> { return turn(ctx); }

async function count(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const refused = checked(ctx, b, true);
  if (refused) return refused;
  // source: spec:/components/schemas/BetaCountMessageTokensResponse "The total number of tokens across the provided list of messages"
  return Response.json({ input_tokens: inputTokens(segmentsOf(b, String(b.model))), context_management: null }, { headers: { 'request-id': requestId(ctx) } });
}
/** POST /v1/messages/count_tokens?beta=true, as Claude Code sends it: the request's input tokens, no message made and
 *  nothing cached. */
// source: spec:beta_messages_count_tokens_post "Count the number of tokens in a Message."
export async function beta_messages_count_tokens_post(ctx: HandlerContext): Promise<Response> { return count(ctx); }
