// What every OpenAI family's semantics share: its error answers, its cursor page, its update pick,
// the usage ledger every billable call writes, and the request shape the pack's helpers in
// model's builders take. All of it is over the handler's context.
import { personWith as codexPersonWith, recordPerson as codexRecordPerson, base62From, isReadOnlyRequest, placeholderPng as kernelPlaceholderPng, sha256, type Handler, type HandlerContext, type ScenarioDecision } from '@volter/world-core';

import type { openaiWire as CodexWire } from '@volter/world-core';
import { states } from './states.ts';

export type Row = Record<string, unknown>;

/** The request shape the pack's shared helpers take. */

/** An answer a pack helper built, with the headers it carries (a scripted fault's rate-limit family). */
export function send(ctx: HandlerContext, r: OpenAIResponseEnvelope): Response {
  if (!r.headers) return ctx.reply(r.body, r.status);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...r.headers } });
}

/** OpenAI's invalid_request_error: 400 with the parameter it names and the code when there is one. */
export const invalid = (ctx: HandlerContext, message: string, param?: string, code?: string): Response => ctx.refuse({ status: 400, message, ...(param ? { param } : {}), ...(code ? { code } : {}) });

/** The world clock as OpenAI's unix seconds. */
/** The World's instant, in Unix seconds (OpenAI's time). */
export const epoch = (ctx: HandlerContext): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

/** OpenAI's refusal of a key it does not hold or has stopped honouring (the manifest's `auth.invalid`, and a revoked
 *  project key's: OpenAI documents no other). */
