// OpenRouter's model catalogue (spec: getModels), as LibreChat's OpenRouter endpoint fetches it for its model list and
// each model's prices: the twin's catalogue (./shared.ts, MODELS), filtered and paged as the spec's parameters say. It
// needs no key.
import type { HandlerContext } from '@volter/world-core';
import { MODELS, orError, publicModel } from './shared.ts';

// source: spec:getModels "List all models and their properties"
export async function getModels(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const number = (name: string): number | undefined | null => {
    const raw = q.get(name);
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const offset = number('offset');
  const limit = number('limit');
  // source: spec:getModels "Maximum number of records to return (max 1000)."
  // Where the documentation stops: the refusal's words; its form is OpenRouter's 400
  if (offset === null || limit === null || (limit !== undefined && (limit < 1 || limit > 1000 || !Number.isInteger(limit))) || (offset !== undefined && !Number.isInteger(offset))) {
    return orError(400, 'Invalid query parameters');
  }
  // source: spec:getModels "Filter models by output modality. Accepts a comma-separated list of modalities"
  const outputs = (q.get('output_modalities') ?? 'text').split(',').map((s) => s.trim());
  // source: spec:getModels "Filter models by the organization that created the model. Comma-separated list of author slugs."
  const authors = q.get('model_authors')?.split(',').map((s) => s.trim()).filter(Boolean);
  // source: spec:getModels "Filter models by input modality. Comma-separated list of: text, image, audio, file."
  const inputs = q.get('input_modalities')?.split(',').map((s) => s.trim()).filter(Boolean);
  // source: spec:getModels "Minimum context length (tokens). Models with smaller context are excluded."
  const context = number('context');
  // source: spec:getModels "Minimum prompt price in $/M tokens."
  // source: spec:getModels "Maximum prompt price in $/M tokens."
  // source: spec:getModels "Minimum completion (output) price in $/M tokens."
  // source: spec:getModels "Minimum model age in days since its creation date."
  const bounds = Object.fromEntries(['min_price', 'max_price', 'min_output_price', 'max_output_price', 'min_age_days', 'max_age_days'].map((name) => [name, number(name)]));
  if (context === null || (context !== undefined && (!Number.isInteger(context) || context < 1)) || Object.values(bounds).some((v) => v === null) || ['min_age_days', 'max_age_days'].some((name) => typeof bounds[name] === 'number' && !Number.isInteger(bounds[name]))) return orError(400, 'Invalid query parameters');
  // source: spec:getModels "Filter models by supported parameter (comma-separated)"
  const parameters = q.get('supported_parameters')?.split(',').map((s) => s.trim()).filter(Boolean);
  // source: spec:getModels "Filter models by architecture/model family"
  const arch = q.get('arch');
  // Where the documentation stops: these depend on provider routing, account policy, use-case
  // categorization or live performance that the dated catalogue does not model. Refuse the unsupported
  // query instead of returning an unfiltered successful list. They are outside measured demand.
  if (['category', 'providers', 'distillable', 'zdr', 'region', 'min_intelligence_index', 'max_intelligence_index', 'min_coding_index', 'max_coding_index', 'min_agentic_index', 'max_agentic_index', 'min_tool_success_rate', 'max_tool_success_rate'].some((name) => q.has(name))) return orError(400, 'The twin does not model this catalogue filter');
  const sort = q.get('sort');
  if (sort && !['newest', 'pricing-low-to-high', 'pricing-high-to-low', 'context-high-to-low'].includes(sort)) return orError(400, 'The twin does not model this catalogue ordering');
  const within = (value: number, min: string, max: string): boolean => (typeof bounds[min] !== 'number' || value >= bounds[min]!) && (typeof bounds[max] !== 'number' || value <= bounds[max]!);
  // source: spec:getModels "Free-text search by model name or slug."
  const search = q.get('q')?.toLowerCase();
  const listed = MODELS.filter((m) => Date.parse(ctx.occurredAt) >= Date.parse(m.released) && (outputs.includes('all') || outputs.includes('text'))
    && (!authors?.length || authors.includes(m.id.split('/')[0]!))
    && (!inputs?.length || inputs.every((i) => m.inputs.includes(i)))
    && (typeof context !== 'number' || m.context >= context)
    && (!search || m.id.toLowerCase().includes(search) || m.name.toLowerCase().includes(search))
    && (!arch || m.tokenizer.toLowerCase() === arch.toLowerCase())
    && (!parameters?.length || parameters.every((parameter) => (publicModel(m).supported_parameters as string[]).includes(parameter)))
    && within(m.input, 'min_price', 'max_price') && within(m.output, 'min_output_price', 'max_output_price')
    && within((Date.parse(ctx.occurredAt) - Date.parse(m.released)) / 86_400_000, 'min_age_days', 'max_age_days'));
  // source: spec:getModels "newest (creation date)"
  // source: spec:getModels "average prompt/completion price"
  if (sort === 'newest') listed.sort((a, b) => Date.parse(b.released) - Date.parse(a.released));
  if (sort === 'pricing-low-to-high') listed.sort((a, b) => (a.input + a.output) - (b.input + b.output));
  if (sort === 'pricing-high-to-low') listed.sort((a, b) => (b.input + b.output) - (a.input + a.output));
  if (sort === 'context-high-to-low') listed.sort((a, b) => b.context - a.context);
  // source: spec:getModels "When both offset and limit are omitted, the full list is returned"
  const whole = offset === undefined && limit === undefined;
  const at = offset ?? 0;
  const size = limit ?? 500;
  const page = whole ? listed : listed.slice(at, at + size);
  const more = !whole && at + size < listed.length;
  const next = new URLSearchParams(q);
  next.set('offset', String(at + size));
  next.set('limit', String(size));
  return Response.json({
    data: page.map(publicModel), total_count: listed.length,
    // source: spec:/components/schemas/ModelsListResponse "/api/v1/models?offset=500&limit=500"
    links: { next: more ? `/api/v1/models?${next}` : null },
  });
}
