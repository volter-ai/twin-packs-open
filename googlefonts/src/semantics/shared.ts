import type { HandlerContext } from '@volter/world-core';
export const FONT = 'webfont', CATALOG = '_font_catalog', CSS = '_stylesheet', FILE = '_font_file', KEY = '_api_key';
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const assetKey = (value: string): string => {
  const url = new URL(value); url.hash = '';
  if (url.hostname !== 'fonts.gstatic.com' || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid font URL');
  url.searchParams.sort(); return url.pathname + url.search;
};
export const cssKey = (ctx: HandlerContext, family: string, subset: string, userAgent: string): string =>
  ctx.crypto.digest('sha256', JSON.stringify([family, subset, userAgent]));
// A CSS2 request is its ordered query pairs; family may repeat, text and display may not.
export const css2Query = (query: URLSearchParams): Array<[string, string]> | undefined => {
  const pairs = [...query.entries()];
  const once = (name: string) => pairs.filter(([k]) => k === name).length <= 1;
  if (!pairs.some(([k, v]) => k === 'family' && v) || pairs.some(([k]) => !['family', 'text', 'display'].includes(k)) ||
      !once('text') || !once('display')) return undefined;
  return pairs;
};
export const css2Key = (ctx: HandlerContext, pairs: Array<[string, string]>, userAgent: string): string =>
  ctx.crypto.digest('sha256', JSON.stringify(['css2', pairs, userAgent]));
export const googleError = (status: number, message: string, kind = status === 403 ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT'): Response =>
  Response.json({ error: { code: status, message, status: kind } }, { status });
export const htmlError = (status: number, message: string): Response =>
  new Response('<!doctype html><title>' + status + '</title><p>' + message.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]!)) + '</p>', { status, headers: { 'content-type': 'text/html; charset=UTF-8' } });