export const INVALID_KEY = { status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.' };

/** A project's secret key, as the dashboard shows it once: drawn from a secret the World holds (ctx.secret), kept by its
 *  SHA-256. */
export const PROJECT_KEY = 'ProjectApiKey';

export const mintProjectKey = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> => `sk-proj-${(await ctx.secret(`project-key:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 48)}`;

/** A path parameter, by the name the spec gives it. */
export const at = (ctx: HandlerContext, name: string): string => ctx.call.params[name] ?? '';

/** An object parameter, or the fallback when the caller sent none. */
export const objectOr = (v: unknown, fallback: unknown): unknown => (v && typeof v === 'object' ? v : fallback);

/** Only the updatable fields present in the request (OpenAI's modify-by-POST). */
export function pick(params: Row, keys: string[]): Row {
  const out: Row = {};
  for (const k of keys) if (params[k] !== undefined) out[k] = params[k];
  return out;
}

/** Where a page starts after the cursor `after`: past that id, or, for an id the list does not hold, unknownCursor's. */
// source: https://developers.openai.com/api/reference/resources/chat/subresources/completions/subresources/messages/methods/list "Identifier for the last message from the previous pagination request."
export function startAfter(items: Row[], after: string): number {
  const i = items.findIndex((it) => it.id === after);
  return i >= 0 ? i + 1 : unknownCursor(items);
}

/** Where documentation stops: OpenAI says what `after` names (the last item of the previous page), not how it answers
 *  an id that is no item of the list. The twin starts past the end, an empty page, as the manifest's `unknownCursor:
 *  'end'` has the derived core's lists answer. */
export function unknownCursor(items: Row[]): number {
  return items.length;
}

/** OpenAI's cursor page over items in the order the caller asked (`order`, asc by default or desc): `after` starts
 *  past that id, `limit` defaults to 20 and caps at 100. An `order` outside the two is refused as OpenAI refuses an
 *  invalid parameter value, a 400 invalid_request_error naming `order`. */
// source: https://developers.openai.com/api/reference/resources/chat/subresources/completions/subresources/messages/methods/list "Use asc for ascending order or desc for descending order."
// source: spec:getChatCompletionMessages "Defaults to `asc`."
export function page(ctx: HandlerContext, listed: Row[]): Response {
  const order = ctx.params.order ?? 'asc';
  // source: https://developers.openai.com/api/docs/guides/error-codes "indicates that your request was malformed or missing some required parameters"
  // source: https://developers.openai.com/api/docs/guides/error-codes "as an invalid_request_error with error.param set to"
  // Where the documentation stops: OpenAI publishes no words for this; the message is the twin's own. The second line
  // is the page's entry for an invalid service_tier: it supports the error's shape (a 400 invalid_request_error whose
  // error.param names the parameter) by analogy only, the page naming no refusal of `order`.
  if (order !== 'asc' && order !== 'desc') return invalid(ctx, `Invalid value: '${String(order)}'. Supported values are: 'asc' and 'desc'.`, 'order');
  const items = order === 'desc' ? [...listed].reverse() : listed;
  const after = typeof ctx.params.after === 'string' ? ctx.params.after : '';
  let limit = Number(ctx.params.limit);
  if (!Number.isInteger(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  const start = after ? startAfter(items, after) : 0;
  const data = items.slice(start, start + limit);
  return ctx.reply({ object: 'list', data, has_more: start + limit < items.length, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
}

/** A billable call's usage, priced per model: what the organization usage and costs reports read. `extra` is what the
 *  call's own report counts besides tokens (a speech's characters, a transcription's seconds, an image call's images,
 *  size and source, a container's session). */
export async function recordUsage(ctx: HandlerContext, kind: string, model: string, inputTokens: number, outputTokens: number, extra: Row = {}): Promise<void> {
  await ctx.record('_usage_record', {
    object: '_usage_record', kind, model, input_tokens: inputTokens, output_tokens: outputTokens,
    num_model_requests: 1, cost_usd: usageCost(model, inputTokens, outputTokens), created_at: epoch(ctx), ...extra,
  });
}

// ── from progress ─────────────────────────────────────────────────────────────────────────────────────
// The work OpenAI does on its own. A batch, a fine-tuning job, a run, an eval run and a vector store's
// files are created where OpenAI starts them (validating, queued, in progress) and OpenAI moves them
// on; the twin does that work when a read first looks, walking the vendor's declared moves in
// ./states.ts (actor 'vendor') to where they end, read and then written. A subject the caller holds (a paused job) or that is already done stays put.
// A read-only (mirror) twin answers stored state as it is and never moves anything.

/** Marks a context served by a read-only (mirror) twin: its subjects come from the real vendor, so it
 *  has no vendor progress to simulate and a read never writes. */

/** Whether this request is served by a read-only twin. */
/** A read-only request (a World's read token, or a twin started read-only): its reads write nothing. */
export const readOnly = (ctx: HandlerContext): boolean => isReadOnlyRequest(ctx.call.request);

/** Where the vendor takes each in-flight state next, per resource. */
export const PROGRESS: Record<string, Record<string, string>> = { RunObject: { queued: 'in_progress', in_progress: 'completed', cancelling: 'cancelled' } };

/** Whether the vendor still has work to do on a stored subject. */
export const inFlight = (resource: string, row: Row): boolean => String(row.status) in (PROGRESS[resource] ?? {});

/** The effects the manifest declares on the vendor's move `from` → `to`, as values. */
export function effects(ctx: HandlerContext, resource: string, from: string, to: string): Row {
  const machine = (states as Record<string, { state?: { status?: { transitions: Array<{ actor?: string; to?: string; from: string[] | '*'; effects?: Record<string, { now?: true; value?: unknown }> }> } } }>)[resource]?.state?.status;
  const t = machine?.transitions.find((x) => x.actor === 'vendor' && x.to === to && x.from !== '*' && x.from.includes(from));
  const out: Row = {};
  for (const [k, rule] of Object.entries(t?.effects ?? {})) out[k] = 'now' in rule ? epoch(ctx) : 'value' in rule ? rule.value : null;
  return out;
}

/** Walk one subject to where the vendor leaves it. `finish` adds what its end state carries (an
 *  output file, a fine-tuned model). Answers the end state when this read is the one that moved it. */
export async function progress(ctx: HandlerContext, resource: string, id: string, finish?: (row: Row, end: string) => Row): Promise<{ from: string; to: string; row: Row } | undefined> {
  if (readOnly(ctx)) return undefined;
  let moved: { from: string; to: string; row: Row } | undefined;
  // Each declared vendor move is a stored entry, including the intermediate in-progress state.
  await ctx.asVendor(async () => {
    let advanced: boolean;
    do {
      advanced = false;
      await ctx.change(resource, id, (current) => {
        if (!inFlight(resource, current)) return undefined;
        const path = PROGRESS[resource]!, from = String(current.status), to = path[from]!;
        if (ctx.legal(resource, 'status', ctx.call.operation.id, from, to, id, 'vendor')) return undefined;
        const fields = { ...effects(ctx, resource, from, to), status: to, ...(!(to in path) ? finish?.(current, to) ?? {} : {}) };
        moved = { from: moved?.from ?? from, to, row: { ...current, ...fields } };
        advanced = true;
        return fields;
      }, `${ctx.storedType(resource)}.update`);
    } while (advanced);
  });
  return moved;
}

// ── from model-catalog ────────────────────────────────────────────────────────────────────────────────
// OpenAI model catalog — the static `GET /v1/models` surface. Real OpenAI serves a list of
// model objects ({ id, object:'model', created, owned_by }). The twin returns a faithful,
// deterministic subset so `client.models.list()` / `client.models.retrieve(id)` round-trip
// exactly like the vendor.
//
// This is a STATIC surface (the model registry doesn't change at runtime), so it is a plain
// data table rather than kernel state — listing/retrieving models is a pure read.
export type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  /** When the model shuts down, or null when no date is announced (https://platform.openai.com/docs/api-reference/models/object) */
  shutdown_date: string | null;
};

// OpenAI's timeline, as data (the catalog, each API family's removal, and the dated policy changes).
//
// Every model the pack's walks name, with its release (`created`) and its shutdown. Sources: the changelog
// (https://developers.openai.com/api/docs/changelog) dates a release: "Released GPT-6 Astra" 2026-09-03, "Released GPT
// Image 2.5 Sunburst and GPT Image 2.5 Flare" 2026-09-08, "Released GPT-5.2" 2025-12-11, "Released gpt-image-1.5"
// 2025-12-16, "Added a new image generation model, `gpt-image-1`" 2025-04-23, "Released GPT-5 family of models"
// 2025-08-07, "Added two new o-series reasoning models, `o3` and `o4-mini`" 2025-04-16, "Launched o3-mini" 2025-01-31,
// "Added `gpt-4o-mini-tts`, `gpt-4o-transcribe`..." 2025-03-20, "Released GPT-4o mini" 2024-07-18, "Released new
// `omni-moderation-latest`" 2024-09-26. The deprecations page (https://developers.openai.com/api/docs/deprecations) dates
// a shutdown: gpt-3.5-turbo, gpt-4-turbo, o4-mini, o3-mini and gpt-image-1 on 2026-10-23; dall-e-2 and dall-e-3 on
// 2026-05-12; gpt-image-1.5 on 2026-12-01; whisper-1 and the gpt-4o transcribe models on 2027-02-26.
// Where neither page dates a release, `created` is the value OpenAI's own model object answers (the earlier catalog's
// entries, and dall-e-2's and tts-1's). Extrapolation: gpt-4o-transcribe-diarize's release is documented nowhere the twin could
// read; it is dated with the transcribe family it belongs to (2025-03-20).
export const model = (id: string, created: number, shutdown_date: string | null = null, owned_by = 'system'): OpenAIModel => ({ id, object: 'model', created, owned_by, shutdown_date });

export const OPENAI_MODELS: OpenAIModel[] = [
  // source: https://developers.openai.com/api/docs/changelog "Released the GPT-5.6 model family"
  // source: https://developers.openai.com/api/docs/models/gpt-5.6-luna "gpt-5.6-luna"
  model('gpt-5.6-luna', 1783555200, null, 'openai'),
  model('gpt-6-astra', 1788393600, null, 'openai'),
  // source: spec:/components/schemas/BetaModelIdsShared "gpt-5.4-mini-2026-03-17"
  model('gpt-5.4-mini', 1773705600),
  // source: spec:/components/schemas/CreateImageEditRequest "chatgpt-image-latest"
  // The spec names this moving alias but dates neither its release nor its model object's created value.
  // A zero creation timestamp is the synthetic catalog's undated entry, not a claimed vendor release.
  model('gpt-5.2', 1765411200),
  model('gpt-5', 1754524800),
  model('gpt-4o', 1715367049),
  model('gpt-4o-mini', 1721172741),
  model('gpt-4o-mini-2024-07-18', 1721260800),
  model('gpt-4.1', 1744316542),
  model('gpt-4.1-mini', 1744317547),
  // source: spec:/components/schemas/ModelIdsShared "gpt-audio-mini-2025-12-15"
  // Dated by the snapshot the spec names for the alias; its model object's created value is documented nowhere the twin could read.
  model('gpt-audio-mini', 1765756800),
  model('gpt-4-turbo', 1712361441, '2026-10-23'),
  model('o3', 1744761600),
  model('o4-mini', 1744761600, '2026-10-23'),
  model('o3-mini', 1738281600, '2026-10-23'),
  model('gpt-3.5-turbo', 1677610602, '2026-10-23', 'openai'),
  model('text-embedding-3-small', 1705948997),
  model('text-embedding-3-large', 1705953180),
  model('text-embedding-ada-002', 1671217299, null, 'openai-internal'),
  model('dall-e-2', 1698798177, '2026-05-12'),
  model('dall-e-3', 1698785189, '2026-05-12'),
  model('gpt-image-1', 1745366400, '2026-10-23'),
  model('gpt-image-1.5', 1765843200, '2026-12-01'),
  model('gpt-image-2.5-flare', 1788825600),
  model('whisper-1', 1677532384, '2027-02-26', 'openai-internal'),
  model('gpt-4o-transcribe', 1742428800, '2027-02-26'),
  model('gpt-4o-mini-transcribe', 1742428800, '2027-02-26'),
  model('gpt-4o-transcribe-diarize', 1742428800, '2027-02-26'),
  model('tts-1', 1681940951, null, 'openai-internal'),
  model('gpt-4o-mini-tts', 1742428800),
  model('omni-moderation-latest', 1727308800),
  model('chatgpt-image-latest', 0),
];

/** The instant a shutdown date takes effect: "At the time of the shut down, the model or endpoint will no longer be
 *  accessible" (the deprecations page); the twin takes the date's first instant, UTC. */
export const shutdownAt = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 1000;

/** Whether a catalogued model is live at the World instant `now` (unix seconds): released, and not yet shut down. A model
 *  the catalog does not hold is not live: it does not exist. */
export function live(id: string, now: number): boolean {
  const m = OPENAI_MODELS.find((x) => x.id === id);
  return !!m && m.created <= now && (m.shutdown_date === null || now < shutdownAt(m.shutdown_date));
}

/** The API families OpenAI removed, by the operations they serve, and the instant each is gone: the Assistants API on
 *  2026-08-26 ("removal from the API one year later, on August 26, 2026"), the Evals API on 2026-11-30 ("The Evals
 *  dashboard and API are scheduled to shut down"), its evals read-only from 2026-10-31 ("Existing evals become
 *  read-only") (https://developers.openai.com/api/docs/deprecations). */
export const REMOVED_FAMILIES: Array<{ family: string; removed: string; operations: RegExp; readOnlyFrom?: string; writes?: RegExp }> = [
  { family: 'Assistants API', removed: '2026-08-26', operations: /^(createAssistant|listAssistants|getAssistant|modifyAssistant|deleteAssistant|createThread|createThreadAndRun|getThread|modifyThread|deleteThread|createMessage|listMessages|getMessage|modifyMessage|deleteMessage|createRun|listRuns|getRun|modifyRun|cancelRun|submitToolOuputsToRun|listRunSteps|getRunStep)$/ },
  { family: 'Evals API', removed: '2026-11-30', operations: /^(createEval|listEvals|getEval|updateEval|deleteEval|createEvalRun|getEvalRuns|getEvalRun|cancelEvalRun|deleteEvalRun|getEvalRunOutputItems|getEvalRunOutputItem)$/, readOnlyFrom: '2026-10-31', writes: /^(createEval|updateEval|deleteEval|createEvalRun|cancelEvalRun|deleteEvalRun)$/ },
];

/** A removed family's answer to an operation at `now`, or none while it is served. The deprecations page says only that
 *  a removed endpoint "will no longer be accessible": the status and wording of the answer are the twin's own. */
export function removedAt(operation: string, now: number): { status: number; message: string } | undefined {
  for (const f of REMOVED_FAMILIES) {
    if (!f.operations.test(operation)) continue;
    if (now >= shutdownAt(f.removed)) return { status: 404, message: `The ${f.family} was removed on ${f.removed}.` };
    if (f.readOnlyFrom && f.writes?.test(operation) && now >= shutdownAt(f.readOnlyFrom)) return { status: 400, message: `Evals are read-only since ${f.readOnlyFrom}.` };
  }
  return undefined;
}

/** Resolve a model object by id, or undefined if the twin doesn't model it. */
export function findModel(id: string): OpenAIModel | undefined {
  return OPENAI_MODELS.find((m) => m.id === id);
}

/** Whether a model reasons, so that its responses list the reasoning item that describes its chain of thought and count
 *  its reasoning tokens (the spec's ReasoningItem: "A description of the chain of thought used by a reasoning model while
 *  generating a response"). The o-series and the GPT models from GPT-5 on reason: the spec speaks of "all reasoning models
 *  after `gpt-5`", and the reasoning guide (https://developers.openai.com/api/docs/guides/reasoning) lists gpt-6-astra,
 *  gpt-5.6, gpt-5.5 and gpt-5.4 among them; gpt-6-astra's page names "Reasoning token support"
 *  (https://developers.openai.com/api/docs/models/gpt-6-astra). A fine-tuned model reasons as its base does. */
export function reasons(model: string): boolean {
  const base = model.startsWith('ft:') ? model.split(':')[1] ?? '' : model;
  return /^o\d/.test(base) || /^gpt-([5-9]|\d{2,})(\b|[.-])/.test(base);
}

/** The reasoning efforts the spec's ReasoningEffort names; a model may document fewer. */
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** The effort a reasoning model spends when the request names none: the spec's ReasoningEffort `default: medium`. */
export const DEFAULT_EFFORT = 'medium';

/** What a model's page says it takes and refuses. gpt-6-astra: "`reasoning.effort` supports `low`, `medium`, `high`,
 *  `xhigh`, and `max`" (its model page); "GPT-6 Astra does not support `none` reasoning effort. Setting
 *  `reasoning.effort` (Responses) or `reasoning_effort` (Chat Completions) to `none` returns HTTP 400" (the reasoning
 *  guide); "does not support custom `temperature` or `top_p` values or log probabilities (`logprobs`)" (the changelog,
 *  2026-09-03). */
export const LIMITS: Record<string, { efforts: string[]; sampling: false; logprobs: false; chatTools: false }> = {
  'gpt-6-astra': { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], sampling: false, logprobs: false, chatTools: false },
};

/** OpenAI's refusal of a request a model does not take (an effort, custom sampling, log probabilities), or none. */
export function unsupported(model: string, req: { effort?: unknown; effortParam: string; temperature?: unknown; top_p?: unknown; logprobs?: unknown; chatTools?: unknown }): { message: string; param: string } | undefined {
  const base = model.startsWith('ft:') ? model.split(':')[1] ?? '' : model;
  const limits = LIMITS[base];
  // source: https://developers.openai.com/api/docs/models/gpt-5.6-luna "Reasoning.effort supports: none, low, medium (default), high, xhigh, and max."
  const efforts = limits?.efforts ?? (base === 'gpt-5.6-luna' ? ['none','low','medium','high','xhigh','max'] : REASONING_EFFORTS);
  if (req.effort !== undefined && (typeof req.effort !== 'string' || !efforts.includes(req.effort))) {
    return { message: `Unsupported value: '${req.effortParam}' does not support ${JSON.stringify(req.effort)} with this model. Supported values are: ${efforts.map((e) => `'${e}'`).join(', ')}.`, param: req.effortParam };
  }
  if (!limits) return undefined;
  for (const k of ['temperature', 'top_p'] as const) {
    if (req[k] !== undefined && req[k] !== 1) return { message: `Unsupported value: '${k}' does not support ${JSON.stringify(req[k])} with this model. Only the default (1) value is supported.`, param: k };
  }
  if (req.logprobs === true) return { message: "Unsupported parameter: 'logprobs' is not supported with this model.", param: 'logprobs' };
  // "Tool calling requires the Responses API. If you use tools with Chat Completions, follow the Responses migration
  // guide" (https://developers.openai.com/api/docs/changelog, 2026-09-03). The changelog gives no wording for the
  // refusal: this message is the twin's own.
  if (Array.isArray(req.chatTools) && req.chatTools.length) return { message: 'Tool calling with this model requires the Responses API: send the request to /v1/responses.', param: 'tools' };
  return undefined;
}

export const DEFAULT_MODEL: Record<string, string> = { createImage: 'dall-e-2', createImageEdit: 'gpt-image-1.5', createImageVariation: 'dall-e-2', createModeration: 'omni-moderation-latest' };

/** The model a request runs on: the one it names, else its operation's default (a variation runs on dall-e-2 whatever it names). */
export function modelOf(operation: string, params: { model?: unknown }): string | undefined {
  if (operation === 'createImageVariation') return DEFAULT_MODEL.createImageVariation;
  return typeof params.model === 'string' && params.model ? params.model : DEFAULT_MODEL[operation];
}

/** The models' own operations: they list and read the catalog as it stands, whatever it holds. */
export const MODEL_OPERATIONS = new Set(['listModels', 'retrieveModel', 'deleteModel']);

/** OpenAI's timeline at the World's instant, asked by every handler first: an operation of a removed API family answers
 *  as removed; a request naming a model that is not live (not in the catalog, not yet released, or shut down) answers
 *  OpenAI's model_not_found, as for any model that does not exist. A fine-tuned model is live while the job that made
 *  it holds it and it is not deleted. An operation that names no model runs on its default (DEFAULT_MODEL). The refusal,
 *  or nothing. */
export function timeline(ctx: HandlerContext): Response | undefined {
  const id = ctx.call.operation.id;
  const now = epoch(ctx);
  const removed = removedAt(id, now);
  if (removed) return ctx.refuse({ status: removed.status, message: removed.message });
  if (MODEL_OPERATIONS.has(id)) return undefined;
  const p = ctx.params as { model?: unknown; data_source?: { model?: unknown } };
  const named = typeof p.data_source?.model === 'string' && typeof p.model !== 'string' ? p.data_source.model : modelOf(id, p);
  if (!named) return undefined;
  const tuned = named.startsWith('ft:') && ctx.rowsRaw('FineTuningJob', { withDeleted: true }).some((j) => j.fine_tuned_model === named) && !ctx.rowsRaw('Model', { withDeleted: true }).some((m) => m.id === named && m.deleted);
  return tuned || live(named, now) ? undefined : ctx.notFound('Model', named);
}

// ── from media-bytes ──────────────────────────────────────────────────────────────────────────────────
// The media an image or audio endpoint takes and gives. OpenAI takes an uploaded image or audio file only in the
// formats its reference names, told by the file's bytes, and a GPT image model answers the image itself as base64:
//   • an image to edit is "a `png`, `webp`, or `jpg` file" for the GPT image models, and for `dall-e-2` "a square
//     `png`" (developers.openai.com/api/reference/resources/images/methods/edit, `image`); a variation's is "a valid
//     PNG file, less than 4MB, and square" (…/images/methods/create_variation, `image`);
//   • a transcription or translation takes "the audio file object (not file name)" in "one of these formats: flac,
//     mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm" (…/audio/subresources/transcriptions/methods/create, `file`);
//   • the GPT image models "always return base64-encoded images" (…/images/methods/generate, `response_format`).
// Where the documentation stops and the twin decides: a format is told by its signature bytes; the image the twin
// answers is a real PNG of the requested size in one flat colour drawn from the prompt, labeled in its own text
// chunk, since the twin renders no pixels.

/** The raw bytes of an uploaded file part, as the request's multipart parse keeps them; undefined for a string. */
export function partBytes(v: unknown): Uint8Array | undefined {
  const b = v && typeof v === 'object' ? (v as { bytes?: unknown }).bytes : undefined;
  return b instanceof Uint8Array ? b : undefined;
}

export const has = (b: Uint8Array, sig: string | number[], at = 0): boolean =>
  (typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig).every((x, i) => b[at + i] === x);

export const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Each image format a signature tells, checked in this order. */
export const IMAGE: Array<['png' | 'jpg' | 'webp', (b: Uint8Array) => boolean]> = [
  ['jpg', (b) => has(b, [0xff, 0xd8, 0xff])],
  ['webp', (b) => has(b, 'RIFF') && has(b, 'WEBP', 8)],
  ['png', (b) => has(b, PNG) && has(b, 'IHDR', 12)],
];

/** An image's format by its signature: png, jpg or webp, else undefined. */
export const imageFormat = (b: Uint8Array): 'png' | 'jpg' | 'webp' | undefined => IMAGE.find(([, is]) => is(b))?.[0];

/** A PNG's width and height from its IHDR chunk. */
export function pngSize(b: Uint8Array): { width: number; height: number } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** Each audio format OpenAI transcribes that a signature tells, checked in this order. */
export const AUDIO: Array<[string, (b: Uint8Array) => boolean]> = [
  ['flac', (b) => has(b, 'fLaC')],
  ['ogg', (b) => has(b, 'OggS')],
  ['webm', (b) => has(b, [0x1a, 0x45, 0xdf, 0xa3])],
  ['mp4', (b) => has(b, 'ftyp', 4)],
  ['mp3', (b) => has(b, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)],
  ['wav', (b) => has(b, 'RIFF') && has(b, 'WAVE', 8)],
];

/** An audio file's format by its signature, among those OpenAI transcribes, else undefined. */
export const audioFormat = (b: Uint8Array): string | undefined => AUDIO.find(([, is]) => is(b))?.[0];

/** A WAV file's length in seconds, from its `fmt ` byte rate and its `data` size (RIFF chunks in any order); undefined
 *  for any other format, whose length the twin does not read. */
export function wavSeconds(b: Uint8Array): number | undefined {
  if (!has(b, 'RIFF') || !has(b, 'WAVE', 8)) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let rate = 0;
  let data = 0;
  for (let at = 12; at + 8 <= b.length; at += 8 + v.getUint32(at + 4, true) + (v.getUint32(at + 4, true) & 1)) {
    if (has(b, 'fmt ', at)) rate = v.getUint32(at + 16, true);
    if (has(b, 'data', at)) data = v.getUint32(at + 4, true);
  }
  return rate > 0 ? data / rate : undefined;
}

/** The size an image request asks for (`1536x1024`), or the fallback for `auto` or none. */
export function requestedSize(size: unknown, fallback: { width: number; height: number } = { width: 1024, height: 1024 }): { width: number; height: number } {
  const m = typeof size === 'string' ? /^(\d+)x(\d+)$/.exec(size) : null;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback;
}

/** A real PNG of the size asked, one flat colour drawn from `seed`, labeled as the twin's placeholder: the kernel's. */
export const placeholderPng = (size: { width: number; height: number }, seed: string): Uint8Array => kernelPlaceholderPng(size, seed);

/** Bytes as base64. */
export function base64(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ── Speech: the audio file itself ────────────────────────────────────────────────────────────────────────────────
// Text to speech answers "the audio file content" in the requested `response_format`, `mp3` by default, of mp3, opus,
// aac, flac, wav and pcm (developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create); its
// audio is 24 kHz mono. The twin speaks nothing: each is a real file of that format, a second of silence.
export const RATE = 24000;

/** A second of 24 kHz 16-bit mono silence as samples' bytes: `pcm`, raw little-endian with no header. */
export const silentPcm = (): Uint8Array => new Uint8Array(RATE * 2);

/** The same second as a WAV file. */
export function silentWav(): Uint8Array {
  const data = RATE * 2;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set(ascii('RIFF'), 0); v.setUint32(4, 36 + data, true); b.set(ascii('WAVEfmt '), 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  b.set(ascii('data'), 36); v.setUint32(40, data, true);
  return b;
}

/** The same second as MP3: MPEG-2 Layer III frames at 24 kHz, 32 kbit/s, mono, each 576 samples in 96 bytes whose
 *  side information codes no spectral data, which a decoder plays as silence. */
export function silentMp3(): Uint8Array {
  const frames = Math.ceil(RATE / 576);
  const b = new Uint8Array(frames * 96);
  for (let i = 0; i < frames; i++) b.set([0xff, 0xf3, 0x44, 0xc4], i * 96);
  return b;
}

/** The same second as FLAC: a STREAMINFO block and frames of 4096 samples, each one CONSTANT subframe of zero. */
export function silentFlac(): Uint8Array {
  const block = 4096;
  const info = bitWriter();
  info.put(block, 16); info.put(block, 16); info.put(0, 24); info.put(0, 24);
  info.put(RATE, 20); info.put(0, 3); info.put(15, 5); info.put(0, 4); info.put(RATE, 32);
  for (let i = 0; i < 16; i++) info.put(0, 8); // MD5 unknown
  const out: number[] = [...ascii('fLaC'), 0x80, 0, 0, 34, ...info.bytes()];
  for (let n = 0, left = RATE; left > 0; n++, left -= block) {
    const size = Math.min(block, left);
    // blocksize 4096 (code 12) or, for the last, 16 bits of size-1 at the header's end (code 7); 24 kHz is code 7
    const head = [0xff, 0xf8, ((size === block ? 12 : 7) << 4) | 7, 0x08, n, ...(size === block ? [] : [(size - 1) >> 8, (size - 1) & 0xff])];
    const frame = [...head, crc8(head), 0x00, 0x00, 0x00];
    const c = crc16(frame);
    out.push(...frame, c >> 8, c & 0xff);
  }
  return Uint8Array.from(out);
}

/** The same second as AAC in ADTS: AAC-LC frames of 1024 samples at 24 kHz, mono, each one channel element with
 *  no scale-factor bands, which a decoder plays as silence. */
export function silentAac(): Uint8Array {
  const payload = [0x00, 0x00, 0x00, 0x07]; // SCE, global gain 0, max_sfb 0, no tools; END
  const length = 7 + payload.length;
  const frame = bitWriter();
  frame.put(0xfff, 12); frame.put(0, 1); frame.put(0, 2); frame.put(1, 1); // MPEG-4, no CRC
  frame.put(1, 2); frame.put(6, 4); frame.put(0, 1); frame.put(1, 3); // AAC-LC, 24 kHz, mono
  frame.put(0, 4); frame.put(length, 13); frame.put(0x7ff, 11); frame.put(0, 2);
  const one = [...frame.bytes(), ...payload];
  return Uint8Array.from(Array.from({ length: Math.ceil(RATE / 1024) }, () => one).flat());
}

/** The same second as Opus in Ogg: its identification and comment headers, then 20 ms packets of silence. */
export function silentOpus(): Uint8Array {
  const head = [...ascii('OpusHead'), 1, 1, 0x38, 0x01, ...le32(RATE), 0, 0, 0];
  const tags = [...ascii('OpusTags'), ...le32(4), ...ascii('twin'), ...le32(0)];
  const packets = Array.from({ length: 50 }, () => [0xf8, 0xff, 0xfe]);
  return Uint8Array.from([...oggPage(0x02, 0, 0, [head]), ...oggPage(0, 0, 1, [tags]), ...oggPage(0x04, 312 + 48000, 2, packets)]);
}

export const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

export const le32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

/** A big-endian bit writer. */
export function bitWriter(): { put(value: number, bits: number): void; bytes(): number[] } {
  const out: number[] = [];
  let acc = 0, n = 0;
  return {
    put(value, bits) {
      for (let i = bits - 1; i >= 0; i--) {
        acc = (acc << 1) | (Math.floor(value / 2 ** i) & 1);
        if (++n === 8) { out.push(acc); acc = 0; n = 0; }
      }
    },
    bytes: () => out,
  };
}

export function crc8(b: number[]): number {
  let c = 0;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; }
  return c;
}

export function crc16(b: number[]): number {
  let c = 0;
  for (const x of b) { c ^= x << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; }
  return c;
}

/** One Ogg page of stream 1 holding whole packets, its CRC over the page with the field zeroed. */
export function oggPage(flags: number, granule: number, seq: number, packets: number[][]): number[] {
  const lacing = packets.flatMap((p) => [...Array(Math.floor(p.length / 255)).fill(255), p.length % 255]);
  const page = [...ascii('OggS'), 0, flags, ...le32(granule), 0, 0, 0, 0, ...le32(1), ...le32(seq), 0, 0, 0, 0, lacing.length, ...lacing, ...packets.flat()];
  let c = 0;
  for (const x of page) { c ^= x << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0; }
  page.splice(22, 4, ...le32(c));
  return page;
}

/** The handler response. `headers` (when present) are response headers the HTTP server should set
 *  — e.g. `Retry-After` + the `x-ratelimit-*` family on a modeled 429. */
export type OpenAIResponseEnvelope = { status: number; body: unknown; headers?: Record<string, string> };

// ── vendor-shaped errors ──────────────────────────────────────────────────────────────
export function errBody(type: string, message: string, code: string | null = null, param: string | null = null) {
  return { error: { message, type, param, code } };
}

export function invalidRequest(message: string, param: string | null = null, code: string | null = null): OpenAIResponseEnvelope {
  return { status: 400, body: errBody('invalid_request_error', message, code, param) };
}

export function nowEpoch(occurredAt?: string): number {
  return Math.floor((occurredAt ? Date.parse(occurredAt) : 0) / 1000);
}

// ── usage ledger (real recorded usage → the usage/costs reporting endpoints) ──────────────
// Every billable inference call appends a usage record (model + token counts + a synthetic cost
// computed from a per-model price table). The /v1/organization/usage|costs endpoints aggregate
// these REAL recorded rows — nothing is hardcoded; with no traffic the report is genuinely empty.
// Per-model USD price per 1M tokens (a faithful slice of the published price sheet; deterministic).
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  // source: https://developers.openai.com/api/docs/models/gpt-5.6-luna "$0.20"
  // source: https://developers.openai.com/api/docs/models/gpt-5.6-luna "$1.20"
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'o3': { input: 2, output: 8 },
  'o4-mini': { input: 1.1, output: 4.4 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
  'text-embedding-ada-002': { input: 0.1, output: 0 },
};

export function modelPrice(model: string): { input: number; output: number } {
  return MODEL_PRICES[model] ?? { input: 0, output: 0 };
}

export function usageCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = modelPrice(model);
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}

// source: spec:getChatCompletion "fp_50cad350e4"
export const SYSTEM_FINGERPRINT = `fp_${sha256('openai-twin-stub').slice(0, 10)}`;

// ── chat completions: validate the request the same way the vendor does ──────────────────
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string };

export type ResponseFormat = { kind: 'text' } | { kind: 'json_object' } | { kind: 'json_schema'; schema: unknown };

export type ChatArgs = {
  idSuffix?: string;
  model: string;
  messages: ChatMessageParam[];
  tools?: unknown;
  functions?: unknown;
  n: number;
  maxTokens?: number;
  stop?: string[];
  stream: boolean;
  toolChoice?: ToolChoice;
  parallelToolCalls: boolean;
  responseFormat: ResponseFormat;
  includeUsage: boolean;
  logprobs: boolean;
  topLogprobs?: number;
  seed?: number;
  logitBias?: Record<string, number>;
  prediction?: string;
  /** the reasoning effort a reasoning model spends (the request's `reasoning_effort`, else the default) */
  reasoningEffort?: string;
  store: boolean;
  metadata?: Record<string, unknown>;
  /** modalities: ['text'] (default) or ['text','audio'] — audio asks for a spoken output. */
  audioOutput?: { voice: string; format: string };
};

/** The roles a chat message may have (the spec's ChatCompletionRequestMessage variants). */
export const ROLES = new Set(['developer', 'system', 'user', 'assistant', 'tool', 'function']);

/** OpenAI's refusal of a chat message whose role is not one of the request message types
 *  (https://platform.openai.com/docs/api-reference/chat/create, `messages`). */
export function invalidRole(): { error: OpenAIResponseEnvelope } {
  return { error: invalidRequest("each message must have a valid 'role'", 'messages') };
}

export type ChatRefusal = { error: OpenAIResponseEnvelope };

// The chat options below are OpenAI's (https://platform.openai.com/docs/api-reference/chat/create); each
// parser answers the option's value or OpenAI's refusal of it.

/** `n`: how many choices to generate, at least one. */
export function chatN(raw: unknown): number | ChatRefusal {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : { error: invalidRequest("'n' must be an integer >= 1", 'n') };
}

/** `max_completion_tokens` (or the legacy `max_tokens`): a cap of at least one token. */
export function chatMaxTokens(raw: unknown): number | ChatRefusal {
  const max = Number(raw);
  return Number.isInteger(max) && max >= 1 ? max : { error: invalidRequest("'max_tokens' must be an integer >= 1", 'max_tokens') };
}

/** `stop`: one sequence or a list of them. */
export function chatStop(raw: unknown): string[] | ChatRefusal {
  if (typeof raw === 'string') return [raw];
  return Array.isArray(raw) ? (raw as string[]) : { error: invalidRequest("'stop' must be a string or array of strings", 'stop') };
}

/** `tool_choice`: 'auto' | 'none' | 'required' | { type:'function', function:{ name } }. */
export function chatToolChoice(raw: unknown): ToolChoice | ChatRefusal {
  if (raw === 'auto' || raw === 'none' || raw === 'required') return raw;
  return nonAutomaticChatToolChoice(raw);
}
export function nonAutomaticChatToolChoice(raw: unknown): ToolChoice | ChatRefusal {
  if (!raw || typeof raw !== 'object') return { error: invalidRequest("'tool_choice' must be 'auto'/'none'/'required' or a named function", 'tool_choice') };
  return namedChatToolChoice(raw);
}
export function namedChatToolChoice(raw: object): ToolChoice | ChatRefusal {
  const fn = (raw as { function?: { name?: unknown } }).function;
  return typeof fn?.name === 'string' ? { name: fn.name } : { error: invalidRequest("invalid 'tool_choice' — named choice requires function.name", 'tool_choice') };
}

/** OpenAI's refusal of a `response_format` whose type is none of text, json_object and json_schema. */
export function badResponseFormat(): ChatRefusal {
  return { error: invalidRequest("'response_format.type' must be 'text', 'json_object', or 'json_schema'", 'response_format') };
}

/** `top_logprobs`: 0 to 20 alternatives per token, only with `logprobs: true`. */
export function chatTopLogprobs(raw: unknown, logprobs: boolean): number | ChatRefusal {
  const top = Number(raw);
  if (!Number.isInteger(top) || top < 0 || top > 20) return { error: invalidRequest("'top_logprobs' must be an integer between 0 and 20", 'top_logprobs') };
  return logprobs ? top : { error: invalidRequest("'top_logprobs' requires 'logprobs' to be true", 'top_logprobs') };
}

/** `seed`: an integer for best-effort reproducible sampling. */
export function chatSeed(raw: unknown): number | ChatRefusal {
  const seed = Number(raw);
  return Number.isInteger(seed) ? seed : { error: invalidRequest("'seed' must be an integer", 'seed') };
}

/** `logit_bias`: token ids mapped to a bias from -100 to 100. */
export function chatLogitBias(raw: unknown): Record<string, number> | ChatRefusal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: invalidRequest("'logit_bias' must be an object mapping token ids to bias values", 'logit_bias') };
  const bias: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(v);
    if (!Number.isFinite(num) || num < -100 || num > 100) return { error: invalidRequest("each 'logit_bias' value must be a number between -100 and 100", 'logit_bias') };
    bias[k] = num;
  }
  return bias;
}

/** `prediction`: predicted output, `{ type: 'content', content }`, its content a string or text parts. */
export function chatPrediction(raw: unknown): string | ChatRefusal {
  const p = raw as { type?: unknown; content?: unknown } | undefined;
  if (!p || typeof p !== 'object' || p.type !== 'content' || p.content === undefined) return { error: invalidRequest("'prediction' must be an object with type 'content' and a content field", 'prediction') };
  if (typeof p.content === 'string') return p.content;
  return Array.isArray(p.content) ? p.content.map((c) => (c && typeof c === 'object' ? String((c as { text?: unknown }).text ?? '') : String(c))).join('') : '';
}

/** `modalities` with `audio`: a spoken answer needs `audio: { voice, format }` (the vendor's rule). The twin
 *  can't synthesize speech, so the returned bytes are a labeled stub; the envelope is faithful. */
export function chatAudio(modalities: unknown, audio: unknown): { voice: string; format: string } | ChatRefusal | undefined {
  if (!Array.isArray(modalities)) return { error: invalidRequest("'modalities' must be an array", 'modalities') };
  if (!(modalities as unknown[]).includes('audio')) return undefined;
  const a = audio as { voice?: unknown; format?: unknown } | undefined;
  if (!a || typeof a !== 'object' || typeof a.voice !== 'string' || typeof a.format !== 'string') return { error: invalidRequest("'audio' with a 'voice' and 'format' is required when 'modalities' includes 'audio'", 'audio') };
  return { voice: a.voice, format: a.format };
}

export function validateChat(params: Record<string, unknown>): { args: ChatArgs } | { error: OpenAIResponseEnvelope } {
  if (params.model === undefined || params.model === '') return { error: invalidRequest("you must provide a model parameter", 'model') };
  if (typeof params.model !== 'string') return { error: invalidRequest("'model' must be a string", 'model') };
  if (!Array.isArray(params.messages)) return { error: invalidRequest("you must provide a messages parameter", 'messages') };
  if (params.messages.length === 0) return { error: invalidRequest("[] is too short - 'messages'", 'messages') };
  const messages = params.messages as ChatMessageParam[];
  if (messages.some((m) => !m || typeof m !== 'object' || !ROLES.has(String(m.role)))) return invalidRole();
  // Each option the request may carry is parsed by its own function (below): a function returns the
  // option's value, or OpenAI's refusal of it as `{ error }`.
  const n = params.n === undefined ? 1 : chatN(params.n);
  if (typeof n !== 'number') return n;
  // max_completion_tokens is the current name; max_tokens is the legacy alias.
  const maxRaw = params.max_completion_tokens ?? params.max_tokens;
  const maxTokens = maxRaw === undefined ? undefined : chatMaxTokens(maxRaw);
  if (typeof maxTokens === 'object') return maxTokens;
  const stop = params.stop === undefined ? undefined : chatStop(params.stop);
  if (stop && !Array.isArray(stop)) return stop;
  const toolChoice = params.tool_choice === undefined ? undefined : chatToolChoice(params.tool_choice);
  if (toolChoice && typeof toolChoice === 'object' && 'error' in toolChoice) return toolChoice;
  // response_format: { type:'text' | 'json_object' | 'json_schema', json_schema? }.
  let responseFormat: ResponseFormat = { kind: 'text' };
  const rf = params.response_format;
  if (rf !== undefined) {
    if (!rf || typeof rf !== 'object') return { error: invalidRequest("'response_format' must be an object", 'response_format') };
    const t = (rf as { type?: unknown }).type ?? 'text';
    const format: ResponseFormat | undefined = t === 'json_schema' ? { kind: 'json_schema', schema: (rf as { json_schema?: unknown }).json_schema } : t === 'json_object' || t === 'text' ? { kind: t } : undefined;
    if (!format) return badResponseFormat();
    responseFormat = format;
  }
  // stream_options.include_usage → emit a final usage-only chunk in the stream.
  const so = params.stream_options as { include_usage?: unknown } | undefined;
  const includeUsage = !!(so && typeof so === 'object' && so.include_usage === true);
  // logprobs (boolean) + top_logprobs (0..20, requires logprobs:true) → per-token logprob detail.
  const logprobs = params.logprobs === true;
  const topLogprobs = params.top_logprobs === undefined ? undefined : chatTopLogprobs(params.top_logprobs, logprobs);
  if (typeof topLogprobs === 'object') return topLogprobs;
  // seed → reproducible sampling (the twin is already deterministic; we echo it via fingerprint).
  const seed = params.seed === undefined ? undefined : chatSeed(params.seed);
  if (typeof seed === 'object') return seed;
  // logit_bias → a map of token-id → bias in [-100, 100].
  const logitBias = params.logit_bias === undefined ? undefined : chatLogitBias(params.logit_bias);
  if (logitBias && 'error' in logitBias) return logitBias as { error: OpenAIResponseEnvelope };
  // prediction → predicted outputs ({ type:'content', content }); content may be a string or parts.
  const prediction = params.prediction === undefined ? undefined : chatPrediction(params.prediction);
  if (typeof prediction === 'object') return prediction;
  // modalities + audio → audio output.
  const audioOutput = params.modalities === undefined ? undefined : chatAudio(params.modalities, params.audio);
  if (audioOutput && 'error' in audioOutput) return audioOutput;
  // store + metadata → stored completions (retrievable later); metadata must be a flat object.
  // a model refuses what its page says it does not take (the model catalog); a reasoning model reasons with the effort
  // asked for, else the spec's default
  const refused = unsupported(params.model, { effort: params.reasoning_effort, effortParam: 'reasoning_effort', temperature: params.temperature, top_p: params.top_p, logprobs: params.logprobs, chatTools: params.tools ?? params.functions });
  if (refused) return { error: invalidRequest(refused.message, refused.param, 'unsupported_value') };
  const reasoningEffort = typeof params.reasoning_effort === 'string' ? params.reasoning_effort : reasons(params.model) ? DEFAULT_EFFORT : undefined;
  const store = params.store === true;
  const checkedMetadata = params.metadata === undefined ? undefined : chatMetadata(params.metadata);
  if (checkedMetadata && 'error' in checkedMetadata) return checkedMetadata;
  const metadata = checkedMetadata?.value;
  return {
    args: {
      model: params.model,
      messages,
      tools: params.tools,
      functions: params.functions,
      n,
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(stop !== undefined ? { stop } : {}),
      stream: params.stream === true,
      ...(toolChoice !== undefined ? { toolChoice } : {}),
      parallelToolCalls: params.parallel_tool_calls !== false,
      responseFormat,
      includeUsage,
      logprobs,
      ...(topLogprobs !== undefined ? { topLogprobs } : {}),
      ...(seed !== undefined ? { seed } : {}),
      ...(logitBias !== undefined ? { logitBias: logitBias as Record<string, number> } : {}),
      ...(prediction !== undefined ? { prediction } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      store,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(audioOutput !== undefined ? { audioOutput: audioOutput as { voice: string; format: string } } : {}),
    },
  };
}

/** The text cut at the EARLIEST-occurring stop sequence across the whole `stop` list, not whichever is
 *  listed first: the real vendor's "stop generation at the first hit", regardless of array order. */
export function stoppedAt(text: string, stops: string[]): string {
  let stopAt = -1;
  for (const s of stops) {
    if (!s) continue;
    const i = text.indexOf(s);
    if (i >= 0 && (stopAt < 0 || i < stopAt)) stopAt = i;
  }
  return stopAt >= 0 ? text.slice(0, stopAt) : text;
}

/** The text cut to a `max_completion_tokens` cap (about four characters a token); the choice finishes `length`. */
export function cutAt(text: string, maxTokens: number): string {
  return text.slice(0, maxTokens * 4);
}

/** modalities:['audio'] → the assistant replies with an audio object (content is null, the text lives in
 *  audio.transcript). The twin can't synthesize speech, so `data` is a labeled-stub base64 string; the shape
 *  (id/data/transcript/expires_at) is vendor-faithful. */
export function audioChoice(args: ChatArgs, idx: number, transcript: string, logprobs: ChatChoice['logprobs'], finish: ChatChoice['finish_reason']): { choice: ChatChoice; completionTokens: number } {
  const voice = args.audioOutput!;
  const stubBytes = `[twin-stub:${args.model}] no real audio synthesis — voice=${voice.voice} format=${voice.format}; transcript: ${transcript}`;
  // Where documentation stops: the audio id is documented as unique, without a literal prefix or suffix length.
  // The opaque fallback uses audio_ and the default 27 base62 characters, derived from the completion and choice.
  // source: spec:/components/schemas/ChatCompletionResponseMessage/properties/audio/anyOf/0/properties/id "Unique identifier for this audio response."
  const audio = {
    id: `audio_${base62From(`audio:${stableSuffix(args)}:${idx}`, 27)}`,
    data: Buffer.from(stubBytes, 'utf8').toString('base64'),
    transcript,
    expires_at: nowEpoch() + 3600,
  };
  return {
    choice: { index: idx, message: { role: 'assistant', content: null, refusal: null, audio }, logprobs, finish_reason: finish },
    completionTokens: estimateTokens(transcript),
  };
}

// Build ONE deterministic stub choice (index `idx`). Honors tools/functions (tool_calls +
// finish_reason tool_calls), tool_choice (none/required/named), parallel_tool_calls,
// response_format (json_object/json_schema), max_tokens, and stop sequences.
export function buildChoice(args: ChatArgs, idx: number): { choice: ChatChoice; completionTokens: number } {
  const toolsSource = args.tools ?? args.functions;
  const hasTools = Array.isArray(toolsSource) && toolsSource.length > 0;
  // tool_choice gates whether the stub calls a tool: 'none' forbids it; a named/required choice
  // forces it (even when the heuristic otherwise would not); 'auto'/default calls when tools exist.
  const forbidTools = args.toolChoice === 'none';
  const forcedName = typeof args.toolChoice === 'object' ? args.toolChoice.name : undefined;
  // a model answers a tool's result in words unless the caller insists on another call; one that always
  // called a tool would never let an app's tool loop end
  const answeringTool = ['tool', 'function'].includes(String(args.messages.at(-1)?.role));
  const wantTool = hasTools && !forbidTools && (!answeringTool || forcedName !== undefined || args.toolChoice === 'required');
  if (wantTool) {
    // parallel_tool_calls (default true) → the stub may emit one call per provided tool; a named
    // choice or parallel:false collapses to a single call.
    // (the tools are there, so each call is made)
    const calls: ChatToolCall[] = forcedName || args.parallelToolCalls === false
      ? [stubToolCall(toolsSource, idx + 1, forcedName, lastUserText(args.messages), stableSuffix(args))!]
      : (toolsSource as unknown[]).map((tool, t) => stubToolCall([tool], idx * 100 + t + 1, undefined, lastUserText(args.messages), stableSuffix(args))!);
    return {
      choice: { index: idx, message: { role: 'assistant', content: null, tool_calls: calls, refusal: null }, logprobs: null, finish_reason: 'tool_calls' },
      completionTokens: estimateTokens(JSON.stringify(calls)),
    };
  }
  // json_mode: when response_format requests json_object/json_schema, the content is valid JSON.
  // prediction (predicted outputs): a real model uses the prediction to speed decoding but still
  // returns its own generation — the twin echoes the predicted content (clearly still a stub) so
  // the prediction round-trips, then reports accepted/rejected prediction tokens in usage.
  let text = args.prediction !== undefined
    ? `[twin-stub:${args.model}] predicted-output echo: ${args.prediction}`
    : args.responseFormat.kind === 'json_object'
      ? stubJsonObject(args.messages, args.model)
      : args.responseFormat.kind === 'json_schema'
        ? stubJsonObject(args.messages, args.model, args.responseFormat.schema)
        : stubAssistantText(args.messages, args.model);
  if (args.stop) text = stoppedAt(text, args.stop);
  const capped = args.maxTokens !== undefined && estimateTokens(text) > args.maxTokens;
  if (capped) text = cutAt(text, args.maxTokens!);
  const finish: ChatChoice['finish_reason'] = capped ? 'length' : 'stop';
  const logprobs = args.logprobs ? buildLogprobs(text, args.topLogprobs ?? 0) : null;
  if (args.audioOutput) return audioChoice(args, idx, text, logprobs, finish);
  return {
    // a text answer carries its annotations (none: the twin cites no web source), as OpenAI's does
    // (https://platform.openai.com/docs/api-reference/chat/object, `choices[].message.annotations`)
    choice: { index: idx, message: { role: 'assistant', content: text, refusal: null, annotations: [] }, logprobs, finish_reason: finish },
    completionTokens: estimateTokens(text),
  };
}

/** Predicted-output accounting: the twin echoes the prediction, so every predicted token is "accepted". */
export function predictionUsage(prediction: string): Pick<NonNullable<ChatUsage['completion_tokens_details']>, 'accepted_prediction_tokens' | 'rejected_prediction_tokens'> {
  return { accepted_prediction_tokens: estimateTokens(prediction), rejected_prediction_tokens: 0 };
}

export function buildChatCompletion(args: ChatArgs, occurredAt?: string, decision?: ScenarioDecision): ChatCompletion {
  const promptTokens = countPromptTokens(args.messages);
  // Scenario handlers: a fired handler scripts the assistant turn; a miss teaches in the stub. The
  // decision was made (and any fault honored) by the request handler through the engine's serve(); this
  // builder only realizes it — a status fault never reaches here.
  const turn = decision && scenarioTurn(decision, `chatcmpl-${stableSuffix(args)}`);
  const choices: ChatChoice[] = [];
  let completionTokens = 0;
  for (let i = 0; i < args.n; i++) {
    const { choice, completionTokens: ct } = turn?.scripted ? scriptedChoice(turn.scripted, i) : buildChoice(args, i);
    if (turn?.missTeach && typeof choice.message.content === 'string') choice.message.content += turn.missTeach;
    choices.push(choice);
    completionTokens += ct;
  }
  // usage breaks its counts down as OpenAI's does (https://platform.openai.com/docs/api-reference/chat/object,
  // `usage.prompt_tokens_details`, `usage.completion_tokens_details`): the twin caches nothing and reasons and
  // speaks nothing, so those are zero
  const usage: ChatUsage = {
    prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
  };
  // prediction (predicted outputs): real responses report how many predicted tokens were accepted
  // vs rejected. The twin echoes the prediction, so all predicted tokens are "accepted".
  if (args.prediction !== undefined) usage.completion_tokens_details = { ...usage.completion_tokens_details!, ...predictionUsage(args.prediction) };
  // a reasoning model's reasoning tokens are billed as output tokens (https://developers.openai.com/api/docs/guides/reasoning:
  // "they still occupy space in the model's context window and are billed as output tokens")
  if (args.reasoningEffort !== undefined && reasons(args.model)) {
    const spent = REASONING_BUDGET[args.reasoningEffort] ?? 0;
    usage.completion_tokens += spent;
    usage.total_tokens += spent;
    usage.completion_tokens_details = { ...usage.completion_tokens_details!, reasoning_tokens: spent };
  }
  return {
    // source: spec:createChatCompletion "chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT"
    id: `chatcmpl-${stableSuffix(args)}`,
    object: 'chat.completion',
    created: nowEpoch(occurredAt),
    model: args.model,
    choices,
    usage,
    system_fingerprint: SYSTEM_FINGERPRINT,
    // the tier that served the request: the standard one, which is what `auto` and `default` pick for a project
    // not on Scale Tier (https://platform.openai.com/docs/api-reference/chat/object, `service_tier`)
    service_tier: 'default',
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
  };
}

// The kernel allocated this stored occurrence; every wire identifier is bound to it.
export const stableSuffix = (args: ChatArgs): string => args.idSuffix!;
export function chatMetadata(raw: unknown): { value: Row } | ChatRefusal {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { value: raw as Row } : { error: invalidRequest("'metadata' must be an object", 'metadata') };
}

// Split text into deterministic streaming chunks (≤ ~20 chars each), preserving order.
export function chunkText(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 20) out.push(text.slice(i, i + 20));
  return out;
}

/** A streamed choice's tool calls: one tool_calls delta-pair per call, each carrying its own `index`
 *  (parallel tool calls). */
export function streamToolCalls(calls: ChatToolCall[], idx: number, base: Record<string, unknown>, sink: SseSink): void {
  calls.forEach((tc, tIdx) => {
    sink({ data: { ...base, choices: [{ index: idx, delta: { tool_calls: [{ index: tIdx, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] }, logprobs: null, finish_reason: null }] } });
    sink({ data: { ...base, choices: [{ index: idx, delta: { tool_calls: [{ index: tIdx, function: { arguments: tc.function.arguments } }] }, logprobs: null, finish_reason: null }] } });
  });
}

/**
 * Emit the vendor-faithful Chat Completions streaming sequence into the injected sink (NO
 * sockets, NO setTimeout). Real order: a first chunk with `delta:{role:'assistant'}`, then
 * `delta:{content}` chunks (or tool_calls deltas), then a final chunk with `finish_reason`,
 * then `[DONE]`. Deterministic + synchronous so a collector can assert the full sequence.
 */
export function streamChat(args: ChatArgs, sink: SseSink, occurredAt?: string, decision?: ScenarioDecision): ChatCompletion {
  const full = buildChatCompletion(args, occurredAt, decision);
  const base = { id: full.id, object: 'chat.completion.chunk' as const, created: full.created, model: full.model, system_fingerprint: SYSTEM_FINGERPRINT };
  for (const choice of full.choices) {
    const idx = choice.index;
    // role chunk
    sink({ data: { ...base, choices: [{ index: idx, delta: { role: 'assistant', content: '' }, logprobs: null, finish_reason: null }] } });
    if (choice.message.tool_calls && choice.message.tool_calls.length) streamToolCalls(choice.message.tool_calls, idx, base, sink);
    else {
      for (const piece of chunkText(choice.message.content ?? '')) {
        sink({ data: { ...base, choices: [{ index: idx, delta: { content: piece }, logprobs: null, finish_reason: null }] } });
      }
    }
    sink({ data: { ...base, choices: [{ index: idx, delta: {}, logprobs: null, finish_reason: choice.finish_reason }] } });
  }
  // stream_options.include_usage → a final chunk with an empty choices array carrying `usage`.
  if (args.includeUsage) {
    sink({ data: { ...base, choices: [], usage: full.usage } });
  }
  sink({ done: true });
  return full;
}

// ── Responses API ───────────────────────────────────────────────────────────────────────
export type ResponsesArgs = {
  inputItems: Record<string, unknown>[];
  instructions?: string;
  model: string;
  inputText: string;
  messages: ChatMessageParam[];
  stream: boolean;
  store: boolean;
  previousResponseId?: string;
  /** reasoning.effort ('minimal'|'low'|'medium'|'high') → emit a reasoning item + reasoning_tokens. */
  reasoningEffort?: string;
  /** background:true → the response is created `queued` and processed asynchronously (poll + cancel). */
  background: boolean;
  /** The caller's tools, as sent (Responses shape `{type:'function', name, parameters}`); the scenario reads their names. */
  tools?: unknown;
  /** max_output_tokens, when sent — the output cap a scenario handler may key on. */
  maxTokens?: number;
  /** the request's settings a response answers back as sent, or OpenAI's defaults */
  echo: { metadata: unknown; temperature: unknown; top_p: unknown; parallel_tool_calls: unknown; tool_choice: unknown; text: unknown; truncation: unknown; user: unknown; max_tool_calls: unknown; top_logprobs: unknown; service_tier: unknown };
  /** reasoning.summary, when sent: a reasoning item carries a summary only when one is asked for */
  reasoningSummary?: string;
};

export function responseMessages(items: Record<string, unknown>[], instructions?: string): ChatMessageParam[] {
  const messages: ChatMessageParam[] = instructions ? [{ role: 'system', content: instructions }] : [];
  const partsText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c && typeof c === 'object' ? String(c.text ?? JSON.stringify(c)) : String(c)).join('\n') : '';
  for (const item of items) {
    if (item.type === 'function_call') {
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: String(item.call_id ?? item.id ?? ''), type: 'function', function: { name: String(item.name ?? ''), arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}) } }] });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', content: partsText(item.output), tool_call_id: String(item.call_id ?? '') });
    } else if (item.type === 'message' || item.type === undefined) {
      messages.push({ role: (item.role ?? 'user') as ChatMessageParam['role'], content: partsText(item.content) });
    }
    // Reasoning and other typed items remain in state, without inventing user turns.
  }
  return messages;
}

/** OpenAI's refusal of an `input` list holding something other than input items (objects)
 *  (https://platform.openai.com/docs/api-reference/responses/create, `input`). */
export function itemsNotObjects(): { error: OpenAIResponseEnvelope } {
  return { error: invalidRequest("'input' items must be objects", 'input') };
}

export function badResponsesInput(): ChatRefusal {
  return { error: invalidRequest("'input' must be a string or an array of input items", 'input') };
}

export function validateResponses(params: Record<string, unknown>): { args: ResponsesArgs } | { error: OpenAIResponseEnvelope } {
  if (params.model === undefined || params.model === '') return { error: invalidRequest("you must provide a model parameter", 'model') };
  if (typeof params.model !== 'string') return { error: invalidRequest("'model' must be a string", 'model') };
  if (params.input === undefined) return { error: invalidRequest("you must provide an input parameter", 'input') };
  // Keep vendor items as state; the messages view is only a projection for the scenario.
  if (typeof params.input !== 'string' && !Array.isArray(params.input)) return badResponsesInput();
  let inputItems: Record<string, unknown>[] = [];
  if (typeof params.input === 'string') {
    inputItems = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: params.input }] }];
  } else if (Array.isArray(params.input)) {
    if (params.input.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) return itemsNotObjects();
    inputItems = params.input.map((item: Record<string, unknown>) => {
      if (item.type !== undefined && item.type !== 'message') return { ...item };
      return { ...item, type: 'message', role: item.role ?? 'user', content: typeof item.content === 'string' ? [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text: item.content }] : item.content };
    });
  }
  const instructions = typeof params.instructions === 'string' ? params.instructions : undefined;
  const messages = responseMessages(inputItems, instructions);
  const inputText = responseMessages(inputItems).map((m) => m.content).filter(Boolean).join('\n');
  if (params.tools !== undefined && !Array.isArray(params.tools)) return { error: invalidRequest("'tools' must be an array", 'tools') };
  const maxOut = params.max_output_tokens;
  if (maxOut !== undefined && (typeof maxOut !== 'number' || !Number.isInteger(maxOut) || maxOut < 1)) return { error: invalidRequest("'max_output_tokens' must be a positive integer", 'max_output_tokens') };
  const prev = params.previous_response_id;
  if (prev !== undefined && (typeof prev !== 'string' || !prev)) return { error: invalidRequest("'previous_response_id' must be a string", 'previous_response_id') };
  // reasoning.effort → the model spends a (stubbed) reasoning budget; the item shape is faithful.
  let reasoningEffort: string | undefined;
  if (params.reasoning !== undefined) {
    const r = params.reasoning;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { error: invalidRequest("'reasoning' must be an object", 'reasoning') };
    const effort = (r as { effort?: unknown }).effort;
    if (effort !== undefined && effort !== null) reasoningEffort = effort as string;
  }
  // a model refuses what its page says it does not take (the model catalog); a reasoning model reasons with the effort
  // asked for, else the spec's default
  const refused = unsupported(params.model, { effort: reasoningEffort, effortParam: 'reasoning.effort', temperature: params.temperature, top_p: params.top_p });
  if (refused) return { error: invalidRequest(refused.message, refused.param, 'unsupported_value') };
  if (reasoningEffort === undefined && reasons(params.model)) reasoningEffort = DEFAULT_EFFORT;
  const reasoningSummary = params.reasoning && typeof (params.reasoning as { summary?: unknown }).summary === 'string' ? String((params.reasoning as { summary: string }).summary) : undefined;
  return {
    args: {
      model: params.model,
      inputItems,
      instructions,
      inputText,
      messages,
      stream: params.stream === true,
      store: params.store !== false, // OpenAI defaults store=true (stored & retrievable)
      background: params.background === true,
      ...(typeof prev === 'string' ? { previousResponseId: prev } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(Array.isArray(params.tools) ? { tools: params.tools } : {}),
      ...(typeof maxOut === 'number' ? { maxTokens: maxOut } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
      // OpenAI's defaults for what was not sent (the Response schema's): temperature and top_p 1, tools in parallel, auto;
      // plain text out, no truncation, no end user, no tool-call cap, no alternative tokens, the default tier
      // (https://platform.openai.com/docs/api-reference/responses/object)
      echo: {
        metadata: params.metadata ?? {}, temperature: params.temperature ?? 1, top_p: params.top_p ?? 1, parallel_tool_calls: params.parallel_tool_calls ?? true, tool_choice: params.tool_choice ?? 'auto',
        text: params.text ?? { format: { type: 'text' } }, truncation: params.truncation ?? 'disabled', user: params.user ?? null, max_tool_calls: params.max_tool_calls ?? null,
        top_logprobs: params.top_logprobs ?? 0, service_tier: ['flex', 'priority', 'scale'].includes(String(params.service_tier)) ? params.service_tier : 'default',
      },
    },
  };
}

/** A tool as a response answers it: as sent, with what OpenAI fills in for what was not. A web search preview searches
 *  with `medium` context from the United States unless told otherwise (the spec's WebSearchPreviewTool: "`medium` is
 *  the default"; `user_location` "If omitted or null, defaults to the United States"); a function tool sent without
 *  `strict` answers strict, as the reference's Functions example answers the tool it sends; a file search tool, its
 *  default filter and ranking
 *  (https://platform.openai.com/docs/api-reference/responses/create). */
export const TOOL_DEFAULTS: Record<string, (t: Record<string, unknown>) => Record<string, unknown>> = {
  function: (t) => ({ ...t, strict: t.strict ?? true }),
  // a file search sent without filters or ranking answers no filter and the automatic ranker with no threshold, as the
  // reference's File search example answers the tool it sends
  file_search: (t) => ({ ...t, filters: t.filters ?? null, ranking_options: t.ranking_options ?? { ranker: 'auto', score_threshold: 0 } }),
  // and the domains it is limited to, none unless sent, as the reference's Web search example answers `"domains": []`
  web_search_preview: (t) => ({ ...t, domains: t.domains ?? [], search_context_size: t.search_context_size ?? 'medium', user_location: t.user_location ?? { type: 'approximate', city: null, country: 'US', region: null, timezone: null } }),
};

export function answeredTool(tool: unknown): unknown {
  const t = (tool && typeof tool === 'object' ? tool : {}) as Record<string, unknown>;
  return TOOL_DEFAULTS[String(t.type)]?.(t) ?? tool;
}

/** An output item's id: its type's prefix and 48 hex characters, derived from its response's and what it is, as OpenAI
 *  writes an item's id beside its response's (`resp_67ccf18e…` answers `ws_67ccf18f…`). */
// source: spec:createResponse "ws_67ccf18f64008190a39b619f4c8455ef087bb177ab789d5c"
// source: spec:createResponse "fs_67ccf4c63cd08190887ef6464ba5681609504fb6872380d7"
// source: spec:createResponse "fc_67ca09c6bedc8190a7abfec07b1a1332096610f474011cc0"
// source: spec:createResponse "msg_67c9fdcf37fc8190ba82116e33fb28c507b8b0ad4e5eb654"
export const itemId = (prefix: string, suffix: string, what: string): string => `${prefix}_${sha256(`${suffix}:${what}`).slice(0, 48)}`;

/** The built-in tool calls a response makes: a web search for a web search tool, a file search over the named stores for a
 *  file search tool, each querying the input's text (its results are not included unless asked for: `results` null). */
export function builtInCalls(args: ResponsesArgs, suffix: string): ResponseOutputItem[] {
  const query = args.inputText.slice(0, 200);
  const out: ResponseOutputItem[] = [];
  for (const [i, tool] of (Array.isArray(args.tools) ? (args.tools as Array<{ type?: unknown }>) : []).entries()) {
    const type = String(tool?.type ?? '');
    if (/^web_search/.test(type)) out.push({ type: 'web_search_call', id: itemId('ws', suffix, `web_search_call:${i}`), status: 'completed', action: { type: 'search', query } });
    if (type === 'file_search') out.push({ type: 'file_search_call', id: itemId('fs', suffix, `file_search_call:${i}`), status: 'completed', queries: [query], results: null });
  }
  return out;
}

/** What every response answers besides its output: the request's settings as sent (or OpenAI's defaults), no error,
 *  no program access (https://platform.openai.com/docs/api-reference/responses/object). */
export const responseSettings = (args: ResponsesArgs): Record<string, unknown> => ({
  instructions: args.instructions ?? null, tools: Array.isArray(args.tools) ? args.tools.map(answeredTool) : [], ...args.echo,
  access_programs: null, error: null, incomplete_details: null,
  // whether it is kept: the spec's own Response example answers `"store": true` (spec/patches.json)
  background: args.background, store: args.store, max_output_tokens: args.maxTokens ?? null,
  previous_response_id: args.previousResponseId ?? null,
  reasoning: { effort: args.reasoningEffort ?? null, summary: args.reasoningSummary ?? null },
});

// A deterministic reasoning-token budget per effort level (more effort → more reasoning tokens).
export const REASONING_BUDGET: Record<string, number> = { none: 0, minimal: 8, low: 16, medium: 48, high: 128, xhigh: 256, max: 512 };

/** The function call an unscripted response makes: when the caller requires one or names one, or on
 *  `auto` unless the input ends with a tool's result, which a model answers in words. */
export function responseToolCall(args: ResponsesArgs, occurrence: string): ChatToolCall | null {
  const choice = args.echo.tool_choice;
  const named = choice && typeof choice === 'object' ? String((choice as { name?: unknown }).name ?? '') : undefined;
  const answering = args.inputItems.at(-1)?.type === 'function_call_output';
  const functions = (Array.isArray(args.tools) ? args.tools : []).filter((t) => (t as { type?: unknown }).type === 'function');
  if (!functions.length || choice === 'none' || (answering && !named && choice !== 'required')) return null;
  return stubToolCall(functions, 1, named, lastUserText(args.messages), occurrence);
}

export function buildResponse(args: ResponsesArgs, occurredAt?: string, idSuffix?: string, decision?: ScenarioDecision): OpenAIResponse {
  // The scenario decides the turn exactly as it does for chat completions: a fired handler scripts the
  // text and the tool calls; a miss answers the labeled stub and teaches. The request handler has
  // already honored a fault; only a content decision reaches here.
  // the response's id is `resp_` and these 48 hex characters (the manifest's Response and _response_call)
  const suffix = idSuffix || sha256(String(nowEpoch(occurredAt))).slice(0, 48);
  const turn = decision && scenarioTurn(decision, `resp_${suffix}`);
  const scripted = turn?.scripted;
  // structured output (`text.format`, https://platform.openai.com/docs/guides/structured-outputs): the stub is JSON, a
  // schema's properties each filled, as Chat Completions' response_format is
  const format = (args.echo.text as { format?: { type?: unknown } } | undefined)?.format;
  const stub = format?.type === 'json_schema' ? stubJsonObject(args.messages, args.model, format)
    : format?.type === 'json_object' ? freeformJson(args.messages, args.model)
    : stubAssistantText(args.messages, args.model) + (turn?.missTeach ?? '');
  let text = scripted ? (scripted.text ?? '') : stub;
  const inputTokens = countPromptTokens(args.messages);
  const messageItem: ResponseMessageItem = {
    type: 'message',
    id: itemId('msg', suffix, 'message'),
    status: 'completed',
    role: 'assistant',
    // no log probabilities unless asked for (`include: ["message.output_text.logprobs"]`): an empty list
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  };
  // unscripted, the stub calls a function tool as the chat stub does (buildChoice)
  const stubbed = scripted ? null : responseToolCall(args, suffix);
  if (stubbed) text = '';
  const calls: ResponseFunctionCallItem[] = (scripted?.toolCalls ?? (stubbed ? [stubbed] : [])).map((tc, i) => ({ type: 'function_call', id: itemId('fc', suffix, `function_call:${i}`), status: 'completed', call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
  const messageTokens = estimateTokens(text) + estimateTokens(calls.map((c) => c.arguments).join(''));
  const output: ResponseOutputItem[] = [];
  // usage breaks its counts down as OpenAI's does (https://platform.openai.com/docs/api-reference/responses/object, `usage`):
  // the twin caches nothing, so no input token was read from or written to a cache
  const usage: ResponseUsage = { input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: messageTokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inputTokens + messageTokens };
  // reasoning.effort → a faithful reasoning item (labeled-stub summary) BEFORE the message item,
  // plus output_tokens_details.reasoning_tokens in usage (counted into output_tokens, like the vendor).
  if (args.reasoningEffort) {
    const reasoningTokens = REASONING_BUDGET[args.reasoningEffort] ?? 16;
    // a summary only when one was asked for (`reasoning.summary`); without, OpenAI answers the item's summary empty
    // (https://platform.openai.com/docs/guides/reasoning#reasoning-summaries)
    const reasoningItem: ResponseReasoningItem = {
      type: 'reasoning',
      // source: spec:/components/schemas/ResponseReasoningSummaryPartAddedEvent "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476"
      id: itemId('rs', suffix, 'reasoning'),
      summary: args.reasoningSummary ? [{ type: 'summary_text', text: `[twin-stub] reasoning summary (effort=${args.reasoningEffort}); the twin cannot run the model, so the chain-of-thought is not real.` }] : [],
    };
    // only a model that reasons lists its reasoning item (the model catalog)
    if (reasons(args.model)) output.push(reasoningItem);
    usage.output_tokens += reasoningTokens;
    usage.total_tokens += reasoningTokens;
    usage.output_tokens_details = { reasoning_tokens: reasoningTokens };
  }
  // the built-in tools the request offers, which OpenAI runs itself before answering: the placeholder model searches
  // with each one offered, on the input's text, unless `tool_choice` is `none` (the reference's Web search and File search
  // examples answer a `web_search_call` / `file_search_call` item before the message:
  // https://platform.openai.com/docs/guides/tools-web-search, https://platform.openai.com/docs/guides/tools-file-search)
  if (!scripted && args.echo.tool_choice !== 'none') output.push(...builtInCalls(args, suffix));
  // A scripted turn with tool calls and no words carries the calls alone, as the vendor does.
  if (text || !calls.length) output.push(messageItem);
  output.push(...calls);
  return {
    id: `resp_${suffix}`,
    object: 'response',
    created_at: nowEpoch(occurredAt),
    status: 'completed',
    // answered whole at once: completed the instant it was created
    completed_at: nowEpoch(occurredAt),
    model: args.model,
    // no `output_text`: the spec's is an "SDK-only convenience property" the SDKs compute from `output`
    output,
    usage,
    ...responseSettings(args),
  };
}

// source: spec:createResponse "Creates a model response."
export async function createStoredResponse(args: ResponsesArgs, ctx: HandlerContext, resource: string, decision?: ScenarioDecision): Promise<Row> {
  return ctx.create(resource, (id) => {
    const suffix = id.replace(/^resp_/, '');
    // an input item sent without an id is given its type's: a message `msg_`, a function call `fc_`. Where the
    // documentation stops: OpenAI shows no other input item's id; the twin answers `item_` for the rest
    const inputItems = args.inputItems.map((item, i) => ({ ...item, id: item.id ?? itemId(item.type === 'message' ? 'msg' : item.type === 'function_call' ? 'fc' : 'item', suffix, `input:${i}`) }));
    const resp = args.background && !args.stream ? {
      id, object: 'response', created_at: nowEpoch(ctx.occurredAt), status: 'queued', completed_at: null,
      model: args.model, output: [], usage: null, ...responseSettings(args),
    } : buildResponse(args, ctx.occurredAt, suffix, decision);
    return { ...resp, _stored: true, _input_items: inputItems,
      ...(args.background && !args.stream ? { _bg_args: JSON.stringify(args), _bg_suffix: suffix, _bg_decision: decision ? JSON.stringify(decision) : null } : {}),
    };
  }, 'response.create');
}

// source: spec:/components/schemas/ResponseCreatedEvent "The sequence number for this event."
// source: spec:/components/schemas/ResponseTextDeltaEvent "The ID of the output item that the text delta was added to."
// source: spec:/components/schemas/ResponseContentPartAddedEvent "Emitted when a new content part is added."
export function emitResponse(resp: OpenAIResponse, sink: SseSink): OpenAIResponse {
  let sequence = 0;
  const emit = (type: string, fields: Row) => sink({ data: { type, ...fields, sequence_number: sequence++ } });
  const initial = { ...resp, status: 'in_progress', completed_at: null, usage: null, output: [] };
  emit('response.created', { response: initial });
  emit('response.in_progress', { response: initial });
  resp.output.forEach((item, output_index) => {
    const started = item.type === 'message' ? { ...item, status: 'in_progress', content: [] }
      : item.type === 'function_call' ? { ...item, status: 'in_progress', arguments: '' } : item;
    emit('response.output_item.added', { output_index, item: started });
    if (item.type === 'message') item.content.forEach((part, content_index) => {
      const position = { item_id: item.id, output_index, content_index };
      emit('response.content_part.added', { ...position, part: { ...part, text: '' } });
      for (const delta of chunkText(part.text)) emit('response.output_text.delta', { ...position, delta, logprobs: [] });
      emit('response.output_text.done', { ...position, text: part.text, logprobs: part.logprobs ?? [] });
      emit('response.content_part.done', { ...position, part });
    });
    if (item.type === 'function_call') {
      const position = { output_index, item_id: item.id };
      emit('response.function_call_arguments.delta', { ...position, delta: item.arguments });
      emit('response.function_call_arguments.done', { ...position, arguments: item.arguments });
    }
    emit('response.output_item.done', { output_index, item });
  });
  emit('response.completed', { response: resp });
  return resp;
}

// ── Moderations (deterministic) ─────────────────────────────────────────────────────────
export function handleModerations(params: Record<string, unknown>, id: string): OpenAIResponseEnvelope {
  if (params.input === undefined) return invalidRequest("you must provide an input parameter", 'input');
  // an array of strings is several inputs, one result each; an array of text and image parts is ONE multimodal input,
  // one result (https://platform.openai.com/docs/api-reference/moderations/create, `input`)
  const list = Array.isArray(params.input) ? (params.input as unknown[]) : [];
  const parts = list.length > 0 && list.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  const inputs: Array<{ text: string; image: boolean }> = typeof params.input === 'string'
    ? [{ text: params.input, image: false }]
    : parts
      ? [{ text: (list as Array<{ type?: unknown; text?: unknown }>).filter((x) => x.type === 'text').map((x) => String(x.text ?? '')).join('\n'), image: (list as Array<{ type?: unknown }>).some((x) => x.type === 'image_url') }]
      : list.map((x) => ({ text: typeof x === 'string' ? x : JSON.stringify(x), image: false }));
  if (inputs.length === 0) return invalidRequest("'input' must be a non-empty string or array", 'input');
  const model = modelOf('createModeration', params)!;
  const results = inputs.map((t) => moderateText(t.text, t.image));
  return { status: 200, body: { id, model, results } };
}

// ── Images (a real placeholder image, no model: the media, below) ─────────────────────────────────
export const gptImage = (model: string): boolean => /^(gpt-image|chatgpt-image)/.test(model);

/** One answered image: the GPT image models give the image itself as base64, always; `dall-e-2` and `dall-e-3` a URL
 *  unless `response_format` is `b64_json`, and `dall-e-3` its revised prompt (developers.openai.com/api/reference/
 *  resources/images/methods/generate, `response_format`; the Image object's `b64_json`, `url`, `revised_prompt`). */
export function imageData(_params: Row, _model: string, size: { width: number; height: number }, seed: string, _kind: string, i: number, _occurredAt?: string): Row {
  return { b64_json: base64(placeholderPng(size, `${seed} #${i + 1}`)) };
}

