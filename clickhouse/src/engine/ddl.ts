// The server's statement front. SELECT expressions belong to the kernel's ClickHouse engine.
// source: https://clickhouse.com/docs/sql-reference/statements/create/database "CREATE DATABASE"
export class SqlError extends Error {
  constructor(readonly code: number, message: string) { super(message); this.name = 'DB::Exception'; }
}
export type Token = { text: string; value: string; quoted: boolean; string: boolean; start: number; end: number };
// source: https://clickhouse.com/docs/reference/syntax "SQL-style comments begin with"
// source: https://clickhouse.com/docs/reference/syntax "// (or more than 2 / characters)"
export function tokens(sql: string): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < sql.length;) {
    if (/\s/.test(sql[i]!)) { i++; continue; }
    if (sql.startsWith('--', i) || sql.startsWith('//', i) || sql.startsWith('#!', i) || sql.startsWith('# ', i)) { i = sql.indexOf('\n', i); if (i < 0) break; continue; }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) { if (sql.startsWith('/*', i)) { depth++; i += 2; } else if (sql.startsWith('*/', i)) { depth--; i += 2; } else i++; }
      if (depth) throw new SqlError(62, 'Unclosed comment'); continue;
    }
    const start = i, quote = sql[i]!;
    if (quote === "'" || quote === '`' || quote === '"') {
      let value = ''; i++; let closed = false;
      while (i < sql.length) {
        const c = sql[i++]!;
        if (c === '\\' && i < sql.length) {
          const escaped = sql[i++]!;
          value += ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[escaped] ?? escaped;
        } else if (c === quote) {
          if (sql[i] === quote) { value += quote; i++; } else { closed = true; break; }
        } else value += c;
      }
      if (!closed) throw new SqlError(62, 'Unclosed quoted token');
      result.push({ text: sql.slice(start, i), value, quoted: true, string: quote === "'", start, end: i }); continue;
    }
    if (/[A-Za-z0-9_$]/.test(quote)) {
      while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i]!)) i++;
    } else i++;
    const text = sql.slice(start, i); result.push({ text, value: text, quoted: false, string: false, start, end: i });
  }
  return result;
}
export class Statement {
  at = 0;
  readonly items: Token[];
  constructor(readonly sql: string) { this.items = tokens(sql); }
  peek(word?: string): boolean { const t = this.items[this.at]; return !!t && (word === undefined || (!t.quoted && t.value.toUpperCase() === word)); }
  take(word: string): boolean { if (!this.peek(word)) return false; this.at++; return true; }
  need(word: string): void { if (!this.take(word)) throw new SqlError(62, `Expected ${word}`); }
  name(): string {
    const t = this.items[this.at++];
    if (!t || t.string || (!t.quoted && !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(t.value))) throw new SqlError(62, 'Expected identifier');
    return t.value;
  }
  qualified(database: string): { database: string; name: string } {
    const first = this.name(); return this.take('.') ? { database: first, name: this.name() } : { database, name: first };
  }
  ifNotExists(): boolean { if (!this.take('IF')) return false; this.need('NOT'); this.need('EXISTS'); return true; }
  ifExists(): boolean { if (!this.take('IF')) return false; this.need('EXISTS'); return true; }
  cluster(): string | undefined { if (!this.take('ON')) return; this.need('CLUSTER'); return this.items[this.at]?.string ? this.items[this.at++]!.value : this.name(); }
  grouped(): Token[] {
    this.need('('); const start = this.at; let depth = 1;
    while (this.at < this.items.length) {
      const t = this.items[this.at++]!;
      if (!t.quoted && t.value === '(') depth++;
      if (!t.quoted && t.value === ')' && --depth === 0) return this.items.slice(start, this.at - 1);
    }
    throw new SqlError(62, 'Unclosed parentheses');
  }
  finish(): void { this.take(';'); if (this.peek()) throw new SqlError(62, `Unexpected ${this.items[this.at]!.text}`); }
}
export function splitTop(items: Token[]): Token[][] {
  const result: Token[][] = []; let current: Token[] = [], depth = 0;
  for (const token of items) {
    if (!token.quoted && token.value === '(') depth++;
    if (!token.quoted && token.value === ')') depth--;
    if (!token.quoted && token.value === ',' && depth === 0) { result.push(current); current = []; }
    else current.push(token);
  }
  if (current.length) result.push(current);
  return result;
}
export const textOf = (items: Token[]): string => items.map(t => t.text).join(' ');
