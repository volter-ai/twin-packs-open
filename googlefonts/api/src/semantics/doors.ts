// Google supplies catalog records and keys outside the read-only Fonts API.
import type { HandlerContext } from '@volter/world-core';
import { FONT, CATALOG, CSS, FILE, KEY, object, assetKey, cssKey, css2Key, css2Query, googleError } from './shared.ts';

// source: https://developers.google.com/fonts/docs/developer_api
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const project = await ctx.tenant('_project', async organization =>
    String((await ctx.create('_project', { name: organization.label, owner: organization.members[0] }, 'project.create')).id));
  const value = async (id: string): Promise<string> => 'AIza' + (await ctx.secret(`googlefonts:application-api-key:${id}`)).slice(0, 35);
  const key = await ctx.accountKey('api-key', KEY, {
    make: async () => {
      const row = await ctx.create(KEY, { _project: project.id, name: ctx.deployment() || 'world' }, 'api_key.create');
      const id = String(row.id), secret = await value(id);
      await ctx.record(KEY, { sha256: ctx.crypto.digest('sha256', secret) }, id);
      return id;
    },
    read: async row => {
      if (row._project !== project.id) return undefined;
      const secret = await value(String(row.id));
      return row.sha256 === ctx.crypto.digest('sha256', secret) ? secret : undefined;
    },
  });
  return Response.json({ api_key: key.secret });
}

