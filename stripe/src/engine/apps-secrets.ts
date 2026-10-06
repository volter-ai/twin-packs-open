// Apps secret-store semantics: a secret is named within a scope (the account, or one user); setting
// the same name in the same scope overwrites it. The scope is kept as a bookkeeping key.

export const SECRET = 'apps.secret';
