// What every family of the Gemini API shares: its API keys (made in Google AI Studio), its models, Google's error
// envelope, a request's contents as text, and the turn the twin answers when the World scripts none: a labeled stub,
// for THE TWIN RUNS NO MODEL.
import { placeholderPng, sampleFromSchema, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const KEY = '_api_key';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const arr = (v: unknown): Row[] => Array.isArray(v) ? v as Row[] : v && typeof v === 'object' ? [v as Row] : [];
const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

// ── keys ───────────────────────────────────────────────────────────────────────────────────────
// A Gemini API key is a Google API key: `AIza` and 35 letters, digits, `-` and `_`. The World keeps it by its SHA-256 and
// draws it from a secret it holds.

const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `AIza${`${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 35)}`;

/** Google Cloud project owning the AI Studio keys. */
// source: https://ai.google.dev/gemini-api/docs/api-key
export async function keyProject(ctx: HandlerContext): Promise<Row> {
  return ctx.tenant('_project', async (organization) => String((await ctx.create('_project', (id) => ({
    name: `projects/${id}`, displayName: organization.label, owner: organization.members[0]!.toLowerCase(),
  }), 'project.create')).id));
}

export async function makeKey(ctx: HandlerContext, name: string, project: Row): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `gemini-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name: `${project.name}/locations/global/keys/${id}`, displayName: name, project: project.id, parent: `${project.name}/locations/global`,
    restrictions: { apiTargets: [{ service: 'generativelanguage.googleapis.com' }] },
    label, createTime: ctx.occurredAt, suffix: key.slice(-4), sha256: sha256(ctx, key) }, id);
  return id;
}

export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (row.deleted === true) return undefined;
  const key = await keyValue(ctx, String(row.label));
  return sha256(ctx, key) === row.sha256 ? key : undefined;
}

/** The key a request carries (`x-goog-api-key`, or the `key` query parameter), and whether the World issued it. */
export function keyOf(ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto' | 'call'>): { given: boolean; row?: Row } {
  const req = ctx.call.request;
  const value = req.headers.get('x-goog-api-key') ?? new URL(req.url).searchParams.get('key');
  if (!value) return { given: false };
  const row = ctx.rowsRaw(KEY).find((k) => k.sha256 === sha256(ctx, value));
  return { given: true, row: row && row.deleted !== true ? row : undefined };
}

// ── errors ─────────────────────────────────────────────────────────────────────────────────────
// source: https://cloud.google.com/apis/design/errors "Services must return a google.rpc.Status message when an API error occurs"

/** Google's error envelope: `{error: {code, message, status, details}}`. */
export const googleError = (code: number, status: string, message: string, details: Row[] = []): Response =>
  Response.json({ error: { code, message, status, ...(details.length ? { details } : {}) } }, { status: code });

