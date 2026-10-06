// QStash's millisecond expression, not JavaScript: only arithmetic, retried and the documented functions.
// source: https://upstash.com/docs/qstash/features/retry "current retry attempt count starting from 0"
// Workflow's Configure a Run page writes the same count as retries, in its published retry delay (its example's
// expression, (1 + retries) * 1000): retries is read as retried. Where the documentation stops: the page names the
// variable only in that example.
// source: https://upstash.com/docs/workflow/howto/configure "Retry Delay: The delay strategy between retries when Upstash Workflow attempts retries."
// source: https://upstash.com/docs/qstash/api-reference/messages/publish-a-message "Supported functions:"
const functions: Record<string, (...args: number[]) => number> = { pow: Math.pow, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max };

/** Parse anew for each failed attempt, so retried is evaluated at that attempt, without executing caller code. */
export function retryDelay(expression: string, retried: number): number | undefined {
  const tokens = expression.match(/\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[a-zA-Z_]+|[^\s]/g) ?? [];
  let cursor = 0;
  const invalid = (): never => { throw new Error('invalid retry delay expression'); };
  const take = (token: string): void => { if (tokens[cursor++] !== token) invalid(); };
  const atom = (): number => {
    const token = tokens[cursor++];
    if (token === '+' || token === '-') return (token === '-' ? -1 : 1) * atom();
    if (token === '(') { const value = sum(); take(')'); return value; }
    if (token === 'retried' || token === 'retries') return retried;
    if (token && /^\d/.test(token)) return Number(token);
    const fn = token && Object.hasOwn(functions, token) ? functions[token] : undefined;
    if (!fn) return invalid();
    take('(');
    const args = [sum()];
    while (tokens[cursor] === ',') { cursor++; args.push(sum()); }
    take(')');
    return fn(...args);
  };
  const product = (): number => {
    let value = atom();
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++]; const right = atom();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++]; const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  // Where the documents stop: malformed or non-finite/negative delays have no documented error text; the caller
  // refuses them in QStash's {error} form rather than running an arbitrary expression or scheduling backward.
  try { const value = sum(); return cursor === tokens.length && Number.isFinite(value) && value >= 0 ? value : undefined; } catch { return undefined; }
}
