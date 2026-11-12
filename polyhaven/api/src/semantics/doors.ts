// The World's publishing (architecture, "Doors, screens and the gap"): Poly Haven has no publishing API; its team
// publishes an asset with its files. The door takes the asset as /info shows it, each file's bytes, and a thumbnail,
// and stores the files tree /files answers (each file's url in the ph-assets bucket, its size and md5) and each
// file's bytes for the dl lane (the pack's resource blobs).
import type { HandlerContext } from '@volter/world-core';
import { ASSET, assetView, FILE, FOLDERS, fileUrl, obj, type Row, thumbPath, TYPES } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

/** A file's bytes, given as text or as base64. */
function bytesOf(leaf: Row): Uint8Array | undefined {
  if (typeof leaf.text === 'string') return new TextEncoder().encode(leaf.text);
  if (typeof leaf.base64 === 'string') return Uint8Array.from(atob(leaf.base64), (c) => c.charCodeAt(0));
  return undefined;
}

/** Poly Haven publishes an asset. */
export async function assets(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const id = String(b.id ?? '');
  // an asset's id is its slug (ArmChair_01, abandoned_parking)
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return bad('id must be a slug: letters, digits, _ and -');
  if (ctx.row(ASSET, id)) return bad(`an asset ${id} is published already`, 409);
  if (!Object.hasOwn(TYPES, String(b.type))) return bad('type must be hdris, textures or models');
  const type = TYPES[String(b.type)]!;
  if (typeof b.name !== 'string' || !b.name) return bad('name is required');
  if (!Array.isArray(b.categories) || !b.categories.every((c) => typeof c === 'string')) return bad('categories must be an array of strings');
  const folder = FOLDERS[type]!;

  // the files tree, as /files answers it: group, resolution, format, each file with its includes
  const files: Row[] = [];
  const payloads = new Map<string, Uint8Array>();
  const store = (name: string, bytes: Uint8Array): Row => {
    if (payloads.has(name)) throw new Error('duplicate file name');
    if (name.split('/').some((part) => !part || part === '.' || part === '..') || name.includes('\\') || name.includes('\0')) throw new Error('invalid file name');
    // the bytes are the pack's resource blob (ctx.blobs), by the file's name; the row names it
    payloads.set(name, bytes);
    files.push({ id: name, name, size: bytes.length, _sha1: ctx.crypto.digest('sha1', bytes), md5: ctx.crypto.md5(bytes), _asset: id });
    return { size: bytes.length, url: fileUrl(name), md5: ctx.crypto.md5(bytes) };
  };
  const tree: Row = Object.create(null);
  try {
    for (const [group, resolutions] of Object.entries(obj(b.files))) {
      for (const [resolution, formats] of Object.entries(obj(resolutions))) {
        for (const [format, given] of Object.entries(obj(formats))) {
          if ([group, resolution, format].some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) return bad('reserved file tree key');
          const leaf = obj(given);
          const bytes = bytesOf(leaf);
          if (!bytes) return bad(`files.${group}.${resolution}.${format} needs text or base64`);
          const dir = `${folder}/${format}/${resolution}/${id}`;
          const include: Row = Object.create(null);
          for (const [rel, inc] of Object.entries(obj(leaf.include))) {
            const incBytes = bytesOf(obj(inc));
            if (!incBytes) return bad(`files.${group}.${resolution}.${format}.include.${rel} needs text or base64`);
            include[rel] = store(`${dir}/${rel}`, incBytes);
          }
          const file = store(`${dir}/${typeof leaf.name === 'string' ? leaf.name : `${id}${type === 1 ? `_${group}` : ''}_${resolution}.${format}`}`, bytes);
          ((tree[group] ??= {}) as Row)[resolution] = { ...obj(obj(tree[group])[resolution]), [format]: { ...(Object.keys(include).length ? { include } : {}), ...file } };
        }
      }
    }
  } catch { return bad('files must contain valid base64 and unique relative file names'); }
  const thumb = typeof b.thumbnail === 'string' ? b.thumbnail : undefined;
  const imgVersion = thumb ? ctx.crypto.md5(thumb).slice(0, 8) : undefined;
  let thumbnail: Uint8Array | undefined;
  try { thumbnail = thumb ? Uint8Array.from(atob(thumb), (c) => c.charCodeAt(0)) : undefined; }
  catch { return bad('thumbnail must be valid base64'); }
  // The door validates every payload before publishing any bytes or rows.
  for (const [name, bytes] of payloads) await ctx.blobs.put(name, bytes);
  if (thumbnail) await ctx.blobs.put(thumbPath(id).slice(1), thumbnail);
  for (const f of files) await ctx.record(FILE, f, String(f.id));
  await ctx.write(ASSET, id, {
    // source: spec:/components/schemas/asset "The epoch timestamp in seconds of when this asset was published."
    date_published: typeof b.date_published === 'number' ? b.date_published : Math.floor(Date.parse(ctx.occurredAt) / 1000),
    name: b.name, description: typeof b.description === 'string' ? b.description : '',
    categories: b.categories, tags: Array.isArray(b.tags) ? b.tags : [], authors: obj(b.authors),
    ...(typeof b.category === 'string' ? { category: b.category } : {}),
    // source: spec:/components/schemas/asset "A SHA1 hash of the files object (from the /files endpoint), which will change whenever the files are updated."
    files_hash: ctx.crypto.digest('sha1', JSON.stringify(tree)),
    download_count: 0,
    // source: spec:/components/schemas/asset "It is already appended to thumbnail_url as a `v` parameter"
    ...(imgVersion ? { img_version: imgVersion } : {}),
    thumbnail_url: `https://cdn.polyhaven.com${thumbPath(id)}?width=256&height=256${imgVersion ? `&v=${imgVersion}` : ''}`,
    type, _files: tree, _thumbnail: thumb !== undefined,
  }, 'asset.publish');
  return Response.json({ id, ...assetView(ctx, ctx.row(ASSET, id)!) }, { status: 201 });
}
