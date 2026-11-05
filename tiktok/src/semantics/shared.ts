// What TikTok's lanes share (a lane imports its vendor's shared helpers): the developer sites' apps, TikTok's people,
// the codes and tokens an app holds for a person (each kept by its SHA-256, drawn from ctx.secret), posts and videos,
// and the World's numbering and placeholder images.
import { placeholderPng, type HandlerContext, type StateField } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const APP = '_app';
export const PERSON = '_person';
export const CODE = '_code';
export const ACCESS = '_access_token';
export const REFRESH = '_refresh_token';
export const PUBLISH = 'publish';
export const VIDEO = 'video';
export const CHUNK = '_chunk';

export const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');
export const seconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
export const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
export const bodyOf = (ctx: Pick<HandlerContext, 'body'>): Row => obj(ctx.body);

// ── apps and people ────────────────────────────────────────────────────────────────────────────

/** An app's client secret, drawn from the World's secret under its id. */
export async function clientSecret(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, app: Row): Promise<string | undefined> {
  if (app.deleted === true || app._secret_pending === true) return undefined;
  const value = ctx.crypto.digest('sha256', await ctx.secret(String(app._secret_label ?? `tiktok-client-secret:${String(app.id)}`)), 'hex').slice(0, 32);
  return app._secret_sha256 === undefined || app._secret_sha256 === ctx.crypto.sha256(value) ? value : undefined;
}
export const appByKey = (ctx: Pick<HandlerContext, 'rowsRaw'>, key: unknown): Row | undefined => ctx.rowsRaw(APP).find((a) => a.deleted !== true && a.client_key === key);

/** A person's id in an app ("The unique identification of the user in the current application"), and across the
 *  developer's apps (union_id): derived from the ids they name, both public. */
// source: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info "The unique identification of the user in the current application."
export const openIdOf = (ctx: Pick<HandlerContext, 'crypto'>, app: Row, person: Row): string => ctx.crypto.uuidFrom(`tiktok-open-id:${String(app.id)}:${String(person.id)}`);
export const unionIdOf = (ctx: Pick<HandlerContext, 'crypto'>, person: Row): string => ctx.crypto.uuidFrom(`tiktok-union-id:${String(person.id)}`);

/** A placeholder image the World's CDN serves (a person's avatar, a video's cover): the kernel's placeholder PNG. */
export const mediaUrl = (ctx: Pick<HandlerContext, 'publicBase'>, name: string): string => `${ctx.publicBase.replace(/\/$/, '')}/_twin/media/${name}.png`;
export const mediaBytes = (name: string): Uint8Array => placeholderPng({ width: 720, height: 1280 }, `tiktok:${name}`, `placeholder image from the TikTok twin: ${name}`);

// ── tokens ─────────────────────────────────────────────────────────────────────────────────────
// source: https://developers.tiktok.com/doc/oauth-user-access-token-management "It is valid for 24 hours after initial issuance."
export const ACCESS_TTL = 86400;
// source: https://developers.tiktok.com/doc/oauth-user-access-token-management "It is valid for 365 days after the initial issuance."
export const REFRESH_TTL = 31536000;

/** A credential of TikTok's form (`act.…`, `rft.…`), drawn from the World's secret under its minted id. */
export async function credential(ctx: HandlerContext, type: string, prefix: string, fields: Row): Promise<{ id: string; value: string }> {
  const id = ctx.mint(type);
  const value = `${prefix}.${(await ctx.secret(`tiktok:${type}:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 36)}!${(await ctx.secret(`tiktok:${type}:${id}:n`)).replace(/\D/g, '').padEnd(4, '0').slice(0, 4)}`;
  await ctx.record(type, { ...fields, sha256: sha256(ctx, value), created: ctx.occurredAt }, id);
  return { id, value };
}
export const bySha = (ctx: Pick<HandlerContext, 'rowsRaw' | 'crypto'>, type: string, value: string): Row | undefined =>
  ctx.rowsRaw(type).find((r) => r.deleted !== true && r.sha256 === sha256(ctx, value));

/** The World's next number in a sequence (an id's number, a nonce): issued from the tree over the declared
 *  `_seq_<what>` (ctx.issue), never a row count. */
export const next = async (ctx: Pick<HandlerContext, 'issue'>, what: 'publish' | 'video'): Promise<number> => Number(await ctx.issue(`_seq_${what}`));

/** A video's moment, the position its creator's list pages by: the World's clock in milliseconds, one past the creator's
 *  latest video's when the clock has not moved past it, so two videos never share a cursor. From the subject's history,
 *  never an accumulator. */
export const videoMoment = (ctx: Pick<HandlerContext, 'rowsRaw' | 'occurredAt'>, person: string): number =>
  Math.max(Date.parse(ctx.occurredAt), ...ctx.rowsRaw(VIDEO).filter((v) => v._person === person).map((v) => Number(v._moment) + 1));

/** A creator's public videos newest first, the page before a cursor (a moment; none is the newest), and the cursor
 *  the page answers (its last video's moment). */
export function videoPage(ctx: Pick<HandlerContext, 'rowsRaw'>, person: string, cursor: number, max: number): { page: Row[]; cursor: number; more: boolean } {
  const mine = ctx.rowsRaw(VIDEO).filter((v) => v.deleted !== true && v._person === person && v._public === true && Number(v._moment) < cursor)
    .sort((a, z) => Number(z._moment) - Number(a._moment));
  const page = mine.slice(0, max);
  return { page, cursor: page.length ? Number(page.at(-1)!._moment) : 0, more: mine.length > max };
}

/** The privacy levels a creator may post at: "If the TikTok creator account is public, the available options are:
 *  PUBLIC_TO_EVERYONE MUTUAL_FOLLOW_FRIENDS SELF_ONLY"; a private one's, FOLLOWER_OF_CREATOR in place of the first. */
// source: https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info "If the TikTok creator account is public, the available options are:"
export const privacyOptions = (p: Row): string[] => (p.private === true ? ['FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] : ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']);

const STATUS = 'https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status';

/** A post's `status`: an upload begins PROCESSING_UPLOAD ("Indicates that the upload is in process"), a pull from URL
 *  PROCESSING_DOWNLOAD (written so at the post's start); the vendor finishes it when the last chunk arrives or the pull
 *  ends. Not made by the twin: a post the creator makes from an inbox draft (PUBLISH_COMPLETE after SEND_TO_USER_INBOX,
 *  the creator's move in the app), a moderation that fails a post, and a cancelled pull (the cancel is unmodeled). */
const publishStatus: StateField = {
  initial: 'PROCESSING_UPLOAD',
  transitions: [
    { actor: 'vendor', from: ['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD'], to: 'PUBLISH_COMPLETE', source: `${STATUS} "it indicates that the content has been posted"` },
    { actor: 'vendor', from: ['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD'], to: 'SEND_TO_USER_INBOX', source: `${STATUS} "Indicates that a notification has been sent to creator's inbox to complete the draft post using TikTok's editing flow."` },
    { actor: 'vendor', from: ['PROCESSING_DOWNLOAD'], to: 'FAILED', source: `${STATUS} "Indicates that an error has occurred and the entire process has failed."` },
  ],
};

export const publish = { state: { status: publishStatus }, notState: ['fail_reason', 'reason'] };