export function imageCount(params: Record<string, unknown>): number {
  const n = Number(params.n ?? 1);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** An image answer, and its events when streamed. */
export type ImageAnswer = OpenAIResponseEnvelope & { events?: Array<{ event: string; data: unknown }> };

/** A GPT image model's answer: the images with the tokens they cost (the image generation guide's 1024x1024
 *  medium-quality image is 1056 output tokens, scaled here by area; the twin reads no pixels, so it counts no input image
 *  tokens: https://platform.openai.com/docs/guides/image-generation#cost-and-latency), or, with `stream`, the
 *  `partial_images` asked (none by default: "When set to 0, the response will be a single image sent in one streaming
 *  event") then the completed image (https://platform.openai.com/docs/api-reference/images-streaming). */
export function gptImageAnswer(params: Record<string, unknown>, size: { width: number; height: number }, data: Array<Record<string, unknown>>, kind: 'image_generation' | 'image_edit', occurredAt?: string): ImageAnswer {
  const text = estimateTokens(String(params.prompt ?? ''));
  const output = Math.ceil((1056 * size.width * size.height) / (1024 * 1024)) * data.length;
  const usage = { total_tokens: text + output, input_tokens: text, output_tokens: output, input_tokens_details: { text_tokens: text, image_tokens: 0 } };
  const created = nowEpoch(occurredAt);
  if (params.stream !== true && params.stream !== 'true') return { status: 200, body: { created, data, usage } };
  const settings = {
    created_at: created, size: `${size.width}x${size.height}`,
    // what `auto` settles on for a placeholder: an opaque PNG of medium quality
    quality: params.quality && params.quality !== 'auto' ? params.quality : 'medium',
    background: params.background && params.background !== 'auto' ? params.background : 'opaque',
    output_format: params.output_format ?? 'png',
  };
  const partials = Math.min(3, Math.max(0, Number(params.partial_images ?? 0) || 0));
  const b64 = String(data[0]?.b64_json ?? '');
  const events = [
    ...Array.from({ length: partials }, (_, i) => ({ event: `${kind}.partial_image`, data: { type: `${kind}.partial_image`, b64_json: b64, ...settings, partial_image_index: i } })),
    { event: `${kind}.completed`, data: { type: `${kind}.completed`, b64_json: b64, ...settings, usage } },
  ];
  return { status: 200, body: { created, data, usage }, events };
}

export function handleImages(params: Record<string, unknown>, occurredAt?: string): ImageAnswer {
  if (params.prompt === undefined || params.prompt === '') return invalidRequest("you must provide a prompt parameter", 'prompt');
  const model = modelOf('createImage', params)!;
  const size = requestedSize(params.size);
  const data = Array.from({ length: imageCount(params) }, (_, i) => imageData(params, model, size, String(params.prompt), 'image', i, occurredAt));
  if (gptImage(model)) return gptImageAnswer(params, size, data, 'image_generation', occurredAt);
  return { status: 200, body: { created: nowEpoch(occurredAt), data } };
}

/** OpenAI's refusal of an upload that is not an image the model takes. */
export const badImage = (formats: string): OpenAIResponseEnvelope => invalidRequest(`Invalid image file: 'image' must be ${formats}.`, 'image', 'invalid_image_format');

// An EDIT takes an image file and a prompt; a VARIATION (dall-e-2 only) a square PNG. Each is told by its bytes.
export function handleImageEdit(params: Record<string, unknown>, occurredAt?: string): ImageAnswer {
  // a GPT image model edits several images sent as `image[]` (the form keeps the last one named so)
  const image = params.image ?? params['image[]'];
  if (image === undefined || image === '') return invalidRequest("you must provide an image to edit", 'image');
  if (params.prompt === undefined || params.prompt === '') return invalidRequest("you must provide a prompt parameter", 'prompt');
  const model = modelOf('createImageEdit', params)!;
  const bytes = partBytes(image);
  const format = bytes && imageFormat(bytes);
  if (gptImage(model) ? !format : format !== 'png' || !square(bytes!)) return badImage(gptImage(model) ? 'a png, webp, or jpg file' : 'a square png file');
  const size = requestedSize(params.size);
  const data = Array.from({ length: imageCount(params) }, (_, i) => imageData(params, model, size, String(params.prompt), 'image-edit', i, occurredAt));
  if (gptImage(model)) return gptImageAnswer(params, size, data, 'image_edit', occurredAt);
  return { status: 200, body: { created: nowEpoch(occurredAt), data } };
}

export const square = (png: Uint8Array): boolean => { const s = pngSize(png); return s.width === s.height; };

// ── Audio (deterministic stubs; the twin runs no model) ──────────────────────
// Transcription/translation cannot run a real speech model, so the twin returns a clearly
// labeled deterministic transcript naming the uploaded file. It takes the audio file itself, in a
// format OpenAI transcribes (the media, below), never a file's name. The response SHAPE
// (json / verbose_json / text) is vendor-faithful.
/** A multipart list field (`include[]`, `timestamp_granularities[]`), however the form named it. */
export function formList(params: Record<string, unknown>, name: string): string[] {
  const v = params[name] ?? params[`${name}[]`];
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(String);
}

/** What a transcription is billed on: the GPT-4o transcribe models by tokens, whisper-1 and the diarizing model by the
 *  audio's seconds (https://platform.openai.com/docs/api-reference/audio/json-object, `usage`). The twin counts ten
 *  audio tokens a second and its transcript's text tokens; neither is a model's count. */
export function transcriptionUsage(model: string, seconds: number, text: string): Record<string, unknown> {
  if (model.startsWith('whisper') || model.includes('diarize')) return { type: 'duration', seconds };
  const audio = Math.ceil(seconds * 10);
  const out = estimateTokens(text);
  return { type: 'tokens', input_tokens: audio, input_token_details: { text_tokens: 0, audio_tokens: audio }, output_tokens: out, total_tokens: audio + out };
}

/** The transcript's words spread evenly over the audio: the twin hears nothing, so its timings are the file's length
 *  shared out, not a model's alignment. */
export function words(text: string, seconds: number): Array<{ word: string; start: number; end: number }> {
  const all = text.split(/\s+/).filter(Boolean);
  const each = seconds / Math.max(1, all.length);
  return all.map((word, i) => ({ word, start: i * each, end: (i + 1) * each }));
}

export type Transcription = { status: 200; body: unknown; seconds: number; events?: Array<{ data: unknown }> } | OpenAIResponseEnvelope;

/** A transcription (or translation) of the uploaded audio: a labeled transcript naming the file, in the response
 *  format asked (json, text, verbose_json with the word or segment timestamps asked, or diarized_json), with the
 *  token log probabilities when `include[]=logprobs`, and as `transcript.text.delta` events then
 *  `transcript.text.done` when `stream=true` on a model that streams (https://platform.openai.com/docs/api-reference/audio/createTranscription). */
export function handleTranscription(params: Record<string, unknown>, translate: boolean): Transcription {
  if (params.file === undefined || params.file === '') return invalidRequest("you must provide a file parameter", 'file');
  if (params.model === undefined || params.model === '') return invalidRequest("you must provide a model parameter", 'model');
  const bytes = partBytes(params.file);
  if (!bytes || !audioFormat(bytes)) return invalidRequest("Invalid file format. Supported formats: ['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']", 'file', 'invalid_value');
  const filename = String((params.file as { name?: string }).name || 'upload');
  const model = String(params.model);
  const verb = translate ? 'translation' : 'transcription';
  const text = `[twin-stub] deterministic ${verb} of ${filename} (no speech model is run)`;
  const format = typeof params.response_format === 'string' ? params.response_format : 'json';
  // the file's own length where the twin can read it (a WAV's header), else a labeled second
  const duration = wavSeconds(bytes) ?? 1.0;
  if (format === 'text') return { status: 200, body: text, seconds: duration };
  if (translate) return { status: 200, seconds: duration, body: format === 'verbose_json' ? { task: 'translation', language: 'english', duration, text, segments: [{ id: 0, start: 0, end: duration, text }] } : { text } };
  const usage = transcriptionUsage(model, duration, text);
  if (format === 'diarized_json') {
    // one speaker the twin cannot tell apart: the first name the caller knows, else OpenAI's first label
    const speaker = formList(params, 'known_speaker_names')[0] ?? 'A';
    return { status: 200, seconds: duration, body: { task: 'transcribe', duration, text, segments: [{ type: 'transcript.text.segment', id: 'seg_001', start: 0, end: duration, text, speaker }], usage } };
  }
  if (format === 'verbose_json') {
    const granularities = formList(params, 'timestamp_granularities');
    const segment = { id: 0, seek: 0, start: 0, end: duration, text, tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 1, no_speech_prob: 0 };
    return {
      status: 200,
      seconds: duration,
      body: {
        task: 'transcribe', language: typeof params.language === 'string' ? params.language : 'english', duration, text,
        ...(granularities.includes('word') ? { words: words(text, duration) } : {}),
        ...(!granularities.length || granularities.includes('segment') ? { segments: [segment] } : {}),
        usage,
      },
    };
  }
  const logprobs = formList(params, 'include').includes('logprobs') ? buildLogprobs(text, 0).content.map(({ token, logprob, bytes: b }) => ({ token, logprob, bytes: b })) : undefined;
  const body = { text, ...(logprobs ? { logprobs } : {}), usage };
  // whisper-1 does not stream ("Streaming is not supported for the whisper-1 model and will be ignored")
  if (String(params.stream) === 'true' && !model.startsWith('whisper')) {
    const pieces = text.match(/\s*\S+/g) ?? [];
    const events = pieces.map((delta) => ({ data: { type: 'transcript.text.delta', delta, ...(logprobs ? { logprobs: buildLogprobs(delta, 0).content.map(({ token, logprob, bytes: b }) => ({ token, logprob, bytes: b })) } : {}) } }));
    events.push({ data: { type: 'transcript.text.done', text, ...(logprobs ? { logprobs } : {}), usage } as never });
    return { status: 200, body, seconds: duration, events };
  }
  return { status: 200, body, seconds: duration };
}

// Text-to-speech: runs no speech model, but answers the audio file itself in the requested format, as OpenAI does
// (a second of silence: the media, below), with that format's Content-Type.
export const SPEECH: Record<string, { type: string; file: () => Uint8Array }> = {
  mp3: { type: 'audio/mpeg', file: silentMp3 },
  opus: { type: 'audio/opus', file: silentOpus },
  aac: { type: 'audio/aac', file: silentAac },
  flac: { type: 'audio/flac', file: silentFlac },
  wav: { type: 'audio/wav', file: silentWav },
  pcm: { type: 'audio/pcm', file: silentPcm },
};

export function handleSpeech(params: Record<string, unknown>): OpenAIResponseEnvelope | { status: 200; audio: Uint8Array; type: string } {
  if (params.model === undefined || params.model === '') return invalidRequest("you must provide a model parameter", 'model');
  if (params.input === undefined || params.input === '') return invalidRequest("you must provide an input parameter", 'input');
  if (params.voice === undefined || params.voice === '') return invalidRequest("you must provide a voice parameter", 'voice');
  if (params.stream_format === 'sse' && (params.model === 'tts-1' || params.model === 'tts-1-hd')) return invalidRequest('SSE streaming is not supported for this model.', 'stream_format');
  const format = SPEECH[String(params.response_format ?? 'mp3')];
  if (!format) return invalidRequest("'response_format' must be one of 'mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'", 'response_format');
  return { status: 200, audio: format.file(), type: format.type };
}

export type OpenAIScenarioRequest = { model: string; messages: ChatMessageParam[]; tools?: unknown; maxTokens?: number; toolChoice?: unknown };

export type ScenarioToolCall = { name: string; arguments: Record<string, unknown>; id?: string };

export type OpenAIScenarioRespond = {
  text?: string;
  toolCalls?: ScenarioToolCall | ScenarioToolCall[];
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
};

export type ScriptedResult = {
  text: string | null;
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
};

export const RESPOND_KEYS = new Set(['text', 'toolCalls', 'finishReason']);

export const FINISH_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter']);

export const nonEmptyString = (cond: unknown): cond is string => typeof cond === 'string' && cond.length > 0;

export const positiveNumber = (cond: unknown): cond is number => typeof cond === 'number' && Number.isFinite(cond) && cond > 0;

/** A decision as a turn: the scripted result, or, on a miss, the note that teaches where to script it. */
export function scenarioTurn(decision: ScenarioDecision, callSeed?: string): { scripted: ScriptedResult; missTeach?: undefined } | { scripted?: undefined; missTeach: string } {
  if (decision.kind === 'handler') return { scripted: realizeOpenAIRespond(decision.respond as OpenAIScenarioRespond, callSeed) };
  return { missTeach: `\n[twin-scenario miss — no handler matched. Author one in the world dir's handlers/openai.json (GET /twin explains; GET /twin/scenario lists handlers + misses). Features seen: ${JSON.stringify(decision.miss.features)}]` };
}

/** A scripted turn as a chat completion's choice. */
export function scriptedChoice(scripted: ScriptedResult, index: number): { choice: ChatChoice; completionTokens: number } {
  const message = scripted.toolCalls.length
    ? { role: 'assistant' as const, content: scripted.text, tool_calls: scripted.toolCalls, refusal: null }
    : { role: 'assistant' as const, content: scripted.text ?? '', refusal: null };
  return { choice: { index, message, logprobs: null, finish_reason: scripted.finishReason }, completionTokens: estimateTokens(JSON.stringify(scripted.toolCalls.length ? scripted.toolCalls : scripted.text ?? '')) };
}

export function realizeOpenAIRespond(respond: OpenAIScenarioRespond, callSeed = 'scripted'): ScriptedResult {
  const toolCalls: ChatToolCall[] = [];
  // each call's id is derived from its completion's or response's id (the seed), so chained calls keep distinct identities
  for (const [i, tc] of (respond.toolCalls ? (Array.isArray(respond.toolCalls) ? respond.toolCalls : [respond.toolCalls]) : []).entries()) {
    toolCalls.push({ id: tc.id ?? callId(`${callSeed}:${i + 1}`), type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } });
  }
  return {
    text: respond.text ?? (toolCalls.length ? null : ''),
    toolCalls,
    finishReason: respond.finishReason ?? (toolCalls.length ? 'tool_calls' : 'stop'),
  };
}

