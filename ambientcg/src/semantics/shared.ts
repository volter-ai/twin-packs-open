// What ambientCG's two lanes share: the catalog's stored shapes (an asset as /full_json answers it; each file's bytes
// by its name in the ambientCG-Web bucket, zips and thumbnails alike) and where the files live.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
export const ASSET = 'asset';
export const FILE = '_file';

export const BUCKET = 'ambientCG-Web';
export const DOWNLOAD_HOST = 'https://acg-download.struffelproductions.com';
export const MEDIA_HOST = 'https://acg-media.struffelproductions.com';
export const fileUrl = (host: string, name: string): string => `${host}/file/${BUCKET}/${name}`;

// source: https://docs.ambientcg.com/api/v2/full_json/ "3DModel Atlas Brush Decal HDRI Material PlainTexture Substance Terrain"
export const DATA_TYPES = ['3DModel', 'Atlas', 'Brush', 'Decal', 'HDRI', 'Material', 'PlainTexture', 'Substance', 'Terrain'];

export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

export const listOf = (v: string | null, split: RegExp): string[] => (v ? v.split(split).map((s) => s.trim()).filter(Boolean) : []);
// source: https://docs.ambientcg.com/api/v2/full_json/ "Latest Popular Alphabet Downloads"
export const ORDERS: Record<string, (a: Row, b: Row) => number> = {
  Latest: (a, b) => String(b.releaseDate).localeCompare(String(a.releaseDate)),
  Popular: (a, b) => Number(b.popularityScore) - Number(a.popularityScore),
  Alphabet: (a, b) => String(a.assetId).localeCompare(String(b.assetId)),
  Downloads: (a, b) => Number(b.downloadCount) - Number(a.downloadCount),
};
