// Time-based one-time passwords as an authenticator app computes them for GitHub's two-factor authentication
// (RFC 6238, https://www.rfc-editor.org/rfc/rfc6238, over RFC 4226's HOTP, https://www.rfc-editor.org/rfc/rfc4226):
// HMAC-SHA1 of the 30-second step since the epoch, keyed by the setup key (base32, RFC 4648), truncated to six digits.
import { hmac } from '@volter/world-core';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A setup key's bytes. */
export function base32Decode(key: string): Uint8Array {
  const clean = key.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const v = BASE32.indexOf(c);
    if (v < 0) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

/** Bytes as a setup key. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The six-digit code for a setup key at an instant (epoch seconds). */
export function totp(key: string, seconds: number): string {
  const step = Math.floor(seconds / 30);
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i -= 1) { counter[i] = n & 0xff; n = Math.floor(n / 256); }
  const mac = hexBytes(hmac(base32Decode(key), counter, 'hex', 'sha1'));
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/** Whether a code is the key's at an instant, or the step either side ("allows for one step of clock drift"). */
export const totpAccepts = (key: string, seconds: number, code: string): boolean => [-30, 0, 30].some((d) => totp(key, seconds + d) === code.trim());

const hexBytes = (hex: string): Uint8Array => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