// ── from wire-types ───────────────────────────────────────────────────────────────────────────────────
// Shared wire-shape types for the OpenAI API surface. These mirror the real vendor JSON
// shapes (not the SDK's internal types — the twin never imports the SDK at runtime; the SDK
// is exercised only in *.test.ts). Kept minimal but faithful.

// ── Chat Completions ────────────────────────────────────────────────────────────────────
/** A chat message param as the caller sends it (content is a string OR a content-part array). */
export type ChatMessageParam = {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

/** A function tool_call inside an assistant message (faithful shape). */
export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

/** The chat.completion `usage` object — deterministic token counts. */
export type ChatUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number; audio_tokens: number };
  completion_tokens_details?: { reasoning_tokens: number; audio_tokens: number; accepted_prediction_tokens: number; rejected_prediction_tokens: number };
};

/** A per-token logprob entry (faithful `choices[].logprobs.content[]` shape). */
export type ChatLogprobToken = {
  token: string;
  logprob: number;
  bytes: number[];
  top_logprobs: Array<{ token: string; logprob: number; bytes: number[] }>;
};

/** An audio output object on an assistant message (when `modalities` includes 'audio'). The twin
 *  can't synthesize speech, so `data` is a clearly-labeled stub base64 string; the SHAPE
 *  (id/data/transcript/expires_at) is vendor-faithful. */
