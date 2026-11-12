// The World's publishing (architecture, "Doors, screens and the gap"): ambientCG has no publishing API; it publishes
// an asset with its zips and its thumbnail. The door takes the asset's facts, each zip's bytes by its attribute
// (1K-JPG) and a PNG thumbnail, stores each file in the bucket under the name the hosts serve, and the asset as
// /full_json lists it.
import type { HandlerContext } from '@volter/world-core';
import { ASSET, DATA_TYPES, FILE, fileUrl, MEDIA_HOST, obj, type Row } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });
const bytesOf = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** ambientCG publishes an asset. */
export async function assets(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const id = String(b.assetId ?? '');
  if (!/^[A-Za-z0-9]+$/.test(id)) return bad('assetId must be letters and digits (Wood096)');
  if (ctx.row(ASSET, id)) return bad(`an asset ${id} is published already`, 409);
  if (!DATA_TYPES.includes(String(b.dataType))) return bad(`dataType must be one of ${DATA_TYPES.join(', ')}`);
  if (typeof b.displayName !== 'string' || !b.displayName) return bad('displayName is required');
  const downloads = Array.isArray(b.downloads) ? b.downloads.map(obj) : [];
  if (downloads.some((d) => typeof d.attribute !== 'string' || typeof d.base64 !== 'string')) return bad('each download needs an attribute and base64');

  // Where the documentation stops: the download host's folder is the asset's id and a token (Wood096_0WgvcsZ3); the
  // twin's opaque path component is minted by the World
  const token = ctx.mint('_file');
  const put = async (name: string, bytes: Uint8Array, contentType: string): Promise<void> => {
    // the bytes are the pack's resource blob (ctx.blobs), by the file's name; the row names it
    await ctx.blobs.put(name, bytes);
    await ctx.record(FILE, { name, contentType, _sha1: ctx.crypto.digest('sha1', bytes), _fileId: ctx.mint('_file'), _uploadTimestamp: String(Date.parse(ctx.occurredAt)) }, name);
  };
  const entries: Row[] = [];
  for (const d of downloads) {
    const fileName = `${id}_${String(d.attribute)}.zip`;
    const bytes = bytesOf(String(d.base64));
    await put(`download/${id}_${token}/${fileName}`, bytes, 'application/zip');
    const link = `https://ambientcg.com/get?file=${fileName}`;
    entries.push({ fullDownloadPath: link, downloadLink: link, fileName, size: bytes.length, filetype: 'zip', attribute: d.attribute, zipContent: [] });
  }
  const previewImage: Row = {};
  if (typeof b.thumbnail === 'string') {
    const name = `media/thumbnail/256-PNG/${id}.png`;
    await put(name, bytesOf(b.thumbnail), 'image/png');
    previewImage['256-PNG'] = fileUrl(MEDIA_HOST, name);
  }
  await ctx.write(ASSET, id, {
    assetId: id,
    releaseDate: typeof b.releaseDate === 'string' ? b.releaseDate : ctx.occurredAt.slice(0, 19).replace('T', ' '),
    dataType: b.dataType, creationMethod: typeof b.creationMethod === 'string' ? b.creationMethod : 'UnknownOrOther', category: null,
    downloadCount: typeof b.downloadCount === 'number' ? b.downloadCount : 0,
    popularityScore: typeof b.popularityScore === 'number' ? b.popularityScore : 0,
    tags: Array.isArray(b.tags) ? b.tags : [], displayName: b.displayName,
    displayCategory: typeof b.displayCategory === 'string' ? b.displayCategory : '', shortLink: `https://ambientcg.com/a/${id}`,
    downloadFolders: { default: { title: 'default', downloadFiletypeCategories: { zip: { title: 'zip', downloads: entries } } } },
    previewImage,
  }, 'assets');
  return Response.json(ctx.own(ctx.row(ASSET, id)!), { status: 201 });
}
