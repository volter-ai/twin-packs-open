import { sha256 } from '@volter/world-core';

/** Google's native account-id contract, shared by Google API twins that consume a member's account. */
export function googleSubFor(email: string): string {
  const number = BigInt(`0x${sha256(`google-sub\u0000${email.toLowerCase()}`)}`) % (10n ** 20n);
  return `1${number.toString().padStart(20, '0')}`;
}