export type ChatAudioOutput = { id: string; data: string; transcript: string; expires_at: number };

export type ChatChoice = {
  index: number;
  message: { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[]; refusal?: null; annotations?: unknown[]; audio?: ChatAudioOutput };
  logprobs: { content: ChatLogprobToken[] } | null;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
};

/** The unary chat.completion response envelope (faithful shape). */
export type ChatCompletion = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: ChatUsage;
  system_fingerprint: string;
  service_tier?: string;
  metadata?: Record<string, unknown> | null;
};

// ── Responses API ───────────────────────────────────────────────────────────────────────
/** A message output item (the assistant's text turn). */
export type ResponseMessageItem = {
  type: 'message';
  id: string;
  status: 'completed';
  role: 'assistant';
  content: Array<{ type: 'output_text'; text: string; annotations: unknown[]; logprobs?: unknown[] }>;
};

/** A reasoning output item (emitted for reasoning models / when `reasoning.effort` is set). The
 *  twin can't run the model, so the reasoning `summary` is a clearly-labeled stub; the item SHAPE
 *  (type/id/summary[]) is vendor-faithful. */
export type ResponseReasoningItem = {
  type: 'reasoning';
  id: string;
  summary: Array<{ type: 'summary_text'; text: string }>;
};

/** A function-call output item: the model asking for a tool, as the Responses API shapes it
 *  (`call_id` pairs with the caller's later `function_call_output` input item; `arguments` is JSON text). */