// source: https://developers.google.com/fonts/docs/developer_api
export async function publishCatalog(ctx: HandlerContext): Promise<Response> {
  // There is no Developer API create-font operation. This explicit publisher
  // door imports real vendor-shaped objects and their representations.
  const input = object(ctx.body), catalog = object(input.catalog);
  const fonts = Array.isArray(catalog.items) ? catalog.items.map(object) : [];
  const sheets = Array.isArray(input.stylesheets) ? input.stylesheets.map(object) : [];
  const files = Array.isArray(input.assets) ? input.assets.map(object) : [];
  // CSS2 serves Google's whole library by its query, not only the Developer API items published here.
  const sheets2 = Array.isArray(input.stylesheets2) ? input.stylesheets2.map(object) : [];
  if (catalog.kind !== 'webfonts#webfontList' || fonts.length === 0)
    return googleError(400, 'A webfonts#webfontList catalog is required');
  const names = new Set<string>();
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 &&
    value.every(v => typeof v === 'string' && v.length > 0) && new Set(value).size === value.length;
  const decoded = new Map<string, { url: string; contentType: string; bytes: Uint8Array; hash: string }>();
  try {
    for (const file of files) {
      if (typeof file.url !== 'string' || typeof file.contentType !== 'string' ||
          !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;[^\r\n]*)?$/.test(file.contentType) ||
          typeof file.base64 !== 'string' || !file.base64 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
        throw new Error('Each asset needs its gstatic URL, Content-Type and complete base64 bytes');
      const key = assetKey(file.url);
      if (!/^\/s\/[^?]+$|^\/l\/font\?/.test(key) || decoded.has(key)) throw new Error('Invalid or duplicate asset URL');
      const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      if (bytes.length === 0) throw new Error('Font bytes must not be empty');
      decoded.set(key, { url: file.url, contentType: file.contentType, bytes, hash: ctx.crypto.digest('sha256', bytes) });
    }
    for (const font of fonts) {
      if (typeof font.family !== 'string' || !font.family || names.has(font.family) ||
          font.kind !== 'webfonts#webfont' || !strings(font.variants) || !strings(font.subsets) ||
          typeof font.category !== 'string' || typeof font.version !== 'string' ||
          typeof font.lastModified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(font.lastModified))
        throw new Error('Invalid or duplicate vendor font item');
      names.add(font.family);
      const fileMap = object(font.files);
      for (const variant of font.variants) {
        if (typeof fileMap[variant] !== 'string' || !decoded.has(assetKey(fileMap[variant] as string)))
          throw new Error('Every advertised variant file must have a genuine supplied blob');
      }
      if (font.menu !== undefined && (typeof font.menu !== 'string' || !decoded.has(assetKey(font.menu))))
        throw new Error('An advertised menu URL must have a supplied blob');
    }
    const representations = new Set<string>();
    for (const sheet of sheets) {
      if (typeof sheet.family !== 'string' || typeof sheet.subset !== 'string' ||
          typeof sheet.userAgent !== 'string' || !sheet.userAgent || typeof sheet.css !== 'string' ||
          !sheet.css.includes('@font-face')) throw new Error('Invalid stylesheet representation');
      const split = sheet.family.lastIndexOf(':');
      const family = split < 0 ? sheet.family : sheet.family.slice(0, split);
      const variant = split < 0 ? 'regular' : sheet.family.slice(split + 1);
      const font = fonts.find(f => f.family === family);
      if (!font || !(font.variants as string[]).includes(variant) ||
          sheet.subset.split(',').some(s => !(font.subsets as string[]).includes(s)))
        throw new Error('Stylesheet request must name a published font, variant and subset');
      const key = cssKey(ctx, sheet.family, sheet.subset, sheet.userAgent);
      if (representations.has(key)) throw new Error('Duplicate stylesheet request');
      representations.add(key);
      const urls = [...sheet.css.matchAll(/url\((https?:\/\/[^)]+)\)/g)].map(m => m[1]!);
      if (urls.length === 0 || urls.some(url => !decoded.has(assetKey(url))))
        throw new Error('Every stylesheet src URL must have a supplied blob');
    }
    for (const sheet of sheets2) {
      const pairs = typeof sheet.query === 'string' ? css2Query(new URLSearchParams(sheet.query)) : undefined;
      if (!pairs || typeof sheet.userAgent !== 'string' || typeof sheet.css !== 'string' || !sheet.css.includes('@font-face'))
        throw new Error('Invalid CSS2 stylesheet representation');
      const key = css2Key(ctx, pairs, sheet.userAgent);
      if (representations.has(key)) throw new Error('Duplicate stylesheet request');
      representations.add(key);
      const urls = [...sheet.css.matchAll(/url\((https?:\/\/[^)]+)\)/g)].map(m => m[1]!);
      if (urls.length === 0 || urls.some(url => !decoded.has(assetKey(url))))
        throw new Error('Every stylesheet src URL must have a supplied blob');
    }
    // A content-addressed font URL keeps its bytes across publications.
    for (const [key, file] of decoded) {
      const prior = ctx.row(FILE, key);
      if (prior && prior.sha256 !== file.hash) return googleError(409, 'Published font URL already names other bytes', 'ALREADY_EXISTS');
    }
  } catch (cause) { return googleError(400, cause instanceof Error ? cause.message : 'Invalid catalog publication'); }
  const fingerprint = ctx.crypto.digest('sha256', JSON.stringify(input));
  if (ctx.row(CATALOG, 'published')?.fingerprint === fingerprint) return Response.json({ families: [...names] });
  // Validation precedes all writes. Publish the catalog pointer last: readers
  // select only this generation's metadata and stylesheet records.
  for (const [key, file] of decoded) {
    const blob = 'font-' + file.hash;
    await ctx.blobs.put(blob, file.bytes);
    await ctx.record(FILE, { url: file.url, contentType: file.contentType, sha256: file.hash, blob }, key);
  }
  // A font item is the vendor's resource, not bookkeeping: written as the publication that made it.
  for (const font of fonts) await ctx.write(FONT, fingerprint + ':' + font.family, font, 'webfont.publish');
  for (const sheet of sheets) {
    const key = cssKey(ctx, sheet.family as string, sheet.subset as string, sheet.userAgent as string);
    const blob = 'css-' + ctx.crypto.digest('sha256', sheet.css as string);
    await ctx.blobs.put(blob, new TextEncoder().encode(sheet.css as string));
    await ctx.record(CSS, { family: sheet.family, subset: sheet.subset, userAgent: sheet.userAgent, blob }, fingerprint + ':' + key);
  }
  for (const sheet of sheets2) {
    const key = css2Key(ctx, css2Query(new URLSearchParams(sheet.query as string))!, sheet.userAgent as string);
    const blob = 'css-' + ctx.crypto.digest('sha256', sheet.css as string);
    await ctx.blobs.put(blob, new TextEncoder().encode(sheet.css as string));
    await ctx.record(CSS, { query: sheet.query, userAgent: sheet.userAgent, blob }, fingerprint + ':' + key);
  }
  await ctx.record(CATALOG, { families: [...names], fingerprint }, 'published');
  return Response.json({ families: [...names] }, { status: 201 });
}
