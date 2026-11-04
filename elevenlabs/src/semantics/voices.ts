// Voices (v2): the account's voices, searched, filtered by category and paged.
import type { HandlerContext } from '@volter/world-core';
import { invalid, VOICE, voicesOf, voiceView } from './shared.ts';

// source: spec:get_user_voices_v2 "Gets a list of all available voices for a user with search, filtering and pagination."
export async function get_user_voices_v2(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const size = Math.min(100, Math.max(1, Number(q.get('page_size') ?? 10) || 10));
  const start = Number(q.get('next_page_token') ?? 0) || 0;
  const search = (q.get('search') ?? '').toLowerCase();
  const category = q.get('category');
  const all = voicesOf(ctx).filter((v) => (!category || v.category === category) && (!search || `${String(v.name)} ${String(v.description ?? '')} ${String(v.category ?? '')} ${JSON.stringify(v.labels ?? {})}`.toLowerCase().includes(search)));
  const page = all.slice(start, start + size);
  const more = start + size < all.length;
  return Response.json({ voices: page, has_more: more, total_count: all.length, next_page_token: more ? String(start + size) : null });
}

// A voice the account clones from samples (Instant Voice Cloning): how a World adds a voice an application names (the
// seeding rule: through the vendor's API).
// The twin trains nothing; the voice speaks the same labeled silence as every other. Samples arrive as multipart
// file parts, as the vendor specifies, and their bytes stay in the World's resource blobs.
// source: spec:add_voice "Add a new voice to your collection of voices in VoiceLab."
export async function add_voice(ctx: HandlerContext): Promise<Response> {
  const p = ctx.params as Record<string, unknown>;
  // source: spec:/components/schemas/Body_Add_voice_v1_voices_add_post "A list of file paths to audio recordings intended for voice cloning."
  const files = (await ctx.parts()).filter((part) => part.name === 'files' && part.filename !== null && part.body.byteLength > 0);
  const missing = [typeof p.name === 'string' && p.name ? undefined : 'name', files.length ? undefined : 'files'].filter(Boolean);
  if (missing.length) return invalid(missing.map((f) => ({ type: 'missing', loc: ['body', String(f)], msg: 'Field required' })));
  let labels: unknown = p.labels;
  if (typeof labels === 'string') { try { labels = JSON.parse(labels); } catch { labels = {}; } }
  const id = ctx.mint(VOICE);
  for (const [index, file] of files.entries()) await ctx.blobs.put(`voices/${id}/samples/${index}`, file.body);
  // the voice as the API answers it
  await ctx.write(VOICE, id, { ...voiceView({ voice_id: id, name: p.name, category: 'cloned', description: typeof p.description === 'string' ? p.description : null, labels: labels && typeof labels === 'object' ? labels : {}, created_at: ctx.occurredAt, preview_url: null }), _sample_blobs: files.map((_, index) => `voices/${id}/samples/${index}`) }, 'voice.add');
  return Response.json({ voice_id: id, requires_verification: false });
}