export type ResponseFunctionCallItem = {
  type: 'function_call';
  id: string;
  status: 'completed';
  call_id: string;
  name: string;
  arguments: string;
};

/** A built-in tool OpenAI ran for the response: a web search or a file search (the spec's WebSearchToolCall, FileSearchToolCall). */
export type ResponseBuiltInCallItem =
  | { type: 'web_search_call'; id: string; status: 'completed'; action: { type: 'search'; query: string } }
  | { type: 'file_search_call'; id: string; status: 'completed'; queries: string[]; results: null };

export type ResponseOutputItem = ResponseMessageItem | ResponseReasoningItem | ResponseFunctionCallItem | ResponseBuiltInCallItem;

/** The Responses API usage object — `output_tokens_details.reasoning_tokens` reports tokens spent
 *  on the (stubbed) reasoning item, faithful to the vendor shape. */
export type ResponseUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number; cache_write_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
};

/** The Responses API response envelope (faithful shape). */
export type OpenAIResponse = {
  id: string;
  object: 'response';
  created_at: number;
  status: 'completed';
  model: string;
  output: ResponseOutputItem[];
  output_text?: string;
  usage: ResponseUsage;
  completed_at?: number | null;
  reasoning?: { effort: string | null; summary: string | null };
  previous_response_id?: string | null;
};

// ── Streaming ───────────────────────────────────────────────────────────────────────────
/** A single Server-Sent Event the streaming path emits (collected, never socketed in tests).
 *  `data` is the JSON payload; `[DONE]` is signalled with `done: true` (no data object). */
export type SseEvent = { data?: Record<string, unknown>; done?: boolean };

/** A sink the streaming path writes events into (an injected collector in tests / a real
 *  HTTP SSE writer in the server). NO real sockets or setTimeout in the handler. */
export type SseSink = (event: SseEvent) => void;

// ── from stub-text ────────────────────────────────────────────────────────────────────────────────────
// Model outputs are labeled deterministic placeholders. No model weights run here.
/** Deterministic token estimate for a string: ~1 token per 4 chars (faithful order of
 *  magnitude; deterministic so usage counts are assertable, like the vendor's tokenizer on a
 *  fixed input). Never zero for non-empty text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Flatten a chat message's content (string OR content-part array) to its text for token
 *  counting / echo. Non-text parts contribute their JSON length so the count is deterministic
 *  and reflects payload size. */
export function contentToText(content: ChatMessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part && typeof part === 'object' && (part as { type?: string }).type === 'text') {
        return String((part as { text?: unknown }).text ?? '');
      }
      return JSON.stringify(part);
    })
    .join('\n');
}

/** Deterministic prompt-token count for the full set of messages. */
export function countPromptTokens(messages: ChatMessageParam[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(contentToText(m.content));
    if (m.name) total += estimateTokens(m.name);
    for (const tc of m.tool_calls ?? []) total += estimateTokens(JSON.stringify(tc));
  }
  return total;
}

/** The last user turn's text — the thing the stub echoes (deterministic, clearly labeled). */
export function lastUserText(messages: ChatMessageParam[]): string {
  // No user turn (e.g. only system) → fall back to the last message's text.
  const turn = [...messages].reverse().find((m) => m.role === 'user') ?? messages.at(-1);
  return turn ? contentToText(turn.content) : '';
}

/**
 * Build the deterministic stub ASSISTANT text. It is unmistakably a twin stub: it carries the
 * `[twin-stub:<model>]` marker and echoes the prompt, so no caller can mistake it for real
 * model output. Deterministic for a given prompt → assertable in tests.
 */
export function stubAssistantText(messages: ChatMessageParam[], model: string): string {
  const prompt = lastUserText(messages).trim();
  const echo = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
  return `[twin-stub:${model}] This is a deterministic stub from the OpenAI twin (no model weights are run). Echoing your last message: ${echo || '(empty)'}`;
}

/** Extract a tool's function name from either a Chat Completions tool
 *  (`{ type:'function', function:{ name } }`) or a legacy `functions` entry (`{ name }`). */
export function toolName(t: unknown): string {
  const o = t as { function?: { name?: unknown }; name?: unknown } | undefined;
  return o?.function && typeof o.function.name === 'string' ? o.function.name : typeof o?.name === 'string' ? o.name : 'unknown_function';
}

// source: spec:/components/schemas/ResponseFormatJsonSchema "JSON Schema"
export class SchemaStubError extends Error {}
/** Refuse a schema the deterministic placeholder cannot satisfy, without swallowing an implementation error. */
export function schemaFailure(ctx: HandlerContext, param: string, error: unknown): Response {
  if (error instanceof SchemaStubError) return ctx.refuse({ status: 400, message: error.message, param });
  throw error;
}

