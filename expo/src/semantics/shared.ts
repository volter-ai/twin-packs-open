// What Expo's push service shares: its request errors, the World's phones (an app installed, with the push token Expo
// gave it), and a message's payload as FCM and APNs take it.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export const NOTIFICATION = '_notification';
export const DEVICE = '_device';

/** A request error: the HTTP status and `errors`, as the reference answers a request that failed as a whole. */
// source: https://docs.expo.dev/push-notifications/sending-notifications/ "If the entire request failed, the HTTP status code is 4xx or 5xx and the errors field will be an array of error objects"
export const requestError = (status: number, code: string, message: string, details?: Row): Response =>
  Response.json({ errors: [{ code, message, ...(details ? { details } : {}) }] }, { status });

/** An Expo push token's form, as expo-server-sdk's `isExpoPushToken` reads it. */
export const isPushToken = (v: unknown): v is string => typeof v === 'string' && /^(Exponent|Expo)PushToken\[.+\]$/.test(v);

/** The phone a token reaches, if an app was given it. */
export const deviceOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, token: string): Row | undefined =>
  ctx.rowsRaw(DEVICE).find((d) => d.deleted !== true && d.token === token);

// source: https://docs.expo.dev/push-notifications/sending-notifications/ "the total payload must be at most 4096 bytes"
export const PAYLOAD_LIMIT = 4096;
/** The queued message is nested bookkeeping so vendor payload keys (including _contentAvailable) remain intact. */
export const payloadBytes = (message: Row): number => new TextEncoder().encode(JSON.stringify(message)).length;
export const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};

/** Malformed JSON uses the documented whole-request error class; the reference does not specify its code. */
// source: https://docs.expo.dev/push-notifications/sending-notifications/ "The request body must be JSON"
export function jsonBody(ctx: HandlerContext): unknown | Response {
  try { return ctx.text ? JSON.parse(ctx.text) : ctx.body; } catch { return requestError(400, 'VALIDATION_ERROR', 'The request body must be JSON.'); }
}

/** The kernel's strictFields leaves object/array shapes to handlers. The reference gives the message's types. */
// source: spec:pushSend "An Expo push token or an array of Expo push tokens specifying the recipient(s) of this message."
// Validation's exact code/message is undocumented; use the existing whole-request error class.
export function messageIssue(message: Row): string | undefined {
  const strings = ['title', 'body', 'subtitle', 'channelId', 'icon', 'categoryId'];
  const integers = ['ttl', 'expiration', 'badge'];
  const booleans = ['_contentAvailable', 'mutableContent'];
  for (const key of strings) if (key in message && typeof message[key] !== 'string') return `${key} must be a string`;
  for (const key of integers) if (key in message && !Number.isInteger(message[key])) return `${key} must be an integer`;
  for (const key of booleans) if (key in message && typeof message[key] !== 'boolean') return `${key} must be a boolean`;
  for (const key of ['data', 'richContent']) if (key in message && (!message[key] || typeof message[key] !== 'object' || Array.isArray(message[key]))) return `${key} must be an object`;
  // source: https://docs.expo.dev/push-notifications/sending-notifications/ "Play a sound when the recipient receives this notification"
  if ('sound' in message && message.sound !== null && typeof message.sound !== 'string') return 'sound must be a string or null';
  // source: spec:/paths/~1--~1api~1v2~1push~1send/post/requestBody/content/application~1json/schema/oneOf/0/properties/priority "high"
  if ('priority' in message && (typeof message.priority !== 'string' || !['default', 'normal', 'high'].includes(message.priority))) return 'priority must be default, normal or high';
  // source: spec:/paths/~1--~1api~1v2~1push~1send/post/requestBody/content/application~1json/schema/oneOf/0/properties/interruptionLevel "time-sensitive"
  if ('interruptionLevel' in message && (typeof message.interruptionLevel !== 'string' || !['active', 'critical', 'passive', 'time-sensitive'].includes(message.interruptionLevel))) return 'interruptionLevel is not a documented value';
  return undefined;
}