// ── models ─────────────────────────────────────────────────────────────────────────────────────
// source: https://ai.google.dev/gemini-api/docs/deprecations "Once a model is"
export const MODEL_DATES: Record<string, { from: string; until?: string }> = {
  "gemini-2.0-flash": {
    "from": "2025-02-05",
    "until": "2026-06-01"
  },
  "gemini-2.0-flash-lite": {
    "from": "2025-02-25",
    "until": "2026-06-01"
  },
  "gemini-2.5-flash": {
    "from": "2025-06-17"
  },
  "gemini-2.5-flash-lite": {
    "from": "2025-07-22"
  },
  "gemini-2.5-pro": {
    "from": "2025-06-17"
  },
  "gemini-2.5-flash-image": {
    "from": "2025-10-02",
    "until": "2026-10-02"
  },
  "gemini-3-flash-preview": {
    "from": "2025-12-17"
  },
  "gemini-3-pro-preview": {
    "from": "2025-11-18",
    "until": "2026-03-09"
  },
  "gemini-3.1-pro-preview": {
    "from": "2026-02-19"
  },
  "gemini-3.1-flash-lite": {
    "from": "2026-05-07",
    "until": "2027-05-07"
  },
  "gemini-3.1-flash-lite-preview": {
    "from": "2026-03-03",
    "until": "2026-05-25"
  },
  "gemini-3.5-flash": {
    "from": "2026-05-19"
  },
  "gemini-3.5-flash-lite": {
    "from": "2026-07-21"
  },
  "gemini-3.6-flash": {
    "from": "2026-07-21"
  },
  "gemini-3.7-flash": {
    "from": "2026-08-13"
  },
  "gemini-3.8-flash": {
    "from": "2026-09-02"
  },
  "gemini-3.1-flash-image": {
    "from": "2026-05-28"
  },
  "gemini-3-pro-image": {
    "from": "2026-05-28"
  }
};
// A flat-path label is the model segment; identity remains the vendor resource name.
// source: spec:generativelanguage.models.generateContent "models/{model}"
export const modelName = (param: unknown): string => String(param ?? '').replace(/^models\//, '');
export function liveModel(model: string, at: string): boolean {
  const date = MODEL_DATES[model];
  return !!date && at.slice(0, 10) >= date.from && (!date.until || at.slice(0, 10) < date.until);
}
// source: https://ai.google.dev/gemini-api/docs/models "Points to the latest release for a specific model variation."
export function resolveModel(model: string, at: string): string {
  const variation = model === 'gemini-flash-latest' ? /flash(?:-preview)?$/ : model === 'gemini-flash-lite-latest' ? /flash-lite(?:-preview)?$/ : undefined;
  return variation ? Object.entries(MODEL_DATES).filter(([name]) => variation.test(name) && liveModel(name, at)).sort((a, b) => b[1].from.localeCompare(a[1].from))[0]?.[0] ?? model : model;
}
/** The API's answer for a model it does not serve for a method. Where the documentation stops: the message is the
 *  API's as its clients report it. */
export const noModel = (name: string, method: string): Response =>
  googleError(404, 'NOT_FOUND', `models/${name} is not found for API version v1beta, or is not supported for ${method}. Call ListModels to see the list of available models and their supported methods.`);

// ── contents ───────────────────────────────────────────────────────────────────────────────────

export const partsText = (parts: unknown): string => arr(parts).map((p) => (typeof p.text === 'string' && p.thought !== true ? p.text : '')).join('');
/** The text of the last user turn. */
export function lastUserText(contents: Row[]): string {
  for (let i = contents.length - 1; i >= 0; i--) if ((contents[i]!.role ?? 'user') === 'user') { const t = partsText(contents[i]!.parts); if (t) return t; }
  return '';
}
/** The functions whose results the last turn carries. */
export const functionResults = (contents: Row[]): string[] => arr(contents.at(-1)?.parts).map((p) => obj(p.functionResponse).name).filter((n): n is string => typeof n === 'string');
/** The functions a request offers, and whether it offers Google Search. */
export function toolsOf(b: Row): { functions: Row[]; googleSearch: boolean } {
  const tools = arr(b.tools);
  return { functions: tools.flatMap((t) => arr(t.functionDeclarations ?? t.function_declarations)), googleSearch: tools.some((t) => t.googleSearch !== undefined || t.google_search !== undefined || t.googleSearchRetrieval !== undefined) };
}

/** Tokens, as the API counts them near enough: a token is about four characters. Where the documentation stops: the
 *  tokenizer is the model's; the twin's count is its estimate. */
// source: https://ai.google.dev/gemini-api/docs/tokens "For Gemini models, a token is equivalent to about 4 characters."
export const tokens = (text: string): number => Math.ceil(text.length / 4);

// ── the turn ───────────────────────────────────────────────────────────────────────────────────

export type Turn = { text?: string; functionCalls?: Array<{ id?: string; name: string; args: Row }>; thinking?: string; finishReason?: string; parts?: Row[]; groundingMetadata?: Row; safetyRatings?: Row[]; promptFeedback?: Row };

/** The stub: no model runs, and the answer says so. With functions offered (calling not `NONE`) and the last turn not a
 *  function's result, it calls the first allowed function with arguments its schema admits; with a JSON response schema,
 *  it answers a value the schema admits; otherwise it echoes the last user text, labeled. */
export function stubTurn(b: Row, model: string): Turn {
  const contents = arr(b.contents);
  const { functions } = toolsOf(b);
  const calling = obj(obj(b.toolConfig ?? b.tool_config).functionCallingConfig ?? obj(b.toolConfig ?? b.tool_config).function_calling_config);
  const mode = String(calling.mode ?? 'AUTO').toUpperCase();
  const allowed = Array.isArray(calling.allowedFunctionNames ?? calling.allowed_function_names) ? ((calling.allowedFunctionNames ?? calling.allowed_function_names) as string[]) : undefined;
  if (functions.length && mode !== 'NONE' && (functionResults(contents).length === 0 || mode === 'ANY')) {
    const f = (allowed ? functions.find((x) => allowed.includes(String(x.name))) : undefined) ?? functions[0]!;
    return { functionCalls: [{ name: String(f.name), args: obj(sampleFromSchema(f.parameters ?? f.parametersJsonSchema ?? { type: 'OBJECT', properties: {} }, String(f.name))) }] };
  }
  const gen = obj(b.generationConfig ?? b.generation_config);
  if (String(gen.responseMimeType ?? gen.response_mime_type ?? '').includes('json')) {
    const schema = gen.responseJsonSchema ?? gen.responseSchema ?? gen.response_schema;
    return { text: JSON.stringify(schema ? sampleFromSchema(schema) : { twin_stub: `deterministic stub from the Gemini API twin (${model}): no model runs` }) };
  }
  // source: spec:/components/schemas/GenerationConfig/properties/responseModalities "The requested modalities"
  if (Array.isArray(gen.responseModalities ?? gen.response_modalities) && ((gen.responseModalities ?? gen.response_modalities) as string[]).includes('IMAGE')) {
    // source: spec:/components/schemas/ImageConfig/properties/imageSize "default value"
    // source: spec:/components/schemas/ImageConfig/properties/aspectRatio "Supported aspect ratios"
    const image = obj(gen.imageConfig ?? gen.image_config);
    const sizes: Record<string, number> = { '512': .5, '1K': 1, '2K': 2, '4K': 4 };
    // source: https://ai.google.dev/gemini-api/docs/image-generation "1376x768"
    const dimensions: Record<string, [number, number]> = { '1:1': [1024, 1024], '1:4': [512, 2048], '4:1': [2048, 512], '1:8': [384, 3072], '8:1': [3072, 384], '2:3': [848, 1264], '3:2': [1264, 848], '3:4': [896, 1200], '4:3': [1200, 896], '4:5': [928, 1152], '5:4': [1152, 928], '9:16': [768, 1376], '16:9': [1376, 768], '21:9': [1584, 672] };
    // With no aspect, the model chooses from its references; the deterministic stub chooses a square.
    const [width, height] = dimensions[String(image.aspectRatio ?? image.aspect_ratio ?? '1:1')] ?? dimensions['1:1']!;
    const scale = sizes[String(image.imageSize ?? image.image_size ?? '1K')] ?? 1;
    const bytes = placeholderPng({ width: width * scale, height: height * scale }, model + ':' + lastUserText(contents), 'Synthetic Gemini image; no model runs.');
    return { text: '[twin-stub] Synthetic image; no model runs.', parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(bytes).toString('base64') } }] };
  }
  // source: spec:/components/schemas/GenerationConfig/properties/responseMimeType "text/x.enum"
  if ((gen.responseMimeType ?? gen.response_mime_type) === 'text/x.enum') return { text: String(sampleFromSchema(gen.responseSchema ?? gen.response_schema)) };
  const said = lastUserText(contents).trim();
  return { text: `[twin-stub:${model}] This is a deterministic stub from the Gemini API twin (no model runs). Your last message: ${said.length > 200 ? `${said.slice(0, 200)}…` : said || '(empty)'}` };
}