export function schemaReference(d: Row, root: unknown, depth: number): unknown {
  const ref = String(d.$ref);
  if (!ref.startsWith('#/')) throw new SchemaStubError('Only local JSON Schema references are supported.');
  const target = ref.slice(2).split('/').reduce<unknown>((v, key) => (v as Row)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
  return placeholderForSchema(target, root, depth + 1);
}
/** The first alternative the placeholder can fill; when none before the last can, the last one's value or refusal. */
export function schemaAlternative(alternatives: unknown[], root: unknown, depth: number): unknown {
  for (const alternative of alternatives.slice(0, -1)) {
    try { return placeholderForSchema(alternative, root, depth + 1); }
    catch (error) { if (!(error instanceof SchemaStubError)) throw error; }
  }
  return placeholderForSchema(alternatives.at(-1), root, depth + 1);
}
export function schemaNumber(d: Row, integer: boolean): number {
  const minimum = typeof d.minimum === 'number' ? d.minimum : 0;
  const value = integer ? Math.ceil(minimum) : minimum;
  if ((typeof d.maximum === 'number' && value > d.maximum) || d.multipleOf || d.exclusiveMinimum || d.exclusiveMaximum) throw new SchemaStubError('Numeric constraints require a configured scenario.');
  return value;
}
export function schemaArray(d: Row, root: unknown, depth: number): unknown[] {
  if (d.uniqueItems || d.contains || Number(d.minItems ?? 0) > Number(d.maxItems ?? Infinity)) throw new SchemaStubError('Array constraints require a configured scenario.');
  return Array.from({ length: Number(d.minItems ?? 0) }, () => placeholderForSchema(d.items, root, depth + 1));
}
export function schemaString(d: Row): string {
  if (d.pattern || d.format) throw new SchemaStubError('Constrained strings require a configured scenario.');
  if (Number(d.minLength ?? 0) > Number(d.maxLength ?? Infinity)) throw new SchemaStubError('String constraints have no valid placeholder.');
  return ''.padEnd(Number(d.minLength ?? 0), 'x');
}
export function placeholderForSchema(def: unknown, root: unknown = def, depth = 0): unknown {
  if (depth > 32) throw new SchemaStubError('Recursive JSON Schema has no finite placeholder.');
  const d = def as Row | undefined;
  if (!d || typeof d !== 'object') throw new SchemaStubError('Invalid JSON Schema.');
  if (d.$ref) return schemaReference(d, root, depth);
  if ('const' in d) return d.const;
  if (Array.isArray(d.enum) && d.enum.length) return d.enum[0];
  if (d.allOf || d.not || d.oneOf) throw new SchemaStubError('Unsupported JSON Schema combination; configure a scenario for it.');
  if (Array.isArray(d.anyOf) && d.anyOf.length) return schemaAlternative(d.anyOf, root, depth);
  const type = Array.isArray(d.type) ? d.type[0] : d.type;
  if (type === 'array') return schemaArray(d, root, depth);
  if (type === 'object') return Object.fromEntries(Object.entries((d.properties ?? {}) as Row).map(([key, value]) => [key, placeholderForSchema(value, root, depth + 1)]));
  return schemaScalar(d, type);
}
export function schemaScalar(d: Row, type: unknown): unknown {
  if (type === 'null') return null;
  if (type === 'number' || type === 'integer') return schemaNumber(d, type === 'integer');
  if (type === 'boolean') return false;
  if (type === 'string') return schemaString(d);
  throw new SchemaStubError('Unsupported JSON Schema form; configure a scenario for it.');
}

// Words that name nothing a tool could take as a value.
export const STOPWORDS = new Set(['a', 'an', 'the', 'do', 'does', 'you', 'your', 'have', 'has', 'is', 'are', 'for', 'me', 'my', 'please', 'this', 'that', 'one', 'like', 'with', 'what', 'which', 'how', 'can', 'could', 'would', 'and', 'or', 'of', 'to', 'in', 'on', 'it', 'its', 'small', 'large', 'big', 'some', 'any']);

/** The value the user's message names for a string parameter: its longest content word (the thing asked about: "Do you
 *  have a small monstera?" names `monstera`), or none. */
export function namedIn(userText: string): string | undefined {
  // a link the message carries (an image's URL) is not what it asks about
  const words = (userText.replace(/\S+:\/\/\S+/g, ' ').toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? []).filter((w) => !STOPWORDS.has(w));
  return words.reduce<string | undefined>((best, w) => (!best || w.length > best.length ? w : best), undefined);
}

/**
 * Build a deterministic stub argument string for a tool. When the tool declares a JSON-schema
 * `parameters` object (especially with `strict:true`), real models emit arguments that validate
 * against the schema; the twin synthesizes a deterministic object with a type-appropriate
 * placeholder for each property it sets, so `strict` callers parse it cleanly. A strict tool, or a
 * schema that names no `required` list, gets every declared property (strict makes every property
 * required); otherwise only the required ones: a model leaves an optional parameter it has no reason
 * to set unset, and a placeholder there is a choice nobody made (LibreChat's web_search took an
 * optional `date` enum's first value, "past hour", and its search was refused). A required
 * string is never left empty: an empty value is schema-valid in type but names nothing, so an
 * application's tool could not act on it and a story could not follow the call. It takes what the
 * user's message names (`namedIn`), else a deterministic value of the parameter's own name; an enum
 * takes the value the message names, else its first.
 */
export function stubToolArguments(tool: unknown, userText = ''): string {
  const o = tool as { function?: { parameters?: unknown }; parameters?: unknown } | undefined;
  const schema = (o?.function?.parameters ?? o?.parameters) as { properties?: Record<string, unknown>; required?: unknown } | undefined;
  const props = schema && typeof schema === 'object' ? schema.properties : undefined;
  if (!props || typeof props !== 'object') return '{}';
  const required = new Set(Array.isArray(schema!.required) ? schema!.required.map(String) : []);
  const strict = (tool as { function?: { strict?: unknown }; strict?: unknown } | undefined)?.function?.strict === true || (tool as { strict?: unknown } | undefined)?.strict === true;
  const onlyRequired = !strict && Array.isArray(schema!.required);
  const words = new Set(userText.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    if (onlyRequired && !required.has(key)) continue;
    const d = def as { type?: unknown; enum?: unknown[] } | undefined;
    const named = Array.isArray(d?.enum) ? d!.enum!.find((e) => typeof e === 'string' && words.has(e.toLowerCase())) : undefined;
    out[key] = named ?? (required.has(key) && d?.type === 'string' && !Array.isArray(d?.enum) ? namedIn(userText) ?? `twin-${key}` : placeholderForSchema(def));
  }
  return JSON.stringify(out);
}

/** A tool call's id: `call_` and 24 base62 characters, derived from the call that made it and its place there. */
// source: spec:createResponse "call_unLAR8MvFNptuiZK6K6HCy5k"
// source: spec:createThreadAndRun "call_XXNp8YGaFrjrSjgqxtC8JJ1B"
export const callId = (seed: string): string => `call_${base62From(seed, 24)}`;

/**
 * When tools/functions are provided, real models may respond with `tool_calls` and
 * `finish_reason:'tool_calls'`. The stub deterministically "calls" the tool selected by
 * `forcedName` (a named tool_choice) or the FIRST provided tool. Arguments are synthesized
 * from the tool's JSON schema so strict callers parse them — clearly a stub, but a
 * vendor-faithful tool_calls envelope. Returns the tool_call, or null when no tools provided.
 */
export function stubToolCall(tools: unknown, seq: number, forcedName?: string, userText = '', occurrence = ''): ChatToolCall | null {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  const chosen = forcedName ? (tools.find((t) => toolName(t) === forcedName) ?? tools[0]) : tools[0];
  return { id: callId(`${occurrence}:${seq}`), type: 'function', function: { name: toolName(chosen), arguments: stubToolArguments(chosen, userText) } };
}

/**
 * Build a deterministic JSON-object stub for `response_format` json_object / json_schema. The
 * model's job is to emit parseable JSON; the twin returns a clearly-labeled deterministic object
 * (and, for json_schema, fills every declared property with a schema-typed placeholder so the
 * caller's strict parse succeeds). Always valid JSON.
 */
export function stubJsonObject(messages: ChatMessageParam[], model: string, jsonSchema?: unknown): string {
  if (!jsonSchema) return freeformJson(messages, model);
  const supplied = jsonSchema as Row;
  return JSON.stringify(placeholderForSchema(supplied.schema ?? supplied));
}

/** JSON mode with no schema (`json_object`): a labeled object echoing the request. */
export function freeformJson(messages: ChatMessageParam[], model: string): string {
  return JSON.stringify({ _twin_stub: true, model, echo: lastUserText(messages).slice(0, 200) });
}

// ── Logprobs (deterministic pseudo-logprobs) ────────────────────────────────────────────
/** The per-token logprob shape OpenAI returns in `choices[].logprobs.content[]`. */
export type LogprobToken = {
  token: string;
  logprob: number;
  bytes: number[];
  top_logprobs: Array<{ token: string; logprob: number; bytes: number[] }>;
};

/** A whitespace-preserving token split: deterministic chunks of the stub text whose `token`
 *  fields re-join into the exact text. NOT a real BPE tokenizer. */
export function splitForLogprobs(text: string): string[] {
  if (!text) return [];
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Build deterministic pseudo-logprobs for the stub completion text. Real models return a per-token
 * logprob (a negative number) plus `top_logprobs` alternatives; the twin synthesizes a deterministic
 * negative logprob per token (seeded from the token text) and `topN` alternatives. NOT real
 * probabilities — the SHAPE and DETERMINISM are faithful, the values carry no model meaning.
 * Re-joining `content[].token` reconstructs the full text exactly.
 */
export function buildLogprobs(text: string, topN: number): { content: LogprobToken[] } {
  const tokens = splitForLogprobs(text);
  const content: LogprobToken[] = tokens.map((tok) => {
    const seed = fnv1a(tok);
    const lp = -((seed % 5000) / 1000); // deterministic logprob in (-5, 0]
    const bytes = Array.from(new TextEncoder().encode(tok));
    // the token itself, then `topN` labeled alternatives, each less likely
    const top: LogprobToken['top_logprobs'] = [{ token: tok, logprob: lp, bytes }, ...Array.from({ length: topN }, (_, i) => ({ token: `«alt${i}»`, logprob: lp - 1 - (fnv1a(`${tok}#${i}`) % 3000) / 1000, bytes: [] as number[] }))];
    return { token: tok, logprob: lp, bytes, top_logprobs: top.slice(0, Math.max(1, topN)) };
  });
  return { content };
}

// ── Embeddings: deterministic pseudo-vectors ────────────────────────────────────────────
/** A small deterministic 32-bit hash (FNV-1a) of a string — the seed for a pseudo-vector. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── Moderations: deterministic classifier ───────────────────────────────────────────────
/** The moderation categories the twin reports (faithful key set). */
export const MODERATION_CATEGORIES = [
  'hate', 'hate/threatening', 'harassment', 'harassment/threatening', 'illicit', 'illicit/violent',
  'self-harm', 'self-harm/intent', 'self-harm/instructions',
  'sexual', 'sexual/minors', 'violence', 'violence/graphic',
] as const;

/** The categories an image is classified in besides text (the spec's `category_applied_input_types`; the moderation
 *  guide, https://platform.openai.com/docs/guides/moderation). */
export const IMAGE_CATEGORIES = new Set(['self-harm', 'self-harm/intent', 'self-harm/instructions', 'sexual', 'violence', 'violence/graphic']);

// Deterministic keyword → category map. The twin can't run the real classifier, so it flags
// on a fixed keyword list (clearly a heuristic). Shape is faithful; the decision is a stub.
export const MODERATION_KEYWORDS: Record<string, string> = {
  kill: 'violence', murder: 'violence', attack: 'violence',
  hate: 'hate', hateful: 'hate',
  harass: 'harassment',
  suicide: 'self-harm', 'self-harm': 'self-harm',
};

export type ModerationResult = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
  category_applied_input_types?: Record<string, string[]>;
};

/** Deterministically moderate one input (its text, and whether it held an image) into the faithful result shape: each
 *  category with the input types its score applies to, as every result carries them
 *  (https://platform.openai.com/docs/api-reference/moderations/object). */
export function moderateText(text: string, image = false): ModerationResult {
  const lower = text.toLowerCase();
  const categories: Record<string, boolean> = {};
  const scores: Record<string, number> = {};
  for (const c of MODERATION_CATEGORIES) { categories[c] = false; scores[c] = 0; }
  let flagged = false;
  for (const [kw, cat] of Object.entries(MODERATION_KEYWORDS)) {
    if (lower.includes(kw)) { categories[cat] = true; scores[cat] = 0.99; flagged = true; }
  }
  const applied: Record<string, string[]> = {};
  for (const c of MODERATION_CATEGORIES) applied[c] = image && IMAGE_CATEGORIES.has(c) ? ['text', 'image'] : ['text'];
  return { flagged, categories, category_scores: scores, category_applied_input_types: applied };
}

export const ASSISTANT = 'AssistantObject';

/** An assistant's tool resources: as sent, with the empty store list a file_search tool searches when none is named
 *  (the reference's modify example answers `"tool_resources": {"file_search": {"vector_store_ids": []}}` for an
 *  assistant given the file_search tool and no stores: https://platform.openai.com/docs/api-reference/assistants/modifyAssistant). */
export function toolResources(tools: unknown, sent: unknown): Row {
  const out = { ...((sent && typeof sent === 'object' ? sent : {}) as Row) };
  if (Array.isArray(tools) && tools.some((t) => (t as { type?: unknown })?.type === 'file_search') && !out.file_search) out.file_search = { vector_store_ids: [] };
  // and the empty file list a code interpreter works on (the reference's listRuns and getThread examples answer
  // `"code_interpreter": {"file_ids": []}`)
  if (Array.isArray(tools) && tools.some((t) => (t as { type?: unknown })?.type === 'code_interpreter') && !out.code_interpreter) out.code_interpreter = { file_ids: [] };
  return out;
}

/** An assistant as `createAssistant` makes it from its request, made at `created` (unix seconds). */
export function assistantFields(p: Row, created: number): Row {
  const tools = Array.isArray(p.tools) ? p.tools : [];
  return {
    object: 'assistant', created_at: created,
    name: p.name ?? null, description: p.description ?? null,
    model: String(p.model), instructions: p.instructions ?? null,
    tools,
    tool_resources: toolResources(tools, p.tool_resources),
    metadata: objectOr(p.metadata, {}),
    // sampling "Defaults to 1" (https://platform.openai.com/docs/api-reference/assistants/object, `temperature`, `top_p`)
    temperature: p.temperature ?? 1, top_p: p.top_p ?? 1,
    response_format: p.response_format ?? 'auto',
  };
}

export const THREAD = 'ThreadObject';

export const THREAD_RUN = 'RunObject';

export function messageImagePart(part: Row): Row {
  return part.type === 'image_file' ? { type: 'image_file', image_file: { ...(part.image_file as Row) } } : { type: 'image_url', image_url: { ...(part.image_url as Row) } };
}

// source: spec:/components/schemas/CreateMessageRequest/properties/content "The text contents of the message."
export async function append(ctx: HandlerContext, threadId: string, p: Row): Promise<Row> {
  const parts = typeof p.content === 'string' ? [{ type: 'text', text: p.content }] : Array.isArray(p.content) ? p.content as Row[] : [];
  const content = parts.map((part) => part.type === 'text'
    ? { type: 'text', text: { value: typeof part.text === 'string' ? part.text : String((part.text as Row)?.value ?? ''), annotations: [] } }
    : messageImagePart(part));
  return ctx.create(MESSAGE, () => ({
    object: 'thread.message', created_at: epoch(ctx), thread_id: threadId, role: typeof p.role === 'string' ? p.role : 'user',
    status: 'completed', completed_at: epoch(ctx), incomplete_at: null, incomplete_details: null, content,
    assistant_id: p.assistant_id ?? null, run_id: p.run_id ?? null,
    attachments: Array.isArray(p.attachments) ? p.attachments : [], metadata: objectOr(p.metadata, {}),
    _seq: 1 + ctx.rowsRaw(MESSAGE, { withDeleted: true }).filter((r) => r.thread_id === threadId).reduce((n, r) => Math.max(n, Number(r._seq) || 0), 0),
  }), 'message.create');
}

export const MESSAGE = 'MessageObject';

/** The live thread the path names, or OpenAI's not-found answer. */
export function thread(ctx: HandlerContext): { id: string; } | { answer: Response; } {
  const id = at(ctx, 'thread_id');
  return ctx.row(THREAD, id) ? { id } : { answer: ctx.notFound(THREAD, id) };
}

// ── runs and steps ──────────────────────────────────────────────────────────────────────────
/** The run the path names under its thread, raw (its reply message is bookkeeping), or OpenAI's answer. */
export function run(ctx: HandlerContext): { run: Row; } | { answer: Response; } {
  const id = at(ctx, 'run_id');
  const found = ctx.row(THREAD_RUN, id);
  return found && found.thread_id === at(ctx, 'thread_id') ? { run: found } : { answer: ctx.notFound(THREAD_RUN, id) };
}

/** Observe the vendor's work on a run: it stops for its function tools, else the read that completes it appends
 *  the reply to its thread. */
export async function workRun(ctx: HandlerContext, id: string): Promise<void> {
  // OpenAI's own move whoever reads the run: its progress and reply carry no caller
  await ctx.asVendor(async () => {
    if (await waitOnTools(ctx, id)) return;
    const moved = await progress(ctx, THREAD_RUN, id, finishRun(ctx));
    if (moved?.to !== 'completed') return;
    const r = moved.row;
    const reply = await append(ctx, String(r.thread_id), { role: 'assistant', content: replyText(String(r.model)), assistant_id: r.assistant_id, run_id: r.id });
    await ctx.write(THREAD_RUN, id, { _reply_msg: reply.id }, 'run.update');
  });
}

/** A run waiting on its tools' outputs past its `expires_at` (created plus ten minutes, `createRun`) expires at that
 *  moment, and no longer takes them; the vendor's move, written when it fell due. */
// source: spec:/components/schemas/RunObject/properties/expires_at "The Unix timestamp (in seconds) for when the run will expire."
export async function expireRuns(ctx: HandlerContext): Promise<void> {
  const now = epoch(ctx);
  const due = ctx.rowsRaw(THREAD_RUN).filter((r) => r.status === 'requires_action' && typeof r.expires_at === 'number' && r.expires_at <= now);
  for (const r of due) await expireRun(ctx, r);
}

export async function expireRun(ctx: HandlerContext, r: Row): Promise<void> {
  const at = await ctx.at(new Date(Number(r.expires_at) * 1000).toISOString());
  await at.change(THREAD_RUN, String(r.id), (current) => current.status !== 'requires_action' || at.legal(THREAD_RUN, 'status', ctx.call.operation.id, 'requires_action', 'expired', String(r.id), 'vendor') ? undefined : { status: 'expired', required_action: null }, 'run.update');
}

/** A run whose model calls its function tools stops at `requires_action`, naming the calls it waits on
 *  (https://platform.openai.com/docs/assistants/tools/function-calling: "the Run will enter a requires_action
 *  status"); the vendor's moves, read and then written. */

export async function waitOnTools(ctx: HandlerContext, id: string): Promise<boolean> {
  let waiting = false;
  await ctx.change(THREAD_RUN, id, (current) => {
    if (current.status !== 'queued') return undefined;
    const asked = ctx.rowsRaw(MESSAGE).filter((m) => m.thread_id === current.thread_id && m.role === 'user').sort((a, b) => Number(a._seq ?? 0) - Number(b._seq ?? 0)).at(-1);
    const calls = toolCalls(current, String(((asked?.content as Row[] | undefined)?.[0]?.text as Row | undefined)?.value ?? ''));
    if (!calls.length || ctx.legal(THREAD_RUN, 'status', ctx.call.operation.id, 'queued', 'in_progress', id, 'vendor')) return undefined;
    return { status: 'in_progress', started_at: epoch(ctx), _tool_calls: calls };
  }, 'run.update');
  await ctx.change(THREAD_RUN, id, (current) => {
    if (current.status === 'requires_action') { waiting = true; return undefined; }
    const calls = current._tool_calls as Row[] | undefined;
    if (current.status !== 'in_progress' || !calls?.length || current._tools_answered) return undefined;
    if (ctx.legal(THREAD_RUN, 'status', ctx.call.operation.id, 'in_progress', 'requires_action', id, 'vendor')) return undefined;
    waiting = true;
    return { status: 'requires_action', required_action: { type: 'submit_tool_outputs', submit_tool_outputs: { tool_calls: calls } } };
  }, 'run.update');
  return waiting;
}

/** What a completed run carries: its reply message and usage; a run that waited on its tools keeps when it started. */

export function finishRun(ctx: HandlerContext): (row: Row, end: string) => Row {
  return (row, end) => {
    if (end !== 'completed') return {};
    const text = replyText(String(row.model));
    return { expires_at: null, ...(row.started_at ? { started_at: row.started_at } : {}), usage: { prompt_tokens: 0, completion_tokens: estimateTokens(text), total_tokens: estimateTokens(text) } };
  };
}

export const replyText = (model: string): string => `[twin-stub:${model}] deterministic assistant run output (no model weights are run)`;

/** The function tools a run's model calls: its placeholder decision is to call them (each one, or the one
 *  `tool_choice` names, or the first when calls are not parallel), unless `tool_choice` is `none` or their outputs
 *  were already submitted. */

export function toolCalls(r: Row, userText = ''): Row[] {
  const functions = (Array.isArray(r.tools) ? r.tools : []).filter((t) => (t as { type?: unknown; }).type === 'function') as Row[];
  if (!functions.length || r.tool_choice === 'none' || r._tools_answered) return [];
  const named = r.tool_choice && typeof r.tool_choice === 'object' ? String(((r.tool_choice as Row).function as Row | undefined)?.name ?? '') : '';
  const chosen = named ? functions.filter((t) => (t.function as Row | undefined)?.name === named) : r.parallel_tool_calls === false ? functions.slice(0, 1) : functions;
  return chosen.map((tool, i) => {
    const call = stubToolCall([tool], i + 1, undefined, userText)!;
    return { id: callId(`${String(r.id)}:${i + 1}`), type: 'function', function: call.function };
  });
}

/** A run step's id, derived from its run and type (a run takes one of each).
 * Where documentation stops: step_abc123 supplies the prefix only; keep the default 27 base62 characters. */
// source: spec:getRunStep "step_abc123"
export const stepId = (r: Row, type: string): string => `step_${base62From(`${String(r.id)}:${type}`, 27)}`;

/** A run's steps, newest first: the call of its function tools (done once their outputs are in, each call with its
 *  output), and, once it completed, the creation of its reply message. */
export function steps(r: Row): Row[] {
  const base = { object: 'thread.run.step', run_id: String(r.id), assistant_id: String(r.assistant_id), thread_id: String(r.thread_id), cancelled_at: null, expired_at: null, failed_at: null, last_error: null, metadata: {} };
  const out: Row[] = [];
  const calls = (r._tool_calls ?? []) as Row[];
  if (calls.length) {
    const outputs = (r._tool_outputs ?? {}) as Record<string, string>;
    const done = r._tools_answered === true;
    const cancelled = !done && (r.status === 'cancelled' || r.status === 'cancelling');
    out.push({
      ...base, id: stepId(r, 'tool_calls'), created_at: Number(r.started_at ?? r.created_at ?? 0), type: 'tool_calls',
      status: done ? 'completed' : cancelled ? 'cancelled' : 'in_progress', completed_at: done ? Number(r._tools_answered_at ?? r.started_at ?? 0) : null,
      ...(cancelled ? { cancelled_at: Number(r.cancelled_at ?? r.started_at ?? 0) } : {}),
      step_details: { type: 'tool_calls', tool_calls: calls.map((c) => ({ ...c, function: { ...(c.function as Row), output: done ? (outputs[String(c.id)] ?? null) : null } })) },
      usage: null,
    });
  }
  if (r.status === 'completed') {
    const created = Number(r.completed_at ?? r.created_at ?? 0);
    out.unshift({
      ...base, id: stepId(r, 'message_creation'), created_at: created,
      type: 'message_creation', status: 'completed', completed_at: created,
      step_details: { type: 'message_creation', message_creation: { message_id: String(r._reply_msg ?? '') } },
      usage: r.usage ?? null,
    });
  }
  return out;
}

/** A run created with `stream: true` answers its events as it runs (https://platform.openai.com/docs/api-reference/assistants-streaming/events):
 *  created, queued and in progress, then either its tool-call step and `thread.run.requires_action` (a run that waits on
 *  its function tools), or its message-creation step, the reply message with its text as deltas, and the run completed;
 *  then `done`. Submitted tool outputs stream the same way from the finished tool-call step. The twin works the run in
 *  the stream as a read would; each event is a server-sent `event:` with its object as `data`. */
export async function streamRun(ctx: HandlerContext, queued: Row, submitted = false): Promise<Response> {
  const id = String(queued.id);
  await workRun(ctx, id);
  const done = ctx.get(THREAD_RUN, id)!;
  const all = steps(ctx.row(THREAD_RUN, id)!);
  const toolStep = all.find((x) => x.type === 'tool_calls');
  const step = all.find((x) => x.type === 'message_creation');
  const message = step ? ctx.get(MESSAGE, String((step.step_details as { message_creation: { message_id: string; }; }).message_creation.message_id)) : undefined;
  const started = { ...done, status: 'in_progress', completed_at: null, required_action: null, usage: null };
  const events: Array<[string, unknown]> = submitted
    ? [['thread.run.step.completed', toolStep], ['thread.run.queued', queued], ['thread.run.in_progress', started]]
    : [['thread.run.created', queued], ['thread.run.queued', queued], ['thread.run.in_progress', started]];
  if (done.status === 'requires_action' && toolStep) {
    events.push(['thread.run.step.created', toolStep], ['thread.run.step.in_progress', toolStep], ['thread.run.requires_action', done]);
  } else {
    if (step && message) {
      const text = String(((message.content as Row[])[0]?.text as { value?: unknown; } | undefined)?.value ?? '');
      const stepRunning = { ...step, status: 'in_progress', completed_at: null, usage: null };
      const messageRunning = { ...message, status: 'in_progress', completed_at: null, content: [] };
      events.push(['thread.run.step.created', stepRunning], ['thread.run.step.in_progress', stepRunning], ['thread.message.created', messageRunning], ['thread.message.in_progress', messageRunning]);
      for (let i = 0; i < text.length; i += 20) events.push(['thread.message.delta', { id: message.id, object: 'thread.message.delta', delta: { content: [{ index: 0, type: 'text', text: { value: text.slice(i, i + 20), annotations: [] } }] } }]);
      events.push(['thread.message.completed', message], ['thread.run.step.completed', step]);
    }
    events.push(['thread.run.completed', done]);
  }
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('') + 'event: done\ndata: [DONE]\n\n';
  return ctx.raw(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } });
}

