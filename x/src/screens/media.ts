// X's content hosts (docs/contributing/architecture.md, "Screens": a content screen), answered from what the World
// stores: an uploaded image's and video's bytes, by their digest, at pbs.twimg.com and video.twimg.com, where every API
// media `url` and x.com's pages load them from; a video's poster frame; and abs.twimg.com's default profile image, which
// every photo-less account's `profile_image_url` names and an app fetches (at channel connect).
import { bytesResponse, type HandlerContext } from '@volter/world-core';
import { readMediaRecord, readXBlob, UPLOAD, videoPosterSvg, X_ABS_PATHS } from '../semantics/shared.ts';

const MEDIA_BYTES_PATH = /^\/media\/([0-9a-f]{64})\.(jpg|png|gif|webp)$/;
const VIDEO_BYTES_PATH = /^\/ext_tw_video\/\d{1,19}\/pu\/vid\/avc1\/\d+x\d+\/([0-9a-f]{64})\.mp4$/;
const VIDEO_THUMB_PATH = /^\/ext_tw_video_thumb\/(\d{1,19})\/pu\/img\/[0-9a-f]{64}\.svg$/;
const notFound = (): Response => new Response('Not Found', { status: 404 });

/** The uploaded bytes and posters, and abs.twimg.com's default avatar; X's 404 for anything else there. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
  const url = new URL(request.url);
  const bytes = MEDIA_BYTES_PATH.exec(url.pathname) ?? VIDEO_BYTES_PATH.exec(url.pathname);
  if (bytes) {
    const digest = bytes[1]!;
    const stored = await readXBlob(ctx.blobs, digest);
    const type = ctx.rowsRaw(UPLOAD, { withDeleted: true }).find((r) => r.sha256 === digest)?.media_type as string | undefined;
    return stored && type ? bytesResponse(request, stored, type) : notFound();
  }
  const avatar = defaultProfileImageResponse(request.method, url.pathname);
  if (avatar) return avatar;
  const thumb = VIDEO_THUMB_PATH.exec(url.pathname);
  return thumb ? poster(ctx, request, thumb[1]!) : unclaimed();
}

/** A video's poster frame on pbs.twimg.com, by its media id. */
function poster(ctx: HandlerContext, request: Request, id: string): Response {
  const record = readMediaRecord(ctx, id);
  if (!record?.sha256) return notFound();
  return new Response(request.method === 'HEAD' ? null : videoPosterSvg(record.width ?? 0, record.height ?? 0), { headers: { 'content-type': 'image/svg+xml', 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=604800' } });
}

/** A path of X's content hosts the descriptor does not route to this screen (its hosts' patterns are exactly the paths
 *  above): X's 404, should a router ever hand one over. */
function unclaimed(): Response {
  return notFound();
}

// ── abs.twimg.com's default profile image ──────────────────────────────────────────────────────
// X's default profile image, served where X serves it: abs.twimg.com/sticky/default_profile_images/.
//
// Every account without a photo answers `profile_image_url` with X's default
// (`X_DEFAULT_PROFILE_IMAGE_URL`, the `_normal` variant), and an app fetches it: it reads the
// avatar at channel connect and stores it. So the twin answers that URL and the three other sizes
// X names the same way, with a PNG it draws itself — no vendor fetch, the same bytes every time.
//
// What X serves there (observed 2026-09-28, `curl -s -o f.png -w '%{http_code} %{content_type}'
// https://abs.twimg.com/sticky/default_profile_images/default_profile_<v>.png` and `file f.png`):
// `_normal` 48×48, `_bigger` 73×73, `_200x200` 200×200, `_400x400` 400×400, each `image/png`, an
// 8-bit colormap PNG of a #657786 head and shoulders on #ccd6dd. X also serves `_mini` (24×24) and a
// bare `default_profile.png` (500×500); those are not claimed (x.web.default_profile_other_variants).
//
// The drawing is the twin's: two palette entries, no anti-aliasing, the silhouette's geometry read
// off the 400×400 rendition (a head spanning 124–276 × 88–256 and, apart from it, shoulders that are a
// circle centred at 200,409 with radius 131, in 400-unit space) and scaled to each size. It is X's
// shape and colours, not X's bytes.

const ABS_PATH = new RegExp(X_ABS_PATHS);

/** Each variant's edge in pixels, as X serves it. */
const X_DEFAULT_PROFILE_IMAGE_SIZES: Readonly<Record<string, number>> = { normal: 48, bigger: 73, '200x200': 200, '400x400': 400 };

const BACKGROUND = [0xcc, 0xd6, 0xdd] as const;
const SILHOUETTE = [0x65, 0x77, 0x86] as const;

/** Whether a point in X's 400-unit drawing space is on the silhouette. */
function onSilhouette(u: number, v: number): boolean {
  const head = ((u - 200) / 76) ** 2 + ((v - 172) / 84) ** 2 <= 1;
  const shoulders = (u - 200) ** 2 + (v - 409) ** 2 <= 131 ** 2;
  return head || shoulders;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A zlib stream of stored (uncompressed) deflate blocks: no compressor, so no zlib dependency on
 *  the serve path and nothing that could vary between runtimes. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  for (let at = 0; ; at += 65535) {
    const part = raw.subarray(at, Math.min(raw.length, at + 65535));
    const last = at + 65535 >= raw.length ? 1 : 0;
    parts.push(new Uint8Array([last, part.length & 0xff, part.length >> 8, ~part.length & 0xff, (~part.length >> 8) & 0xff]), part);
    if (last) break;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  new DataView(adler.buffer).setUint32(0, ((b << 16) | a) >>> 0);
  parts.push(adler);
  return concat(parts);
}

/** X's default silhouette as a size×size two-colour palette PNG. Pure and deterministic. */
function defaultProfilePng(size: number): Uint8Array {
  const row = 1 + size;
  const raw = new Uint8Array(row * size); // filter byte 0 (None) per row, then one palette index per pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (onSilhouette(((x + 0.5) * 400) / size, ((y + 0.5) * 400) / size)) raw[y * row + 1 + x] = 1;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8-bit, colour type 3 (palette), as X's own file is
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', new Uint8Array([...BACKGROUND, ...SILHOUETTE])),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

const cache = new Map<number, Uint8Array>(); // cache: each size's PNG, drawn once (the same bytes every time)

/** The default profile image a GET/HEAD to one of the four paths names; null for any other path. */
function defaultProfileImageResponse(method: string, pathname: string): Response | null {
  if ((method !== 'GET' && method !== 'HEAD') || !ABS_PATH.test(pathname)) return null;
  const variant = /\/default_profile_([^./]+)\.png$/.exec(pathname)![1]!;
  const size = X_DEFAULT_PROFILE_IMAGE_SIZES[variant]!;
  let png = cache.get(size);
  if (!png) {
    png = defaultProfilePng(size);
    cache.set(size, png);
  }
  return new Response(method === 'HEAD' ? null : (png.buffer as ArrayBuffer), {
    headers: { 'content-type': 'image/png', 'content-length': String(png.length), 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=604800' },
  });
}
