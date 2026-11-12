// What Poly Haven's two lanes share: the catalog's stored shapes (an asset as /info answers it, its files tree beside
// it; each file's bytes by its name in the ph-assets bucket), the asset types, and where files and thumbnails live.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
export const ASSET = 'asset';
export const FILE = '_file';

// source: spec:/components/schemas/asset "The asset type. HDRIs = 0, textures = 1, models =2."
export const TYPES: Record<string, number> = { hdris: 0, textures: 1, models: 2 };
/** The bucket's top folder for a type, as the files' urls name it (`Models/gltf/1k/ArmChair_01/…`). */
export const FOLDERS = ['HDRIs', 'Textures', 'Models'];

export const BUCKET = 'ph-assets';
export const fileUrl = (name: string): string => `https://dl.polyhaven.org/file/${BUCKET}/${name}`;
export const thumbPath = (id: string): string => `/asset_img/thumbs/${id}.png`;

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

/** An error as api.polyhaven.com answers one: its text, as an HTML page's body. */
export const phText = (status: number, message: string): Response =>
  new Response(message, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** The published assets, in the order they were published. */
export const assets = (ctx: Pick<HandlerContext, 'rowsRaw'>): Row[] => ctx.rowsRaw(ASSET).filter((a) => a.deleted !== true);

/** An asset as /assets and /info answer it: its own fields (`ctx.own`: its `type` is its own, not the kernel's), never
 *  what the World keeps beside it. */
export const assetView = (ctx: Pick<HandlerContext, 'own'>, a: Row): Row =>
  Object.fromEntries(Object.entries(ctx.own(a)).filter(([k]) => !k.startsWith('_') && k !== 'id'));

/** An asset's type (0, 1 or 2), its own field. */
export const typeOf = (ctx: Pick<HandlerContext, 'own'>, a: Row): unknown => ctx.own(a).type;

/** A type named by a request: one of the three, `all`, or Poly Haven's 400. */
export function requestedType(v: string | null): number | 'all' | Response {
  if (v === null || v === 'all') return 'all';
  if (Object.hasOwn(TYPES, v)) return TYPES[v]!;
  // source: spec:get_assets "Bad request, e.g. unsupported asset type or unknown category"
  // Where the documentation stops: the words are the ones api.polyhaven.com answers (read 2026-09-30)
  return phText(400, `Unsupported asset type: ${v}.\n      Must be: hdris/textures/models/all`);
}

/** The comma list of categories a request names, if any. */
export const listed = (v: string | null): string[] => (v ? v.split(',').map((c) => c.trim()).filter(Boolean) : []);
export const inAll = (a: Row, wanted: string[]): boolean => wanted.every((c) => (a.categories as string[] | undefined ?? []).includes(c));