/** Submitting a waiting run's tool outputs queues it again to finish (https://platform.openai.com/docs/api-reference/runs/submitToolOutputs):
 *  only a run at `requires_action` takes them, and they must answer every call it waits on, and only those. */
export const submitToolOutputs: Handler = async (ctx) => {
  const found = run(ctx);
  if ('answer' in found) return found.answer;
  const r = found.run;
  const refusal = ctx.legal(THREAD_RUN, 'status', 'submitToolOuputsToRun', r.status, 'queued');
  if (refusal) return ctx.refuse(refusal);
  const outputs = Array.isArray(ctx.params.tool_outputs) ? (ctx.params.tool_outputs as Row[]) : undefined;
  if (!outputs) return invalid(ctx, 'you must provide a tool_outputs array', 'tool_outputs');
  const waiting = ((r._tool_calls ?? []) as Row[]).map((c) => String(c.id));
  const given = outputs.map((o) => String(o.tool_call_id ?? ''));
  const unknown = given.find((g) => !waiting.includes(g));
  if (unknown !== undefined) return invalid(ctx, `Invalid tool_call_id: ${unknown}. No tool call with that id is waiting on this run.`, 'tool_outputs');
  const missingIds = waiting.filter((w) => !given.includes(w));
  if (missingIds.length) return invalid(ctx, `Expected tool outputs for call_ids ${JSON.stringify(waiting)}, got ${JSON.stringify(given)}`, 'tool_outputs');
  const fields = { status: 'queued', required_action: null, _tools_answered: true, _tools_answered_at: epoch(ctx), _tool_outputs: Object.fromEntries(outputs.map((o) => [String(o.tool_call_id), String(o.output ?? '')])) };
  let raced: Parameters<HandlerContext['refuse']>[0] | undefined;
  const queued = await ctx.change(THREAD_RUN, String(r.id), (current) => {
    raced = ctx.legal(THREAD_RUN, 'status', 'submitToolOuputsToRun', current.status, 'queued');
    return raced ? undefined : fields;
  }, 'run.update');
  if (raced) return ctx.refuse(raced);
  if (!queued) return ctx.notFound(THREAD_RUN, String(r.id));
  return ctx.params.stream === true ? streamRun(ctx, queued, true) : ctx.reply(queued);
};

/** When a file expires (its `expires_at`): `expires_after.seconds` past its creation when the upload set one, else
 *  thirty days for a batch file, else never. "By default, files with `purpose=batch` expire after 30 days and all
 *  other files are persisted until they are manually deleted"; `seconds` "must be between 3600 (1 hour) and 2592000
 *  (30 days)" (developers.openai.com/api/reference/resources/files/methods/create, `expires_after`). Undefined for a
 *  policy OpenAI refuses. */

export function expiresAt(purpose: string, created: number, after: unknown): number | null | undefined {
  return after !== undefined ? expiresAfter(created, after) : purpose === 'batch' ? created + THIRTY_DAYS : null;
}

/** The expiry an upload's own `expires_after` sets, or undefined for one out of range. */

export function expiresAfter(created: number, after: unknown): number | undefined {
  const a = (after && typeof after === 'object' ? after : {}) as Row;
  const seconds = Number(a.seconds);
  return a.anchor === 'created_at' && Number.isInteger(seconds) && seconds >= 3600 && seconds <= THIRTY_DAYS ? created + seconds : undefined;
}

export const THIRTY_DAYS = 30 * 24 * 3600;

/** Files whose time is up are gone, each deleted at the moment it expired, not when a later request looks: a batch
 *  input thirty days after its upload (above), a batch's output "automatically deleted 30 days after the batch is
 *  complete" (developers.openai.com/api/docs/guides/batch). A get, download or delete of one then answers OpenAI's
 *  404 for a file that does not exist. */

export async function expireOneFile(ctx: HandlerContext, file: Row): Promise<void> {
  const at = await ctx.at(new Date(Number(file.expires_at) * 1000).toISOString());
  await at.write('OpenAIFile', String(file.id), { deleted: true }, 'file.delete');
}

export async function expireFiles(ctx: HandlerContext): Promise<void> {
  const now = epoch(ctx);
  const due = ctx.rowsRaw('OpenAIFile').filter((f) => typeof f.expires_at === 'number' && f.expires_at <= now);
  for (const f of due.sort((a, b) => Number(a.expires_at) - Number(b.expires_at))) await expireOneFile(ctx, f);
}

/** The request the World's scenario reads for a chat completion or a response, as their handlers read it (a response
 *  continuing another carries the prior one's items first); none for a request the handler will refuse. */
export function scenarioRequest(ctx: HandlerContext, operation: string): OpenAIScenarioRequest | undefined {
  if (operation === 'createChatCompletion') {
    const validated = validateChat(ctx.params);
    if ('error' in validated) return undefined;
    const a = validated.args;
    return { model: a.model, messages: a.messages, tools: a.tools, maxTokens: a.maxTokens, toolChoice: (ctx.params as Row).tool_choice };
  }
  const validated = validateResponses(ctx.params);
  if ('error' in validated) return undefined;
  const args = validated.args;
  if (args.previousResponseId) {
    const prior = ctx.row('Response', args.previousResponseId);
    if (!prior) return undefined;
    args.inputItems = [...((prior._input_items ?? []) as Row[]), ...((prior.output ?? []) as Row[]), ...args.inputItems];
    args.messages = responseMessages(args.inputItems, args.instructions);
  }
  return { model: args.model, messages: args.messages, tools: args.tools, maxTokens: args.maxTokens, toolChoice: (ctx.params as Row).tool_choice };
}

// Codex's separate wire shares only vendor custody and pure mechanics with the REST API.
export const CODEX_CLIENT = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const codexBody = (ctx: HandlerContext): Row => ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body as Row : Object.fromEntries(new URLSearchParams(ctx.text));
export const codexError = (code: string, message: string, status = 400): Response => Response.json({ error: { code, message, type: 'invalid_request_error' } }, { status });
export async function codexOpaque(ctx: HandlerContext, label: string): Promise<string> {
  const nonce = await ctx.create('_codex_nonce', { _label: label }, 'codex.nonce');
  return ctx.secret(`codex:${label}:${nonce.id}`);
}
// The OAuth client's tokens are id/access/refresh; it reads exp and the account identity from JWT claims.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/token_data.rs "chatgpt_account_id"
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/storage.rs "Expected structure for $CODEX_HOME/auth.json."
export async function codexTokens(ctx: HandlerContext, account: Row, client = CODEX_CLIENT, family?: string): Promise<Row> {
  const id = ctx.mint('_codex_grant'), refresh = await ctx.secret(`codex:refresh:${id}`), signing = await ctx.signingKey('codex-oauth');
  const claims = { iss: 'https://auth.openai.com', sub: account.id, email: account.email, jti: id, 'https://api.openai.com/auth': { chatgpt_account_id: account.id, chatgpt_user_id: account.id, chatgpt_plan_type: 'plus' }, 'https://api.openai.com/profile': { email: account.email } };
  // Where source stops: signing and one-hour access/thirty-day refresh lifetime are synthetic World policy.
  const access_token = ctx.crypto.jwtSign({ ...claims, aud: 'https://api.openai.com/v1' }, { alg: 'RS256', ...signing }, { now: epoch(ctx), expiresInSeconds: 3600 });
  const id_token = ctx.crypto.jwtSign({ ...claims, aud: client }, { alg: 'RS256', ...signing }, { now: epoch(ctx), expiresInSeconds: 3600 });
  await ctx.write('_codex_grant', id, { status: 'active', _account: account.id, _client: client, _family: family ?? id, _access: access_token, _id_token: id_token, _refresh: refresh, _refresh_hash: sha256(refresh), _expires: epoch(ctx) + 3600, _refresh_expires: epoch(ctx) + 30 * 86400 }, 'codex.issue');
  return { access_token, id_token, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 };
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/storage.rs "OPENAI_API_KEY"
export async function codexCredentials(ctx: HandlerContext): Promise<Row> {
  let account = ctx.rowsRaw('_codex_account')[0];
  const password = await ctx.secret('codex:account:password');
  if (!account) {
    const email = 'codex@example.test';
    await codexRecordPerson(ctx, email, password, { name: 'World Codex account' });
    account = await ctx.create('_codex_account', { email }, 'codex.account');
  }
  const held = ctx.rowsRaw('_codex_grant').find(g => g._account === account!.id && g.status === 'active' && Number(g._expires) > epoch(ctx));
  const tokens = held ? { access_token: held._access, id_token: held._id_token, refresh_token: held._refresh } : await codexTokens(ctx, account);
  const auth = { auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: { access_token: tokens.access_token, id_token: tokens.id_token, refresh_token: tokens.refresh_token, account_id: account.id }, last_refresh: ctx.occurredAt };
  return { codex_account_id: account.id, codex_email: account.email, codex_password: password, codex_tokens: tokens, codex_home: { 'auth.json': auth, 'config.toml': 'cli_auth_credentials_store = "file"\n' } };
}
// The client sends Bearer auth plus the account claim; source supplies no exact invalid-token wording.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/client.rs "chatgpt_account_id"
export function codexGrant(ctx: HandlerContext): Row | Response {
  const token = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const grant = token ? ctx.rowsRaw('_codex_grant').find(g => g._access === token) : undefined;
  if (!grant || grant.status === 'revoked' || Number(grant._expires) <= epoch(ctx)) return codexError('invalid_token', 'Authentication token is missing, expired or revoked.', 401);
  const account = ctx.call.request.headers.get('chatgpt-account-id');
  if (account && account !== grant._account) return codexError('access_denied', 'The account does not match the token.', 403);
  return grant;
}
// PKCE is S256 and the code is tied to the requested client and redirect.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "code_challenge_method"
export async function codexCode(ctx: HandlerContext, fields: Row): Promise<string> {
  const code = await codexOpaque(ctx, 'code');
  await ctx.write('_codex_code', sha256(code), { status: 'fresh', ...fields, _expires: epoch(ctx) + 600 }, 'codex.code');
  return code;
}
// The screen's form fields and collapsed consent are a twin UI; OpenAI documents only the round trip.
// source: https://developers.openai.com/codex/auth "one-time code"
export async function codexConsent(ctx: HandlerContext, device: boolean): Promise<Response | { query?: string; error?: string; notice?: string }> {
  const form = Object.fromEntries(new URLSearchParams(ctx.text));
  if (!codexPersonWith(ctx, form.email ?? '', form.password ?? '')) return { query: form.query, error: 'Wrong email or password.' };
  const account = ctx.rowsRaw('_codex_account').find(a => a.email === form.email);
  if (!account) return { query: form.query, error: 'This account has no Codex subscription.' };
  if (device) {
    const request = ctx.rowsRaw('_codex_device').find(d => d.user_code === form.user_code);
    if (!request || Number(request._expires) <= epoch(ctx)) return { error: 'The one-time code is invalid or expired.' };
    const refusal = ctx.legal('_codex_device', 'status', 'screen:device', request.status, 'approved', String(request.id), 'external');
    if (refusal) return ctx.refuse(refusal);
    const verifier = await codexOpaque(ctx, 'verifier');
    const challenge = ctx.crypto.digest('sha256', verifier, 'base64url');
    const code = await codexCode(ctx, { _account: account.id, _client: request._client, _redirect: 'https://auth.openai.com/deviceauth/callback', _challenge: challenge });
    await ctx.write('_codex_device', String(request.id), { status: 'approved', _code: code, _verifier: verifier, _challenge: challenge }, 'codex.consent');
    return { notice: 'Device authorized. Return to Codex.' };
  }
  const q = new URLSearchParams(form.query ?? '');
  const redirect = codexRedirect(q.get('redirect_uri'));
  if (!redirect || q.get('client_id') !== CODEX_CLIENT || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return codexError('invalid_request', 'Invalid authorization request.');
  const allowed = q.get('allowed_workspace_id');
  if (allowed && !allowed.split(',').includes(String(account.id))) return codexError('access_denied', 'This account is not authorized in the requested workspace.', 403);
  const code = await codexCode(ctx, { _account: account.id, _client: CODEX_CLIENT, _redirect: redirect.href, _challenge: q.get('code_challenge') });
  redirect.searchParams.set('code', code);
  if (q.has('state')) redirect.searchParams.set('state', q.get('state')!);
  return new Response(null, { status: 302, headers: { location: redirect.href } });
}
// Codex owns its localhost callback. No redirect to an arbitrary site is part of that flow.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "http://localhost:{actual_port}/auth/callback"
export function codexRedirect(raw: string | null): URL | undefined {
  try { const u = new URL(raw ?? ''); return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password && u.pathname === '/auth/callback' ? u : undefined; } catch { return undefined; }
}
export { codexCatalog } from '../engine/codex-models.ts';
export { sha256, openaiWire } from '@volter/world-core';

// The subscribed client speaks Responses items and named output/tool events on HTTP and WebSocket alike.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/responses.rs "ResponsesEndpoint"
export function codexShape(ctx: HandlerContext, body: Row, turn: CodexWire.WireTurn) {
  const id = ctx.mint('_codex_call');
  return { id, model: String(body.model), createdAt: epoch(ctx), body: { store: false, ...body }, turn,
    itemId: (kind: string, i: number) => `${kind}_${base62From(`${id}:${kind}:${i}`, 24)}`, defaults: { store: false } };
}
