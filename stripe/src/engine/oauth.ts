// Stripe API key parsing and error redaction, from the API authentication documentation.

/** A key shown the way Stripe's errors show one: its prefix and its last four. */
export const redactKey = (key: string): string => {
  const prefix = /^(sk|rk|pk)_(test|live)_/.exec(key)?.[0] ?? '';
  const rest = key.slice(prefix.length);
  return rest.length > 4 ? `${prefix}${'*'.repeat(rest.length - 4)}${rest.slice(-4)}` : `${prefix}${'*'.repeat(rest.length)}`;
};

/** The API key a request carries: Bearer, or Basic's user (`curl -u sk_…:`, docs.stripe.com/api/authentication). */
export function requestKey(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const bearer = /^bearer\s+(\S+)/i.exec(header)?.[1];
  if (bearer) return bearer;
  const basic = /^basic\s+(\S+)/i.exec(header)?.[1];
  if (basic) { try { return atob(basic).split(':')[0] ?? ''; } catch { return ''; } }
  return '';
}
