// What every family of ElevenLabs' API shares: its API keys (made in Developers > API Keys; the `xi-api-key` header), its
// error bodies, the account's voices (the default premade voices every account has, and the voices it adds), and its
// agents and their conversations (ElevenAgents), which the REST families and the conversation's WebSocket both read.
import type { HandlerContext } from '@volter/world-core';

export function accountFor(ctx: HandlerContext): Promise<Record<string, unknown>> {
  return ctx.tenant('_workspace', (organization) => ctx.record('_workspace', { name: organization.label, owner: organization.members[0]!, members: organization.members }));
}

export type Row = Record<string, unknown>;
export const KEY = '_api_key';
export const VOICE = 'voice';
export const AGENT = 'agent';
export const CONVERSATION = 'conversation';
export const WORKSPACE_SECRET = 'workspace_secret';
export const SIGNATURE = '_conversation_signature';

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const bodyOf = (ctx: HandlerContext): Row => obj(ctx.body);

// ── keys ───────────────────────────────────────────────────────────────────────────────────────
// Where the documentation stops: a key is `sk_` and 48 hexadecimal digits, the form the API Keys page shows; the World
// keeps it by its SHA-256 and draws it from a secret it holds.

const keyValue = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> =>
  `sk_${ctx.crypto.digest('sha256', await ctx.secret(label), 'hex').slice(0, 48)}`;
export async function makeKey(ctx: HandlerContext, name: string, owner: string): Promise<string> {
  const id = await ctx.issue(KEY);
  const label = `elevenlabs-api-key:${id}`;
  const key = await keyValue(ctx, label);
  await ctx.record(KEY, { name, label, _workspace: owner, _tenant_scope: await ctx.account() === 'default' ? 'default' : owner, created: ctx.occurredAt, sha256: ctx.crypto.digest('sha256', key, 'hex') }, id);
  return id;
}
export async function readKey(ctx: HandlerContext, row: Row): Promise<string | undefined> {
  if (typeof row.label !== 'string') return undefined;
  const key = await keyValue(ctx, row.label);
  return ctx.crypto.digest('sha256', key, 'hex') === row.sha256 ? key : undefined;
}
// ── errors ─────────────────────────────────────────────────────────────────────────────────────

/** A refusal. Where the documentation stops: the body is `{detail: {status, message}}`, as the API answers and its
 *  clients read it (Volter Harness reads `detail.message`). */
export const elError = (status: number, code: string, message: string): Response =>
  Response.json({ detail: { status: code, message } }, { status });

/** A request the API's validation refuses: 422 with `detail` a list of `{type, loc, msg}`, as its HTTPValidationError
 *  says (Volter Harness reads each item's `loc` and `msg`). */
// source: spec:create_agent_route "Validation Error"
export const invalid = (items: Array<{ type: string; loc: Array<string | number>; msg: string; input?: unknown }>): Response =>
  Response.json({ detail: items.map((i) => ({ type: i.type, loc: i.loc, msg: i.msg, input: i.input ?? null })) }, { status: 422 });

// ── voices ─────────────────────────────────────────────────────────────────────────────────────
// The default voices are ElevenLabs' own catalogue. Where the documentation stops: its pages name no voice ids; the twin
// holds the default voice its spec names, Rachel, and a World adds the others it needs through the API (add_voice).

// source: spec:/components/schemas/VoiceResponseModel "21m00Tcm4TlvDq8ikWAM"
export const DEFAULT_VOICES: Row[] = [{
  voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade', description: 'A warm, expressive voice with a touch of humor.',
  labels: { accent: 'American', age: 'middle-aged', description: 'expressive', gender: 'female', use_case: 'social media' },
  preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/9BWtsMINqrJLrRacOk9x/405766b8-1f4e-4d3c-aba1-6f25333823ec.mp3',
}];

/** A voice as the API answers it. */
export const voiceView = (v: Row): Row => ({
  voice_id: v.voice_id, name: v.name, samples: null, category: v.category ?? 'premade', fine_tuning: null, labels: v.labels ?? {}, description: v.description ?? null,
  preview_url: v.preview_url ?? null, available_for_tiers: [], settings: null, sharing: null,
  high_quality_base_model_ids: ['eleven_v2_flash', 'eleven_flash_v2', 'eleven_turbo_v2_5', 'eleven_multilingual_v2', 'eleven_v2_5_flash', 'eleven_flash_v2_5', 'eleven_turbo_v2'],
  verified_languages: [], collection_ids: [], safety_control: null, voice_verification: null, permission_on_resource: null, is_owner: v.category !== 'premade',
  is_legacy: false, is_mixed: false, favorited_at_unix: null, created_at_unix: typeof v.created_at === 'string' ? Math.floor(Date.parse(v.created_at) / 1000) : null,
});

/** The account's voices: the defaults, then the voices it holds, in the order it took them; a voice the account holds
 *  under a default's id (a root's refresh reads the premade voices back) is that voice. */
export const voicesOf = (ctx: Pick<HandlerContext, 'rows'>): Row[] => {
  const held = ctx.rows(VOICE);
  const ids = new Set(held.map((v) => v.voice_id));
  return [...DEFAULT_VOICES.filter((v) => !ids.has(v.voice_id)).map(voiceView), ...held];
};

// ── agents and their conversations ─────────────────────────────────────────────────────────────

/** The unix second of an instant of the World's clock. */
export const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** An agent's conversation signature: a token the World draws from a secret it holds, so no one computes it from the ids
 *  it shows. Where the documentation stops: the token's form is ElevenLabs' own; the twin's is 64 hexadecimal digits. */
export const signatureOf = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>, id: string): Promise<string> =>
  ctx.crypto.digest('sha256', await ctx.secret(`elevenlabs-conversation-signature:${id}`), 'hex');

/** A conversation as GET /v1/convai/conversations/{conversation_id} answers it. */
export const conversationView = (c: Row): Row => ({
  agent_id: c.agent_id, agent_name: c.agent_name ?? null, conversation_product: 'agent', status: c.status, user_id: c.user_id ?? null,
  branch_id: null, version_id: null, metadata: c.metadata ?? {}, analysis: null, visited_agents: [],
  conversation_initiation_client_data: c.conversation_initiation_client_data ?? {}, environment: 'production', conversation_id: c.conversation_id,
  has_audio: c.has_audio ?? false, has_user_audio: c.has_user_audio ?? false, has_response_audio: c.has_response_audio ?? false, has_auxiliary_audio: false,
  transcript: c.transcript ?? [], tag_ids: [],
});

/** A secret locator resolved only from this World's API-created synthetic workspace secrets. */
// source: spec:/components/schemas/CustomLLM "Either a workspace secret reference"
export function workspaceSecret(ctx: HandlerContext, locator: unknown): string | undefined {
  const id = obj(locator).secret_id;
  if (typeof id !== 'string') return undefined;
  const held = ctx.row(WORKSPACE_SECRET, id);
  const stored = ctx.row('_workspace_secret_value', id);
  return held && held.deleted !== true && typeof stored?.value === 'string' ? stored.value : undefined;
}
