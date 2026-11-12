// What every family of twenty-icons shares: the vendor's domain and size rules, its stored favicons, and its answers.
import { placeholderPng, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

/** A domain the World declared known, keyed by its name: the largest size the vendor would hold for it, and when it was
 *  declared (the vendor's Last-Modified for a stored favicon). */
export const ICON = '_icon';

// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.constants.ts "export const SUPPORTED_SIZES = [16, 32, 64, 128, 180, 192];"
export const SUPPORTED_SIZES = [16, 32, 64, 128, 180, 192];
// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.constants.ts "export const DEFAULT_SIZE = '192';"
export const DEFAULT_SIZE = 192;

// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/utils/domain.ts "/^((?!-))(xn--)?[a-z0-9][a-z0-9-_]{0,61}[a-z0-9]{0,1}\.(xn--)?([a-z0-9\-]{1,61}|[a-z0-9-]{1,30}\.[a-z]{2,})$/;"
const DOMAIN = /^((?!-))(xn--)?[a-z0-9][a-z0-9-_]{0,61}[a-z0-9]{0,1}\.(xn--)?([a-z0-9\-]{1,61}|[a-z0-9-]{1,30}\.[a-z]{2,})$/;
export const validDomain = (name: string): boolean => DOMAIN.test(name);

/** Express's weak ETag of a body it sends (its default `etag` setting): the byte length in hex and the first 27
 *  characters of the body's SHA-1 in base64, which the host's 404 and 400 answers carry (spec/SOURCE.md, Answers). */
export const expressEtag = (ctx: HandlerContext, body: string): string =>
  `W/"${new TextEncoder().encode(body).length.toString(16)}-${ctx.crypto.digest('sha1', body, 'base64').slice(0, 27)}"`;

/** The service's text answer through Express's `res.send` of a string: text/html, its length and its weak ETag. */
export const text = (ctx: HandlerContext, status: number, body: string, extra: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', etag: expressEtag(ctx, body), ...extra } });

/** The favicon of a known domain at a size: a flat PNG drawn from the domain's name, never the site's logo. */
export const faviconPng = (domain: string, size: number): Uint8Array =>
  placeholderPng({ width: size, height: size }, `twenty-icons:${domain}`, `twenty-icons twin favicon of ${domain}, not the site's logo`);

/** Cloudflare's edge Cache-Control, which the host's 200s, its 301 and its 404 carry and its 400 does not
 *  (`cf-cache-status: BYPASS`; spec/SOURCE.md, Answers): the service's own source sets none. */
export const EDGE_CACHE = { 'cache-control': 'max-age=16070400' } as const;

/** An HTTP date (RFC 9110 IMF-fixdate), as Last-Modified carries it. */
export const httpDate = (iso: string): string => new Date(iso).toUTCString();
