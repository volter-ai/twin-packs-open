// Gemini's computed model turns: no stored vendor resource and no model inference.
import type { HandlerContext } from '@volter/world-core';
import { arr, obj, liveModel, googleError, modelName, resolveModel, noModel, partsText, stubTurn, tokens, type Row, type Turn } from './shared.ts';

function scenarioTurn(ctx: HandlerContext): Turn | undefined {
  return ctx.scenario?.kind === 'handler' ? obj(ctx.scenario.respond) as Turn : undefined;
}
type Answer = { parts: Row[]; finishReason: string; usage: Row; grounding?: Row; ratings?: Row[]; feedback?: Row; model: string; responseId: string; count: number };

// source: https://ai.google.dev/gemini-api/docs/deprecations "the endpoint is no longer available"
async function answer(ctx: HandlerContext, method: string): Promise<Answer | Response> {
  const model = resolveModel(modelName(ctx.call.params.modelsId), ctx.occurredAt);
  if (!liveModel(model, ctx.occurredAt)) return noModel(model, method);
  const b = obj(ctx.body);
  const contents = arr(b.contents);
  // source: spec:/components/schemas/GenerateContentRequest/properties/contents "Required."
  // Documentation gives the error class, not exact wording for an empty contents list.
  if (!contents.length) return googleError(400, 'INVALID_ARGUMENT', 'contents is required.');
  const gen = obj(b.generationConfig ?? b.generation_config);
  // source: spec:/components/schemas/GenerationConfig/properties/temperature "2.0"
  if (gen.temperature !== undefined && (Number(gen.temperature) < 0 || Number(gen.temperature) > 2)) return googleError(400, 'INVALID_ARGUMENT', 'temperature is outside the supported range.');
  // source: spec:/components/schemas/GenerateContentRequest/properties/safetySettings "There should not be more than one setting"
  const safety = arr(b.safetySettings ?? b.safety_settings);
  if (new Set(safety.map((s) => s.category)).size !== safety.length) return googleError(400, 'INVALID_ARGUMENT', 'Only one safety setting per category is allowed.');
  const t = scenarioTurn(ctx) ?? stubTurn(b, model);
  const thinking = obj(gen.thinkingConfig ?? gen.thinking_config);
  // source: spec:/components/schemas/ThinkingConfig/properties/includeThoughts "thoughts are returned only when available"
  const includeThoughts = thinking.includeThoughts === true || thinking.include_thoughts === true;
  let text = t.text;
  let finish = t.finishReason ?? 'STOP';
  // source: spec:/components/schemas/GenerationConfig/properties/stopSequences "The stop sequence will not be included"
  const stops = gen.stopSequences ?? gen.stop_sequences;
  if (text !== undefined && Array.isArray(stops)) {
    const positions = stops.map((stop) => text!.indexOf(String(stop))).filter((p) => p >= 0);
    if (positions.length) text = text.slice(0, Math.min(...positions));
  }
  // source: spec:/components/schemas/GenerationConfig/properties/maxOutputTokens "The maximum number of tokens"
  const max = gen.maxOutputTokens ?? gen.max_output_tokens;
  if (text !== undefined && typeof max === 'number' && tokens(text) > max) { text = text.slice(0, Math.max(0, max * 4)); finish = 'MAX_TOKENS'; }
  const thought = t.thinking ?? (includeThoughts ? '[twin-stub] Synthetic reasoning; no model runs.' : undefined);
  // source: spec:/components/schemas/FunctionCallingConfig/properties/mode "NONE"
  const mode = obj(obj(b.toolConfig ?? b.tool_config).functionCallingConfig ?? obj(b.toolConfig ?? b.tool_config).function_calling_config).mode;
  const calls = String(mode ?? '').toUpperCase() === 'NONE' ? [] : t.functionCalls ?? [];
  let parts: Row[] = [...(includeThoughts && thought ? [{ text: thought, thought: true }] : []), ...(text !== undefined ? [{ text }] : []),
    ...calls.map((c) => ({ functionCall: c })), ...(t.parts ?? [])];
  // source: spec:/components/schemas/GenerationConfig/properties/responseModalities "The requested modalities"
  const modalities = gen.responseModalities ?? gen.response_modalities;
  if (Array.isArray(modalities)) parts = parts.filter((p) => p.inlineData ? modalities.includes('IMAGE') : modalities.includes('TEXT'));
  // source: https://ai.google.dev/api/generate-content "Controls the probability threshold at which harm is blocked."
  // Probability is model judgment supplied by the scenario. The configured threshold is a wire rule.
  const probability: Record<string, number> = { NEGLIGIBLE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const threshold: Record<string, number> = { BLOCK_LOW_AND_ABOVE: 1, BLOCK_MEDIUM_AND_ABOVE: 2, BLOCK_ONLY_HIGH: 3, BLOCK_NONE: 4, OFF: 4 };
  const ratings = t.safetyRatings?.map((rating) => {
    const setting = safety.find((s) => s.category === rating.category);
    const ceiling = threshold[String(setting?.threshold)];
    return { ...rating, ...(ceiling !== undefined ? { blocked: (probability[String(rating.probability)] ?? 0) >= ceiling } : {}) };
  });
  if (ratings?.some((r) => r.blocked === true)) { parts = []; finish = 'SAFETY'; }
  // Token counts are the stub's four-character estimate; scripts describe model judgment, not a real tokenizer.
  // source: https://ai.google.dev/gemini-api/docs/tokens "a token is equivalent to about 4 characters"
  const prompt = tokens([partsText(obj(b.systemInstruction ?? b.system_instruction).parts), ...contents.map((c) => partsText(c.parts))].join('\n'));
  const count = Math.max(1, Number(gen.candidateCount ?? gen.candidate_count ?? 1));
  const produced = t.promptFeedback?.blockReason ? 0 : tokens(parts.filter((p) => p.thought !== true).map((p) => typeof p.text === 'string' ? p.text : p.functionCall ? JSON.stringify(p.functionCall) : '').join('')) * count;
  const thoughts = t.promptFeedback?.blockReason ? 0 : tokens(parts.filter((p) => p.thought === true).map((p) => String(p.text ?? '')).join('')) * count;
  const usage = { promptTokenCount: prompt, candidatesTokenCount: produced, ...(thoughts ? { thoughtsTokenCount: thoughts } : {}), totalTokenCount: prompt + produced + thoughts };
  // source: spec:/components/schemas/GenerationConfig/properties/candidateCount "Number of generated responses"
  return { parts, finishReason: finish, usage, grounding: t.groundingMetadata, ratings, feedback: t.promptFeedback, model, responseId: await ctx.issue('_response'), count };
}
const candidate = (a: Answer, parts: Row[], final: boolean, index: number): Row => ({
  content: { parts, role: 'model' }, index, ...(final ? { finishReason: a.finishReason } : {}),
  ...(final && a.grounding ? { groundingMetadata: a.grounding } : {}), ...(a.ratings ? { safetyRatings: a.ratings } : {}),
});
const candidates = (a: Answer, parts: Row[], final: boolean): Row[] => a.feedback?.blockReason ? [] : Array.from({ length: a.count }, (_, i) => candidate(a, parts, final, i));

// source: spec:generativelanguage.models.generateContent "Generates a model response given an input"
export async function generativelanguage_models_generateContent(ctx: HandlerContext): Promise<Response> {
  const a = await answer(ctx, 'generateContent');
  return a instanceof Response ? a : Response.json({ candidates: candidates(a, a.parts, true), ...(a.feedback ? { promptFeedback: a.feedback } : {}), usageMetadata: a.usage, modelVersion: a.model, responseId: a.responseId });
}

// source: spec:generativelanguage.models.streamGenerateContent "Generates a"
export async function generativelanguage_models_streamGenerateContent(ctx: HandlerContext): Promise<Response> {
  const a = await answer(ctx, 'streamGenerateContent');
  if (a instanceof Response) return a;
  const text = a.parts.filter((p) => typeof p.text === 'string' && p.thought !== true).map((p) => String(p.text)).join('');
  const half = Math.ceil(text.length / 2);
  const pieces: Row[][] = [...a.parts.filter((p) => p.thought === true).map((p) => [p]),
    ...(text ? [[{ text: text.slice(0, half) }], ...(text.length > half ? [[{ text: text.slice(half) }]] : [])] : []),
    ...a.parts.filter((p) => typeof p.text !== 'string').map((p) => [p])];
  const chunks = (pieces.length ? pieces : [[]]).map((parts, i, all) => ({ candidates: candidates(a, parts, i === all.length - 1),
    ...(a.feedback ? { promptFeedback: a.feedback } : {}), usageMetadata: a.usage, modelVersion: a.model, responseId: a.responseId }));
  // source: https://ai.google.dev/api/generate-content "streamGenerateContent?alt=sse"
  return new URL(ctx.call.request.url).searchParams.get('alt') === 'sse'
    ? new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
    : Response.json(chunks);
}
