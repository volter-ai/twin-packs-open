// Slack's wire as its methods share it: a message's timestamp, cursor pagination, a channel's name rules, a mention's
// markup and a token's kind. Pure computation; the handlers hand it what they read.

type Row = Record<string, unknown>;

/** The World's initial workspace. */
export const HOME_TEAM = 'T0VOLTER01';

/** A message's `ts`: its second and a six-digit sequence within it ("seconds since epoch.microseconds", unique per
 *  channel, https://docs.slack.dev/messaging/retrieving-messages#individual_messages). The twin counts the messages
 *  of its channel already in that second. */
export const tsAt = (seconds: number, seq: number): string => `${seconds}.${String(seq).padStart(6, '0')}`;

/** Epoch seconds of an instant. */
export const epochOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000) || 0;

// ── cursor pagination (https://docs.slack.dev/apis/web-api/pagination) ─────────────────────────────

const encode = (offset: number): string => btoa(`next_offset:${offset}`);
const decode = (cursor: unknown): number => {
  if (typeof cursor !== 'string' || !cursor) return 0;
  try { const m = /^next_offset:(\d+)$/.exec(atob(cursor)); return m ? Number(m[1]) : -1; } catch { return -1; }
};

/** A page of items and its `response_metadata.next_cursor` ('' on the last page); undefined for a cursor Slack would
 *  refuse ("invalid_cursor"). `limit` "The maximum number of items to return", Slack's default and ceiling as given. */
export function page<T>(items: T[], args: Row, fallback = 100, ceiling = 1000): { items: T[]; next: string } | undefined {
  const offset = decode(args.cursor);
  if (offset < 0) return undefined;
  const asked = Number(args.limit);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(asked, ceiling) : fallback;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, next: offset + limit < items.length ? encode(offset + limit) : '' };
}

// ── channel names (https://docs.slack.dev/reference/methods/conversations.create, `name`) ──────────────────

/** Why a channel name is refused, or undefined: "Channel names may only contain lowercase letters, numbers, hyphens,
 *  and underscores, and must be 80 characters or less" (conversations.create's `name`); its Errors name each case. */
export function nameRefusal(name: string): string | undefined {
  if (!name) return 'invalid_name_required';
  if (name.length > 80) return 'invalid_name_maxlength';
  if (/[.,;:!?'"()]/.test(name)) return 'invalid_name_punctuation';
  if (!/^[a-z0-9_\-À-￿]+$/.test(name)) return 'invalid_name_specials';
  return undefined;
}

// ── tokens (https://docs.slack.dev/authentication/tokens) ──────────────────────────────────────────

/** A token's kind by its prefix: bot (`xoxb-`), user (`xoxp-`), app-level (`xapp-`), an app configuration token
 *  (`xoxe.xoxp-`) or its refresh token (`xoxe-`). */
export function tokenKind(token: string): 'bot' | 'user' | 'app' | 'config' | 'refresh' | undefined {
  if (token.startsWith('xoxe.xoxp-')) return 'config';
  if (token.startsWith('xoxe-')) return 'refresh';
  if (token.startsWith('xoxb-')) return 'bot';
  if (token.startsWith('xoxp-')) return 'user';
  if (token.startsWith('xapp-')) return 'app';
  return undefined;
}

/** A person's own client token names them: `xoxp-<user id>` (the twin's decision: the Slack client's session, which
 *  no API mints). */
export const personOfToken = (token: string): string | undefined => /^xoxp-(U[A-Z0-9-]+)$/.exec(token)?.[1];

/** The value of a comma-separated argument (`users`, `channel_ids`). */
export const listArg = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : []).map((s) => s.trim()).filter(Boolean);
